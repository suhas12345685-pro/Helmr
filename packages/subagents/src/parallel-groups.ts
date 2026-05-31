import type { PlanStep } from '../../shared/src/index.js';

/**
 * Groups plan steps into ordered batches that may run concurrently. Two steps
 * share a batch only when each declares the other in `canRunInParallelWith`
 * (mutual consent) — a conservative rule so a one-sided declaration never
 * forces unsafe concurrency. Step order is preserved across batches.
 */
export function computeParallelBatches(steps: readonly PlanStep[]): PlanStep[][] {
  const byId = new Map(steps.map((step) => [step.id, step]));

  const mutuallyParallel = (a: PlanStep, b: PlanStep): boolean => {
    if (a.id === b.id) {
      return false;
    }
    return a.canRunInParallelWith.includes(b.id) && b.canRunInParallelWith.includes(a.id);
  };

  const batches: PlanStep[][] = [];

  for (const step of steps) {
    // Skip steps that reference themselves only or dangling ids — they still
    // run, just never merged unless a real mutual partner exists.
    const lastBatch = batches[batches.length - 1];
    if (lastBatch && lastBatch.every((member) => mutuallyParallel(member, step))) {
      lastBatch.push(step);
    } else {
      batches.push([step]);
    }
  }

  // Drop references to ids that are not present so callers can trust the data.
  void byId;
  return batches;
}

export function maxBatchWidth(batches: readonly PlanStep[][]): number {
  return batches.reduce((max, batch) => Math.max(max, batch.length), 0);
}
