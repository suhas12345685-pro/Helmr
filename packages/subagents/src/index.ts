import type { HelmrPlan, PlanStep } from '../../shared/src/index.js';
import { computeParallelBatches } from './parallel-groups.js';
import { runWithConcurrency } from './pool.js';

export * from './parallel-groups.js';
export * from './pool.js';

export interface SubagentStepResult<R> {
  stepId: string;
  ok: boolean;
  output?: R;
  error?: string;
}

export interface ExecutePlanStepsOptions {
  /** Max concurrent steps within a single parallel batch. */
  concurrency?: number;
  /** Keep going after a step fails (default true) so partial results survive. */
  continueOnError?: boolean;
  onStepStart?: (step: PlanStep) => void;
}

/**
 * Executes a plan's steps batch by batch. Steps that are mutually declared as
 * parallel run concurrently (bounded by `concurrency`); everything else runs in
 * order. Results are returned both as an ordered list and as a step-id map so
 * callers can synthesise a final answer.
 */
export async function executePlanSteps<R>(
  plan: HelmrPlan,
  runStep: (step: PlanStep) => Promise<R>,
  options: ExecutePlanStepsOptions = {},
): Promise<{ results: Array<SubagentStepResult<R>>; outputs: Record<string, R> }> {
  const concurrency = options.concurrency ?? 4;
  const continueOnError = options.continueOnError ?? true;

  const batches = computeParallelBatches(plan.steps);
  const results: Array<SubagentStepResult<R>> = [];
  const outputs: Record<string, R> = {};

  for (const batch of batches) {
    const batchResults = await runWithConcurrency(
      batch,
      async (step): Promise<SubagentStepResult<R>> => {
        options.onStepStart?.(step);
        try {
          const output = await runStep(step);
          return { stepId: step.id, ok: true, output };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          if (!continueOnError) {
            throw err;
          }
          return { stepId: step.id, ok: false, error };
        }
      },
      concurrency,
    );

    for (const result of batchResults) {
      results.push(result);
      if (result.ok && result.output !== undefined) {
        outputs[result.stepId] = result.output;
      }
    }
  }

  return { results, outputs };
}
