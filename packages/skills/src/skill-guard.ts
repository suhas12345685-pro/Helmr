import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

import type { SkillManifest } from './manifest.js';

/**
 * Skill Guard — supply-chain defense for dynamically loaded skills.
 *
 * OpenClaw-style marketplaces ship thousands of unvetted, unsigned skills; field
 * scans have found roughly a quarter of them carrying exploitable patterns, and
 * there is no integrity check tying a skill on disk to the author who published it.
 *
 * Skill Guard closes both gaps:
 *   - {@link scanSkill} statically inspects a manifest for dangerous instructions,
 *     secret exfiltration, prompt injection, and under-declared risk.
 *   - {@link signSkill}/{@link verifySkillSignature} bind a manifest to an Ed25519
 *     author key so tampered or unknown-origin skills are detectable.
 *   - {@link evaluateSkillTrust} fuses both into one admit / quarantine / block
 *     decision that the registry and Governor can enforce.
 *
 * Everything here is pure and dependency-free so it can run in CI, the Council
 * risk step, and the `helmr skills scan` command alike.
 */

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface ScanFinding {
  /** Stable rule id, e.g. `secret-exfiltration`. */
  rule: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Where the rule fired: which manifest field and the matched text. */
  field: string;
  evidence?: string;
}

export interface ScanResult {
  findings: ScanFinding[];
  /** Highest severity observed, or `info` when nothing fired. */
  maxSeverity: Severity;
  /** 0 (pristine) … 100 (saturated with critical findings). */
  riskScore: number;
}

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const SEVERITY_WEIGHT: Record<Severity, number> = { info: 0, low: 5, medium: 15, high: 30, critical: 55 };

function maxSeverity(findings: ScanFinding[]): Severity {
  return findings.reduce<Severity>(
    (acc, finding) => (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[acc] ? finding.severity : acc),
    'info',
  );
}

function riskScore(findings: ScanFinding[]): number {
  const total = findings.reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0);
  return Math.min(100, total);
}

interface PatternRule {
  rule: string;
  severity: Severity;
  title: string;
  pattern: RegExp;
  detail: string;
}

/**
 * Pattern rules applied to a skill's free-text surfaces (instructions, examples,
 * tool descriptions). Each pattern is intentionally narrow to keep false
 * positives low while still catching the well-known marketplace abuse classes.
 */
const TEXT_RULES: PatternRule[] = [
  {
    rule: 'remote-code-pipe',
    severity: 'critical',
    title: 'Pipes a remote payload straight into a shell',
    pattern: /\b(?:curl|wget|fetch|iwr|invoke-webrequest)\b[^\n|]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh|python\d?|node|powershell|pwsh|iex)\b/i,
    detail: 'Downloading and executing code in one step bypasses any review of what actually runs.',
  },
  {
    rule: 'destructive-filesystem',
    severity: 'high',
    title: 'Performs an unbounded destructive filesystem operation',
    pattern: /\brm\s+-rf?\s+(?:--no-preserve-root\s+)?(?:\/(?:\s|$)|~|\$HOME|\*)/i,
    detail: 'Recursive deletion of root, home, or a wildcard can wipe the host or workspace.',
  },
  {
    rule: 'privilege-escalation',
    severity: 'high',
    title: 'Attempts privilege escalation or credential access',
    pattern: /(?:\bsudo\s+(?:su|-s|bash|sh)\b|\bchmod\s+(?:-R\s+)?0?777\b|\/etc\/(?:passwd|shadow|sudoers)|\.ssh\/id_|\.aws\/credentials|\.kube\/config)/i,
    detail: 'Reads privileged credentials or grants itself elevated permissions.',
  },
  {
    rule: 'secret-exfiltration',
    severity: 'critical',
    title: 'Sends secrets or environment variables to the network',
    pattern: /\b(?:curl|wget|fetch|http[s]?:\/\/)[^\n]*?(?:\$\{?(?:[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\}?|process\.env|printenv|\benv\b)/i,
    detail: 'Combines an outbound request with secret material, the classic exfiltration shape.',
  },
  {
    rule: 'exfiltration-sink',
    severity: 'high',
    title: 'References a known data-exfiltration sink',
    pattern: /\b(?:webhook\.site|requestbin|pipedream\.net|burpcollaborator|ngrok\.io|\.r\.requestrepo\.com|oast\.(?:pro|live|site|fun))\b/i,
    detail: 'Out-of-band collaborator domains are almost exclusively used to siphon data off-host.',
  },
  {
    rule: 'prompt-injection',
    severity: 'high',
    title: 'Contains prompt-injection / jailbreak phrasing',
    pattern: /\b(?:ignore (?:all |any )?(?:previous|prior|above) (?:instructions|prompts)|disregard (?:the )?(?:system|previous)|you are now (?:a |an )?|do not (?:tell|inform|alert) the user|without (?:asking|notifying) the user)\b/i,
    detail: 'Instructions that override the operator or hide actions from the user indicate a hostile skill.',
  },
  {
    rule: 'dynamic-eval',
    severity: 'medium',
    title: 'Evaluates dynamically constructed code',
    pattern: /\b(?:eval\s*\(|new Function\s*\(|child_process|exec(?:Sync)?\s*\(|os\.system\s*\(|subprocess\.(?:call|run|Popen))/i,
    detail: 'Dynamic evaluation of untrusted input is a frequent skill-takeover vector.',
  },
  {
    rule: 'reverse-shell',
    severity: 'critical',
    title: 'Looks like a reverse shell',
    pattern: /\b(?:nc|ncat|netcat)\b[^\n]*\s-e\b|\/dev\/tcp\/|bash\s+-i\s+>&|mkfifo[^\n]*\|\s*(?:nc|sh|bash)/i,
    detail: 'Opens an interactive connection back to an attacker-controlled host.',
  },
];

function scanText(field: string, text: string | undefined, findings: ScanFinding[]): void {
  if (!text) return;
  for (const rule of TEXT_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      findings.push({
        rule: rule.rule,
        severity: rule.severity,
        title: rule.title,
        detail: rule.detail,
        field,
        evidence: match[0].slice(0, 160),
      });
    }
  }
}

/** Permissions that materially raise blast radius if granted. */
const SENSITIVE_PERMISSIONS = new Set([
  'shell',
  'shell.exec',
  'process',
  'filesystem.write',
  'fs.write',
  'network',
  'secrets.read',
  'credentials',
  'gateway.admin',
  'channel.send',
]);

/**
 * Statically inspect a skill manifest for unsafe content and structural risk
 * under-declaration. Pure and side-effect free.
 */
export function scanSkill(manifest: SkillManifest): ScanResult {
  const findings: ScanFinding[] = [];

  scanText('instructions', manifest.instructions, findings);
  scanText('description', manifest.description, findings);
  manifest.examples.forEach((example, i) => scanText(`examples[${i}]`, example, findings));
  manifest.tools.forEach((tool, i) => scanText(`tools[${i}].description`, tool.description, findings));

  // Structural rule: sensitive permissions but a low declared risk level. A skill
  // that can shell out yet claims `riskLevel: low` is hiding its blast radius.
  const sensitive = manifest.permissions.filter((p) => SENSITIVE_PERMISSIONS.has(p));
  if (sensitive.length > 0 && SEVERITY_RANK[manifest.riskLevel as Severity] < SEVERITY_RANK.high) {
    findings.push({
      rule: 'risk-underdeclared',
      severity: 'medium',
      title: 'Sensitive permissions with an under-declared risk level',
      detail: `Holds sensitive permissions (${sensitive.join(', ')}) but declares riskLevel="${manifest.riskLevel}". High-impact skills must declare high/critical risk so approvals engage.`,
      field: 'permissions',
      evidence: sensitive.join(', '),
    });
  }

  // Structural rule: free network access without an approval gate on a risky skill.
  if (
    manifest.runtimeConstraints.network === 'allowed' &&
    SEVERITY_RANK[manifest.riskLevel as Severity] >= SEVERITY_RANK.high
  ) {
    findings.push({
      rule: 'unfettered-network',
      severity: 'medium',
      title: 'High-risk skill granted unfettered network access',
      detail: 'A high/critical skill with runtimeConstraints.network="allowed" can reach any host without approval. Prefer "approval".',
      field: 'runtimeConstraints.network',
    });
  }

  // Structural rule: tools that do not require approval on a risky skill.
  const autoApprovedTools = manifest.tools.filter((t) => t.approvalRequired === false);
  if (autoApprovedTools.length > 0 && SEVERITY_RANK[manifest.riskLevel as Severity] >= SEVERITY_RANK.high) {
    findings.push({
      rule: 'auto-approved-tools',
      severity: 'medium',
      title: 'High-risk skill exposes auto-approved tools',
      detail: `Tools (${autoApprovedTools.map((t) => t.id).join(', ')}) run without approval despite the skill's risk level.`,
      field: 'tools',
      evidence: autoApprovedTools.map((t) => t.id).join(', '),
    });
  }

  return { findings, maxSeverity: maxSeverity(findings), riskScore: riskScore(findings) };
}

// --- Integrity & signing -----------------------------------------------------

/**
 * Fields excluded from the signed digest. `signature` and `checksum` are derived,
 * and timestamps are operational metadata that must not invalidate a signature.
 */
const UNSIGNED_FIELDS = new Set(['signature', 'checksum', 'createdAt', 'updatedAt', 'enabled']);

/**
 * Deterministic canonical JSON of the security-relevant manifest fields, with
 * object keys sorted recursively so the digest is stable across serializations.
 */
export function canonicalizeSkill(manifest: SkillManifest): string {
  const filtered = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !UNSIGNED_FIELDS.has(key)),
  );
  return canonicalJson(filtered);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** SHA-256 hex digest of the canonical manifest. */
export function computeSkillChecksum(manifest: SkillManifest): string {
  return createHash('sha256').update(canonicalizeSkill(manifest)).digest('hex');
}

export interface SkillKeyPair {
  /** PEM-encoded SPKI public key. Share/pin this as a trusted author key. */
  publicKey: string;
  /** PEM-encoded PKCS8 private key. Keep secret; signs skills. */
  privateKey: string;
  /** Stable short fingerprint of the public key, for allowlists and audit. */
  keyId: string;
}

/** Generate an Ed25519 author keypair for signing skills. */
export function generateSkillKeypair(): SkillKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    publicKey: publicPem,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    keyId: keyFingerprint(publicPem),
  };
}

/** Short, stable fingerprint of a PEM public key (first 16 hex of its SHA-256). */
export function keyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

/**
 * Sign a manifest, returning a copy with `checksum` and `signature` populated.
 * The signature is over the canonical digest, so re-signing is idempotent for
 * unchanged content.
 */
export function signSkill(manifest: SkillManifest, privateKeyPem: string): SkillManifest {
  const checksum = computeSkillChecksum(manifest);
  const key = createPrivateKey(privateKeyPem);
  const signature = cryptoSign(null, Buffer.from(checksum, 'hex'), key).toString('base64');
  return { ...manifest, checksum, signature };
}

export type SignatureVerdict =
  | { status: 'valid'; keyId: string; reason: string }
  | { status: 'unsigned'; reason: string }
  | { status: 'untrusted'; reason: string }
  | { status: 'tampered'; reason: string }
  | { status: 'invalid'; reason: string };

/**
 * Verify a manifest's integrity and authorship.
 *
 * - `unsigned`  — no checksum/signature present.
 * - `tampered`  — checksum does not match the current content.
 * - `untrusted` — signature is well-formed but signed by no key in `trustedKeys`.
 * - `invalid`   — signature is malformed or fails verification against every key.
 * - `valid`     — content is intact and signed by a trusted key.
 */
export function verifySkillSignature(
  manifest: SkillManifest,
  trustedKeys: string[] = [],
): SignatureVerdict {
  if (!manifest.checksum || !manifest.signature) {
    return { status: 'unsigned', reason: 'manifest has no checksum/signature' };
  }
  const expected = computeSkillChecksum(manifest);
  if (expected !== manifest.checksum) {
    return { status: 'tampered', reason: `checksum mismatch (content changed after signing)` };
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(manifest.signature, 'base64');
  } catch {
    return { status: 'invalid', reason: 'signature is not valid base64' };
  }
  const digest = Buffer.from(manifest.checksum, 'hex');

  let sawWellFormedKey = false;
  for (const pem of trustedKeys) {
    let key;
    try {
      key = createPublicKey(pem);
    } catch {
      continue;
    }
    sawWellFormedKey = true;
    try {
      if (cryptoVerify(null, digest, key, signatureBytes)) {
        return { status: 'valid', keyId: keyFingerprint(pem), reason: 'signed by a trusted key' };
      }
    } catch {
      // Verification can throw on key/sig type mismatch; treat as non-match.
    }
  }

  if (!sawWellFormedKey) {
    return { status: 'untrusted', reason: 'no trusted author keys are configured' };
  }
  return { status: 'invalid', reason: 'signature does not verify against any trusted key' };
}

// --- Trust gate --------------------------------------------------------------

export interface TrustPolicy {
  /** Trusted author public keys (PEM). */
  trustedKeys?: string[];
  /** Admit skills with no signature (default true for local/dev workflows). */
  allowUnsigned?: boolean;
  /** Scan severity at/above which a skill is quarantined. Default `high`. */
  quarantineAtOrAbove?: Severity;
  /** Scan severity at/above which a skill is hard-blocked. Default `critical`. */
  blockAtOrAbove?: Severity;
}

export type TrustDecision = 'admit' | 'quarantine' | 'block';

export interface SkillTrustReport {
  decision: TrustDecision;
  reasons: string[];
  scan: ScanResult;
  signature: SignatureVerdict;
}

const DEFAULT_POLICY: Required<Omit<TrustPolicy, 'trustedKeys'>> = {
  allowUnsigned: true,
  quarantineAtOrAbove: 'high',
  blockAtOrAbove: 'critical',
};

/**
 * Fuse static scan results and signature verification into a single
 * admit / quarantine / block decision. This is the function the registry and
 * Governor consult before letting a skill run.
 */
export function evaluateSkillTrust(manifest: SkillManifest, policy: TrustPolicy = {}): SkillTrustReport {
  const settings = { ...DEFAULT_POLICY, ...policy };
  const scan = scanSkill(manifest);
  const signature = verifySkillSignature(manifest, policy.trustedKeys ?? []);
  const reasons: string[] = [];
  let decision: TrustDecision = 'admit';

  const escalate = (next: TrustDecision) => {
    const order: TrustDecision[] = ['admit', 'quarantine', 'block'];
    if (order.indexOf(next) > order.indexOf(decision)) decision = next;
  };

  if (SEVERITY_RANK[scan.maxSeverity] >= SEVERITY_RANK[settings.blockAtOrAbove]) {
    escalate('block');
    reasons.push(`scan found ${scan.maxSeverity}-severity issues (risk score ${scan.riskScore})`);
  } else if (SEVERITY_RANK[scan.maxSeverity] >= SEVERITY_RANK[settings.quarantineAtOrAbove]) {
    escalate('quarantine');
    reasons.push(`scan found ${scan.maxSeverity}-severity issues (risk score ${scan.riskScore})`);
  }

  switch (signature.status) {
    case 'tampered':
      escalate('block');
      reasons.push(`integrity: ${signature.reason}`);
      break;
    case 'invalid':
      escalate('quarantine');
      reasons.push(`signature: ${signature.reason}`);
      break;
    case 'untrusted':
      escalate('quarantine');
      reasons.push(`signature: ${signature.reason}`);
      break;
    case 'unsigned':
      if (!settings.allowUnsigned) {
        escalate('quarantine');
        reasons.push('policy requires signed skills');
      } else {
        reasons.push('unsigned skill admitted by policy');
      }
      break;
    case 'valid':
      reasons.push(`signature valid (key ${signature.keyId})`);
      break;
  }

  if (decision === 'admit' && reasons.length === 0) reasons.push('no issues found');
  return { decision, reasons, scan, signature };
}

/** One-line human summary for CLI/audit output. */
export function formatTrustReport(id: string, report: SkillTrustReport): string {
  const verdict = report.decision.toUpperCase().padEnd(10);
  const head = `${verdict} ${id} — ${report.reasons.join('; ')}`;
  const findings = report.scan.findings.map(
    (f) => `    [${f.severity}] ${f.rule}: ${f.title} (${f.field})${f.evidence ? ` :: ${f.evidence}` : ''}`,
  );
  return [head, ...findings].join('\n');
}
