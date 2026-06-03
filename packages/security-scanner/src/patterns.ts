import type { ScanCategory, Severity } from './types.js';

/**
 * The pattern catalog the scanner runs line-by-line over every text file in a
 * submission. Each rule pairs a regular expression with the category, severity,
 * and remediation that a match implies. Keeping the rules declarative makes the
 * scanner easy to audit and extend: adding a new detection is one entry here.
 */
export interface PatternRule {
  category: ScanCategory;
  severity: Severity;
  title: string;
  detail: string;
  regex: RegExp;
  suggestedFix?: string;
  autoFixable: boolean;
  /** Only apply this rule to files whose path matches, if set. */
  fileFilter?: RegExp;
}

// --- Secret material -------------------------------------------------------

const SECRET_RULES: PatternRule[] = [
  {
    category: 'secret',
    severity: 'critical',
    title: 'Hard-coded private key',
    detail: 'A PEM private key block is embedded in the submission. Shipping a private key leaks credentials and is never required for a marketplace capability.',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    suggestedFix: 'Remove the key and load it from a declared secret at runtime instead.',
    autoFixable: false,
  },
  {
    category: 'secret',
    severity: 'high',
    title: 'Hard-coded API key or token',
    detail: 'A credential matching a known provider key format is hard-coded. Credentials must be declared as required secrets, never embedded.',
    regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIzaSy[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
    suggestedFix: 'Move the value into a declared `requiredSecrets` entry and read it from the environment.',
    autoFixable: false,
  },
  {
    category: 'secret',
    severity: 'medium',
    title: 'Inline secret assignment',
    detail: 'A variable named like a secret is assigned a literal value inline.',
    regex: /\b(?:api[_-]?key|secret|password|passwd|token|auth[_-]?token)\b\s*[:=]\s*["'][^"']{8,}["']/i,
    suggestedFix: 'Replace the literal with a reference to a declared secret.',
    autoFixable: true,
  },
];

// --- Suspicious shell ------------------------------------------------------

const SHELL_RULES: PatternRule[] = [
  {
    category: 'suspicious-shell',
    severity: 'critical',
    title: 'Pipe-to-shell remote execution',
    detail: 'Downloads a remote script and pipes it straight into a shell, executing arbitrary unreviewed code on install.',
    regex: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/,
    suggestedFix: 'Vendor the script into the submission so it can be reviewed, or remove the remote execution entirely.',
    autoFixable: false,
  },
  {
    category: 'suspicious-shell',
    severity: 'high',
    title: 'Destructive filesystem command',
    detail: 'A recursive force-delete that can wipe files outside the workspace.',
    regex: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b/,
    suggestedFix: 'Scope deletions to a temporary directory you created; never recursively force-delete absolute or home paths.',
    autoFixable: false,
  },
  {
    category: 'suspicious-shell',
    severity: 'high',
    title: 'Privilege escalation',
    detail: 'Invokes sudo/su to escalate privileges during install or runtime.',
    regex: /\b(?:sudo|su)\s+/,
    suggestedFix: 'Marketplace capabilities must run unprivileged. Remove privilege escalation.',
    autoFixable: false,
  },
  {
    category: 'suspicious-shell',
    severity: 'medium',
    title: 'Spawns a shell process',
    detail: 'Spawns a subshell or shell command, which can run arbitrary commands.',
    regex: /\b(?:child_process|exec|execSync|spawn|spawnSync|popen|os\.system|subprocess\.)\b/,
    suggestedFix: 'Declare the `shell` permission and justify each command, or use a sandboxed API.',
    autoFixable: false,
  },
];

// --- Network access --------------------------------------------------------

const NETWORK_RULES: PatternRule[] = [
  {
    category: 'network-access',
    severity: 'medium',
    title: 'Outbound network call',
    detail: 'Makes an outbound network request. Network access must be declared and host-scoped.',
    regex: /(?:\bfetch\(|\bhttps?\.request|\bhttps?\.get|\bXMLHttpRequest\b|\baxios\.|\bgot\(|\burllib\b|\brequests\.(?:get|post)|\bnet\.connect|\bnew\s+WebSocket)/,
    suggestedFix: 'Declare the `network` permission and list the exact hosts you contact.',
    autoFixable: false,
  },
  {
    category: 'remote-download',
    severity: 'high',
    title: 'Remote download of executable content',
    detail: 'Fetches a remote archive or binary, which can introduce unreviewed code after review.',
    regex: /https?:\/\/[^\s"')]+\.(?:sh|exe|dll|so|dylib|bin|zip|tar\.gz|tgz|whl|jar|deb|rpm)\b/,
    suggestedFix: 'Vendor the artifact into the submission and pin a checksum, or remove the download.',
    autoFixable: false,
  },
];

// --- Filesystem writes -----------------------------------------------------

const FILESYSTEM_RULES: PatternRule[] = [
  {
    category: 'filesystem-write',
    severity: 'high',
    title: 'Write outside the workspace',
    detail: 'Writes to an absolute system path or the user home directory, escaping the sandboxed workspace.',
    regex: /\b(?:writeFile|writeFileSync|appendFile|createWriteStream|open\([^)]*['"][aw])\b[^\n]*(?:\/etc\/|\/usr\/|\/bin\/|~\/|\$HOME|process\.env\.HOME)/,
    suggestedFix: 'Restrict writes to the provided workspace directory.',
    autoFixable: false,
  },
  {
    category: 'filesystem-write',
    severity: 'medium',
    title: 'Filesystem write',
    detail: 'Writes to the filesystem. Writes must be declared and scoped to the workspace.',
    regex: /\b(?:fs\.)?(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|unlink|rmdir|rm)\b/,
    suggestedFix: 'Declare the `filesystem` permission and scope writes to the workspace.',
    autoFixable: false,
  },
];

// --- Package install / postinstall -----------------------------------------

const PACKAGE_RULES: PatternRule[] = [
  {
    category: 'package-install',
    severity: 'high',
    title: 'Runtime package installation',
    detail: 'Installs packages at runtime/install time, pulling unreviewed code from a registry.',
    regex: /\b(?:npm\s+(?:i|install|add)|yarn\s+add|pnpm\s+add|pip\s+install|pip3\s+install|gem\s+install|cargo\s+install|go\s+install|apt-get\s+install|brew\s+install)\b/,
    suggestedFix: 'Declare dependencies in the manifest with pinned versions; do not install at runtime.',
    autoFixable: false,
  },
  {
    category: 'postinstall-script',
    severity: 'high',
    title: 'postinstall lifecycle script',
    detail: 'A package.json postinstall/preinstall hook runs arbitrary code automatically when dependencies are installed.',
    regex: /"(?:pre|post)install"\s*:/,
    suggestedFix: 'Remove install lifecycle scripts; perform setup through Helmr health checks instead.',
    autoFixable: false,
    fileFilter: /package\.json$/,
  },
];

// --- Obfuscation / eval ----------------------------------------------------

const OBFUSCATION_RULES: PatternRule[] = [
  {
    category: 'unsafe-eval',
    severity: 'high',
    title: 'Dynamic code execution (eval)',
    detail: 'Uses eval/Function/vm to execute code built at runtime, defeating static review.',
    regex: /\b(?:eval\(|new\s+Function\(|vm\.runIn|globalThis\[['"]eval|exec\(compile)/,
    suggestedFix: 'Replace dynamic code execution with explicit, reviewable logic.',
    autoFixable: false,
  },
  {
    category: 'obfuscated-code',
    severity: 'high',
    title: 'Obfuscated payload',
    detail: 'Decodes and likely executes an encoded blob (base64/hex), a common way to hide a payload from review.',
    regex: /\b(?:atob\(|Buffer\.from\([^)]*['"]base64['"]\)|fromCharCode|\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){8,}|base64\.b64decode)\b/,
    suggestedFix: 'Ship code in plain, reviewable form rather than encoded blobs.',
    autoFixable: false,
  },
];

// --- Token / key exfiltration ----------------------------------------------

const EXFIL_RULES: PatternRule[] = [
  {
    category: 'token-exfiltration',
    severity: 'critical',
    title: 'Credential exfiltration pattern',
    detail: 'Reads environment secrets or known credential files and appears to send them over the network.',
    regex: /(?:process\.env|os\.environ|\.aws\/credentials|\.ssh\/id_|\.npmrc|\.git-credentials)[\s\S]{0,120}?(?:\bfetch\(|\bhttps?\.request|\baxios|\brequests\.post|\bnet\.connect|\bWebSocket)/,
    suggestedFix: 'Never transmit secrets or credential files off-host. Remove this code.',
    autoFixable: false,
  },
];

export const ALL_RULES: PatternRule[] = [
  ...SECRET_RULES,
  ...SHELL_RULES,
  ...NETWORK_RULES,
  ...FILESYSTEM_RULES,
  ...PACKAGE_RULES,
  ...OBFUSCATION_RULES,
  ...EXFIL_RULES,
];
