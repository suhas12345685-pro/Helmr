/**
 * Bug triage: turn a free-form bug report into a structured, actionable record.
 *
 * The flow Helmr follows for every bug is: classify severity → confirm there is
 * enough to reproduce (ask for a repro if not) → generate a failing test when
 * possible → only then open a fix branch and run all checks before a PR. This
 * module owns the classification and the gating logic; the CLI and the GitHub
 * automation drive the side effects (opening branches, running checks).
 */

export type BugSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface BugReportInput {
  title: string;
  description: string;
  /** Steps to reproduce, if the reporter provided them. */
  steps?: string[];
  /** What the reporter expected to happen. */
  expected?: string;
  /** What actually happened. */
  actual?: string;
  /** The capability/skill id this bug is about, if any. */
  capabilityId?: string;
  /** Affected version. */
  version?: string;
  reporter?: string;
}

export interface BugReport {
  id: string;
  input: BugReportInput;
  severity: BugSeverity;
  /** Whether we have enough information to attempt a reproduction. */
  reproducible: boolean;
  /** What's missing, when not reproducible. */
  missingInfo: string[];
  labels: string[];
  createdAt: string;
}

const CRITICAL_SIGNALS = [
  'data loss',
  'leak',
  'exfiltrat',
  'rce',
  'remote code',
  'security',
  'credential',
  'corrupt',
  'crash on start',
];
const HIGH_SIGNALS = ['crash', 'cannot install', 'hang', 'deadlock', 'kill-switch', 'fails to', 'broken'];
const LOW_SIGNALS = ['typo', 'cosmetic', 'wording', 'docs', 'documentation', 'log message'];

/** Classify severity from the report text using weighted signals. */
export function classifySeverity(input: BugReportInput): BugSeverity {
  const haystack = `${input.title} ${input.description} ${input.actual ?? ''}`.toLowerCase();
  if (CRITICAL_SIGNALS.some((s) => haystack.includes(s))) return 'critical';
  if (HIGH_SIGNALS.some((s) => haystack.includes(s))) return 'high';
  if (LOW_SIGNALS.some((s) => haystack.includes(s))) return 'low';
  return 'medium';
}

/** Decide whether the report has enough to attempt a reproduction. */
export function assessReproducibility(input: BugReportInput): {
  reproducible: boolean;
  missingInfo: string[];
} {
  const missing: string[] = [];
  if (!input.steps || input.steps.length === 0) missing.push('steps to reproduce');
  if (!input.expected) missing.push('expected behaviour');
  if (!input.actual) missing.push('actual behaviour');
  // Reproducible when we have steps plus at least one of expected/actual.
  const reproducible = (input.steps?.length ?? 0) > 0 && (!!input.expected || !!input.actual);
  return { reproducible, missingInfo: missing };
}

export function triageBug(input: BugReportInput, id?: string): BugReport {
  const severity = classifySeverity(input);
  const { reproducible, missingInfo } = assessReproducibility(input);
  const labels = ['bug', `severity:${severity}`];
  if (!reproducible) labels.push('needs-reproduction');
  if (input.capabilityId) labels.push('marketplace');
  return {
    id: id ?? `bug-${Date.now()}`,
    input,
    severity,
    reproducible,
    missingInfo,
    labels,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Whether Helmr may open a fix branch automatically for this bug. We only do so
 * when the bug is reproducible and not security-critical: critical/security bugs
 * always need a human in the loop before any automated change.
 */
export function canAutoOpenFixBranch(report: BugReport): { allowed: boolean; reason: string } {
  if (!report.reproducible) {
    return { allowed: false, reason: 'Not reproducible: missing ' + report.missingInfo.join(', ') };
  }
  if (report.severity === 'critical') {
    return { allowed: false, reason: 'Critical/security bug requires human review before automation.' };
  }
  return { allowed: true, reason: 'Reproducible and within automation risk bounds.' };
}

/** A suggested branch name for a fix, derived from the bug id and title. */
export function fixBranchName(report: BugReport): string {
  const slug = report.input.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `bugfix/${report.id}-${slug || 'fix'}`;
}

/**
 * Generate a failing test scaffold from the report. This produces a Node test
 * that documents the expected behaviour and fails until the bug is fixed —
 * "generate a failing test if possible" from the triage flow.
 */
export function generateFailingTest(report: BugReport): string {
  const { input } = report;
  const safeTitle = input.title.replace(/'/g, "\\'");
  const expected = input.expected ?? 'the documented behaviour';
  const actual = input.actual ?? 'the buggy behaviour';
  const stepsComment = (input.steps ?? ['(no steps provided)'])
    .map((s, i) => ` *   ${i + 1}. ${s}`)
    .join('\n');
  return `import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Regression test for ${report.id} (${report.severity}).
 * ${safeTitle}
 *
 * Steps to reproduce:
${stepsComment}
 *
 * Expected: ${expected}
 * Actual:   ${actual}
 */
test('${report.id}: ${safeTitle}', () => {
  // TODO: replace this scaffold with a concrete reproduction.
  // It is written to FAIL until the bug is fixed.
  const fixed = false;
  assert.ok(fixed, 'Expected ${expected}, but got ${actual}');
});
`;
}
