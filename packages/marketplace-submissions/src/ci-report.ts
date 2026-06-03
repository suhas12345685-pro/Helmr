import { formatScanReport } from '../../security-scanner/src/index.js';
import type { PipelineResult } from './pipeline.js';

/** One submission's CI outcome, ready to turn into labels + a PR comment. */
export interface SubmissionCiResult {
  id: string;
  path: string;
  pipeline: PipelineResult;
}

/**
 * Map a set of submission pipeline results to the GitHub labels a marketplace PR
 * should carry. Labels are derived purely from the decisions, so the automation
 * is deterministic and auditable.
 */
export function deriveLabels(results: SubmissionCiResult[]): string[] {
  const labels = new Set<string>(['marketplace']);
  for (const { pipeline } of results) {
    const kind = pipeline.validation.manifest?.kind ?? 'skill';
    labels.add(kind);
    if (pipeline.decision === 'FAIL') labels.add('security-failed');
    if (pipeline.decision === 'NEEDS_REVIEW') labels.add('needs-review');
    if (pipeline.decision === 'PASS') labels.add('verified-candidate');
  }
  return [...labels];
}

/** True when at least one submission has a critical/high finding (block merge). */
export function shouldBlockMerge(results: SubmissionCiResult[]): boolean {
  return results.some(
    (r) => r.pipeline.scan.counts.critical > 0 || r.pipeline.scan.counts.high > 0,
  );
}

/** Render the full PR comment body summarising every scanned submission. */
export function renderPrComment(results: SubmissionCiResult[]): string {
  const lines: string[] = [];
  lines.push('## 🛡️ Helmr marketplace security review');
  lines.push('');
  if (results.length === 0) {
    lines.push('No marketplace submissions detected in this PR.');
    return lines.join('\n');
  }

  const blocked = shouldBlockMerge(results);
  lines.push(
    blocked
      ? '**Merge is blocked**: one or more submissions failed the security scan.'
      : '**No critical or high findings** that block merge.',
  );
  lines.push('');
  lines.push('| Submission | Decision | Scan | Highest severity | Findings |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const { id, pipeline } of results) {
    const c = pipeline.scan.counts;
    lines.push(
      `| \`${id}\` | ${badge(pipeline.decision)} | ${pipeline.scan.pass ? 'pass' : 'fail'} | ` +
        `${pipeline.scan.severity} | ${c.critical}C / ${c.high}H / ${c.medium}M / ${c.low}L |`,
    );
  }
  lines.push('');

  for (const { id, pipeline } of results) {
    lines.push(`<details><summary>Scan report: <code>${id}</code></summary>`);
    lines.push('');
    lines.push(formatScanReport(pipeline.scan, `Scan: ${id}`));
    if (pipeline.reasons.length > 0) {
      lines.push('');
      lines.push('**Decision reasons:**');
      for (const reason of pipeline.reasons) lines.push(`- ${reason}`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  return lines.join('\n');
}

function badge(decision: PipelineResult['decision']): string {
  switch (decision) {
    case 'PASS':
      return '✅ PASS';
    case 'FAIL':
      return '❌ FAIL';
    case 'NEEDS_REVIEW':
      return '🔍 NEEDS_REVIEW';
  }
}
