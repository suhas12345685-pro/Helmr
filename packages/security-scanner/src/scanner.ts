import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { ALL_RULES, type PatternRule } from './patterns.js';
import {
  SEVERITY_ORDER,
  type DeclaredCapabilities,
  type Finding,
  type ScanFile,
  type ScanResult,
  type Severity,
} from './types.js';

/** Files we never scan (binaries, vendored deps, VCS metadata, lockfiles). */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const TEXT_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|sh|bash|zsh|py|rb|go|rs|yaml|yml|toml|md|txt|env)$/i;
const MAX_FILE_BYTES = 1_000_000;
/** Truncate evidence so a scan report never leaks a whole file or a full secret. */
const MAX_EVIDENCE = 120;

function emptyCounts(): Record<Severity, number> {
  return { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

function truncate(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_EVIDENCE ? `${collapsed.slice(0, MAX_EVIDENCE)}…` : collapsed;
}

/**
 * The Helmr security scanner. It runs the declarative pattern catalog over every
 * text file in a submission, then layers on permission-mismatch checks that
 * compare what the code actually does against what the manifest declared.
 *
 * The scanner is pure and side-effect free over in-memory files (`scanFiles`),
 * with a thin filesystem loader (`scanDirectory`) on top, so it is trivial to
 * unit test and equally usable from the CLI, the pipeline, and CI.
 */
export class SecurityScanner {
  constructor(private readonly rules: PatternRule[] = ALL_RULES) {}

  /** Scan a set of in-memory files. The core, fully deterministic entry point. */
  scanFiles(files: ScanFile[], declared?: DeclaredCapabilities): ScanResult {
    const findings: Finding[] = [];

    for (const file of files) {
      const lines = file.content.split('\n');
      for (const rule of this.rules) {
        if (rule.fileFilter && !rule.fileFilter.test(file.path)) continue;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          const match = line.match(rule.regex);
          if (!match) continue;
          findings.push({
            category: rule.category,
            severity: rule.severity,
            title: rule.title,
            detail: rule.detail,
            file: file.path,
            line: i + 1,
            evidence: truncate(match[0]),
            suggestedFix: rule.suggestedFix,
            autoFixable: rule.autoFixable,
          });
        }
      }
    }

    findings.push(...this.permissionMismatchFindings(files, findings, declared));

    return this.summarize(findings, files.map((f) => f.path));
  }

  /**
   * Compare declared permissions against the behaviour the pattern scan actually
   * observed. An undeclared capability is a "permission mismatch": the submission
   * does more than it admitted to, which is exactly what we must catch.
   */
  private permissionMismatchFindings(
    _files: ScanFile[],
    findings: Finding[],
    declared?: DeclaredCapabilities,
  ): Finding[] {
    if (!declared) return [];
    const declaredPerms = new Set((declared.permissions ?? []).map((p) => p.toLowerCase()));
    const observed = new Map<string, { category: Finding['category']; file?: string; line?: number }>();

    const categoryToPermission: Record<string, string> = {
      'network-access': 'network',
      'remote-download': 'network',
      'filesystem-write': 'filesystem',
      'suspicious-shell': 'shell',
      'package-install': 'shell',
    };

    for (const finding of findings) {
      const perm = categoryToPermission[finding.category];
      if (perm && !observed.has(perm)) {
        observed.set(perm, { category: finding.category, file: finding.file, line: finding.line });
      }
    }

    const mismatches: Finding[] = [];
    for (const [perm, where] of observed) {
      if (!declaredPerms.has(perm)) {
        mismatches.push({
          category: 'permission-mismatch',
          severity: 'high',
          title: `Undeclared "${perm}" capability`,
          detail: `The code uses the "${perm}" capability but the manifest does not declare the "${perm}" permission. Submissions must declare every capability they use.`,
          file: where.file,
          line: where.line,
          suggestedFix: `Add "${perm}" to the manifest's permissions, or remove the usage.`,
          autoFixable: false,
        });
      }
    }

    // A self-declared "low" risk that nonetheless trips high/critical findings is
    // itself a mismatch worth surfacing to a reviewer.
    if (declared.riskLevel === 'low') {
      const hasSevere = findings.some((f) => f.severity === 'high' || f.severity === 'critical');
      if (hasSevere) {
        mismatches.push({
          category: 'permission-mismatch',
          severity: 'medium',
          title: 'Risk level understated',
          detail: 'The manifest declares risk "low" but the scan found high or critical behaviour.',
          suggestedFix: 'Raise the declared risk level to match the capability, or remove the risky behaviour.',
          autoFixable: false,
        });
      }
    }

    return mismatches;
  }

  private summarize(findings: Finding[], scannedFiles: string[]): ScanResult {
    const counts = emptyCounts();
    let severity: Severity = 'info';
    for (const finding of findings) {
      counts[finding.severity]++;
      severity = maxSeverity(severity, finding.severity);
    }
    // A scan "passes" only when nothing high or critical was found.
    const pass = counts.high === 0 && counts.critical === 0;
    return {
      pass,
      severity,
      findings,
      scannedFiles,
      scannedAt: new Date().toISOString(),
      counts,
    };
  }

  /** Load every text file under `root` and scan it. */
  async scanDirectory(root: string, declared?: DeclaredCapabilities): Promise<ScanResult> {
    const files = await this.loadTextFiles(root);
    return this.scanFiles(files, declared);
  }

  private async loadTextFiles(root: string): Promise<ScanFile[]> {
    const out: ScanFile[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        let info;
        try {
          info = await stat(full);
        } catch {
          continue;
        }
        if (info.isDirectory()) {
          await walk(full);
        } else if (info.isFile() && TEXT_EXT.test(entry) && info.size <= MAX_FILE_BYTES) {
          try {
            const content = await readFile(full, 'utf8');
            out.push({ path: relative(root, full).split(sep).join('/'), content });
          } catch {
            // Unreadable files are skipped, never fatal.
          }
        }
      }
    };
    await walk(root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
}

/** Render a scan result as a human-readable Markdown report. */
export function formatScanReport(result: ScanResult, title = 'Security scan report'): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`**Status:** ${result.pass ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`**Highest severity:** ${result.severity}`);
  lines.push(`**Scanned at:** ${result.scannedAt}`);
  lines.push(`**Files scanned:** ${result.scannedFiles.length}`);
  lines.push('');
  lines.push(
    `**Findings:** ${result.counts.critical} critical · ${result.counts.high} high · ` +
      `${result.counts.medium} medium · ${result.counts.low} low · ${result.counts.info} info`,
  );
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('No issues found. 🎉');
    return lines.join('\n');
  }

  lines.push('| Severity | Category | Location | Finding | Auto-fix |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const f of sortFindings(result.findings)) {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '—';
    lines.push(
      `| ${f.severity} | ${f.category} | ${loc} | ${f.title} | ${f.autoFixable ? 'yes' : 'no'} |`,
    );
  }
  lines.push('');
  lines.push('## Details');
  for (const f of sortFindings(result.findings)) {
    const loc = f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ''}\`)` : '';
    lines.push('');
    lines.push(`### [${f.severity}] ${f.title}${loc}`);
    lines.push(f.detail);
    if (f.evidence) lines.push(`\n> \`${f.evidence}\``);
    if (f.suggestedFix) lines.push(`\n**Suggested fix:** ${f.suggestedFix}`);
  }
  return lines.join('\n');
}

/** Stable, severity-descending order for presentation. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity);
    if (bySeverity !== 0) return bySeverity;
    return (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0);
  });
}
