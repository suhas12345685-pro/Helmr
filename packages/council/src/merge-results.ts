import type { HelmrPlan, PlanStep } from '../../shared/src/index.js';

export interface SubResult {
  stepId: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface CouncilReportSection {
  stepId: string;
  title: string;
  status: 'ok' | 'failed' | 'missing';
  detail: string;
}

export interface CouncilReport {
  summary: string;
  risk: HelmrPlan['risk'];
  completed: number;
  failed: number;
  missing: number;
  sections: CouncilReportSection[];
}

function stringifyOutput(output: unknown): string {
  if (output === undefined || output === null) {
    return '';
  }
  if (typeof output === 'string') {
    return output;
  }
  if (typeof output === 'object') {
    const shell = output as { stdout?: unknown; stderr?: unknown };
    if (typeof shell.stdout === 'string' || typeof shell.stderr === 'string') {
      return [shell.stdout, shell.stderr].filter((v) => typeof v === 'string').join('\n');
    }
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }
  return String(output);
}

function truncate(text: string, max = 600): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Builds a deterministic, structured report from a plan and its sub-results.
 * This is the Council's "merge sub-results" responsibility (core flow step 12)
 * expressed as plain, replayable code rather than a model call.
 */
export function buildCouncilReport(plan: HelmrPlan, results: readonly SubResult[]): CouncilReport {
  const byStep = new Map(results.map((r) => [r.stepId, r]));
  const sections: CouncilReportSection[] = [];

  let completed = 0;
  let failed = 0;
  let missing = 0;

  for (const step of plan.steps) {
    const result = byStep.get(step.id);
    if (!result) {
      missing++;
      sections.push({ stepId: step.id, title: step.title, status: 'missing', detail: 'not executed' });
      continue;
    }
    if (result.ok) {
      completed++;
      sections.push({
        stepId: step.id,
        title: step.title,
        status: 'ok',
        detail: truncate(stringifyOutput(result.output)) || '(no output)',
      });
    } else {
      failed++;
      sections.push({
        stepId: step.id,
        title: step.title,
        status: 'failed',
        detail: result.error ?? 'failed',
      });
    }
  }

  return { summary: plan.summary, risk: plan.risk, completed, failed, missing, sections };
}

/** Renders a Council report as a Markdown answer suitable for the CLI/Hatchery. */
export function renderCouncilReport(report: CouncilReport, request?: string): string {
  const lines: string[] = ['# Result', ''];
  if (request) {
    lines.push(`Request: ${request}`, '');
  }
  lines.push(report.summary, '');
  lines.push(
    `Steps: ${report.completed} succeeded, ${report.failed} failed, ${report.missing} not run (risk: ${report.risk}).`,
    '',
    '## Step Details',
    '',
  );
  for (const section of report.sections) {
    const marker = section.status === 'ok' ? '✓' : section.status === 'failed' ? '✗' : '·';
    lines.push(`### ${marker} ${section.title} (${section.stepId})`);
    lines.push(section.detail || '(no output)');
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** Convenience: merge sub-results straight into a rendered answer. */
export function mergeSubResults(
  plan: HelmrPlan,
  results: readonly SubResult[],
  request?: string,
): string {
  return renderCouncilReport(buildCouncilReport(plan, results), request);
}

export function planStepIds(plan: HelmrPlan): string[] {
  return plan.steps.map((step: PlanStep) => step.id);
}
