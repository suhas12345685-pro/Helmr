import type { Finding, ScanFile, ScanResult } from './types.js';
import { sortFindings } from './scanner.js';

export interface FixSuggestion {
  finding: Finding;
  /** Whether Helmr can apply this fix automatically without human judgement. */
  autoFixable: boolean;
  /** Human-readable remediation text. */
  guidance: string;
}

export interface FixReport {
  total: number;
  autoFixable: number;
  manual: number;
  suggestions: FixSuggestion[];
}

/**
 * Turn a scan result into an actionable fix report: one suggestion per finding,
 * partitioned into what Helmr can patch automatically versus what needs a human.
 * This backs `helmr marketplace fix` and the PR auto-fix flow.
 */
export function buildFixReport(result: ScanResult): FixReport {
  const suggestions: FixSuggestion[] = sortFindings(result.findings).map((finding) => ({
    finding,
    autoFixable: finding.autoFixable,
    guidance:
      finding.suggestedFix ??
      'Review this finding and remediate manually; no automatic fix is available.',
  }));
  const autoFixable = suggestions.filter((s) => s.autoFixable).length;
  return {
    total: suggestions.length,
    autoFixable,
    manual: suggestions.length - autoFixable,
    suggestions,
  };
}

/**
 * Apply the auto-fixable findings to in-memory files, returning the patched
 * files plus the list of findings that were actually fixed. Currently the only
 * safe automatic fix is neutralising an inline secret literal: the credential is
 * replaced with a placeholder so it stops shipping, while leaving the structure
 * intact for the author to wire up a real secret reference.
 */
export function applyAutoFixes(
  files: ScanFile[],
  result: ScanResult,
): { files: ScanFile[]; fixed: Finding[] } {
  const fixed: Finding[] = [];
  const byPath = new Map(files.map((f) => [f.path, f.content] as const));

  for (const finding of result.findings) {
    if (!finding.autoFixable || !finding.file) continue;
    const content = byPath.get(finding.file);
    if (content === undefined) continue;

    if (finding.category === 'secret') {
      // Replace the literal with an env reference (no string literal), so the
      // credential stops shipping *and* the inline-secret pattern no longer
      // matches the result — a clean re-scan confirms the fix.
      const redacted = content.replace(
        /(\b(?:api[_-]?key|secret|password|passwd|token|auth[_-]?token)\b\s*[:=]\s*)(["'])[^"']{8,}\2/gi,
        '$1process.env.REPLACE_WITH_DECLARED_SECRET',
      );
      if (redacted !== content) {
        byPath.set(finding.file, redacted);
        fixed.push(finding);
      }
    }
  }

  return {
    files: files.map((f) => ({ path: f.path, content: byPath.get(f.path) ?? f.content })),
    fixed,
  };
}

/** Render a fix report as Markdown for the CLI and PR comments. */
export function formatFixReport(report: FixReport): string {
  const lines: string[] = [];
  lines.push('# Fix report');
  lines.push('');
  lines.push(
    `${report.total} finding(s): ${report.autoFixable} auto-fixable, ${report.manual} manual.`,
  );
  lines.push('');
  for (const s of report.suggestions) {
    const loc = s.finding.file
      ? `${s.finding.file}${s.finding.line ? `:${s.finding.line}` : ''}`
      : '—';
    lines.push(`- **[${s.finding.severity}] ${s.finding.title}** (${loc})`);
    lines.push(`  - ${s.guidance}`);
    lines.push(`  - Auto-fixable: ${s.autoFixable ? 'yes' : 'no'}`);
  }
  return lines.join('\n');
}
