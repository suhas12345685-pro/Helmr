/**
 * Shared types for the Helmr security scanner.
 *
 * The scanner inspects a community submission (a skill, toolpack, channel,
 * provider, workflow, agent, policy, template, or patch) before it is allowed
 * anywhere near the official marketplace. Every finding is actionable: it names
 * a category, a severity, the exact file/line when known, and — where possible —
 * a concrete suggested fix and whether that fix can be applied automatically.
 */

/** How dangerous a single finding is. Ordered low → critical. */
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_ORDER: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

/** The kinds of checks the scanner performs, one per requested scan category. */
export type ScanCategory =
  | 'secret'
  | 'suspicious-shell'
  | 'network-access'
  | 'filesystem-write'
  | 'dependency-audit'
  | 'package-install'
  | 'dangerous-permission'
  | 'obfuscated-code'
  | 'postinstall-script'
  | 'remote-download'
  | 'token-exfiltration'
  | 'unsafe-eval'
  | 'permission-mismatch';

export interface Finding {
  category: ScanCategory;
  severity: Severity;
  /** Short human-readable title, e.g. "Hard-coded API key". */
  title: string;
  /** Why this is a problem and what it could enable an attacker to do. */
  detail: string;
  /** Path of the offending file, relative to the submission root, if known. */
  file?: string;
  /** 1-based line number of the match within `file`, if known. */
  line?: number;
  /** The matched snippet (already truncated/redacted), if known. */
  evidence?: string;
  /** Concrete remediation guidance. */
  suggestedFix?: string;
  /** Whether Helmr can rewrite the file to remove this finding automatically. */
  autoFixable: boolean;
}

export interface ScanResult {
  /** True only when there are no high or critical findings. */
  pass: boolean;
  /** The single most severe finding's severity (or 'info' when clean). */
  severity: Severity;
  findings: Finding[];
  /** Files the scanner inspected, relative to the submission root. */
  scannedFiles: string[];
  /** ISO timestamp of when the scan completed. */
  scannedAt: string;
  /** Convenience counters by severity. */
  counts: Record<Severity, number>;
}

/** A single in-memory file the scanner can inspect: path + textual contents. */
export interface ScanFile {
  /** Path relative to the submission root, e.g. "scripts/install.sh". */
  path: string;
  content: string;
}

/** The declared shape of a submission, used for permission-mismatch checks. */
export interface DeclaredCapabilities {
  /** Permissions the manifest claims it needs, e.g. ["network", "filesystem"]. */
  permissions?: string[];
  /** Risk level the author self-declared. */
  riskLevel?: 'low' | 'medium' | 'high';
  /** Tools the manifest declares it uses. */
  declaredTools?: string[];
}
