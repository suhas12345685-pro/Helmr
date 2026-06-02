import { join } from 'node:path';

import { BudgetLedger, FileDailySpendStore, loadBudgetLimits } from '../packages/governor/src/index.js';
import { getHelmrPaths } from './paths.js';

/**
 * Process-wide budget ledger.
 *
 * Like the agent runtime, the ledger is shared so every job in the process
 * accounts spend against the same per-day total. The daily total is persisted
 * under the data dir, so a restart does not reset the day's spend — the per-day
 * USD cap stays meaningful for unattended operation.
 */

let shared: BudgetLedger | undefined;

export function getBudgetLedger(): BudgetLedger {
  if (!shared) {
    const paths = getHelmrPaths();
    shared = new BudgetLedger({
      limits: loadBudgetLimits(),
      dailyStore: new FileDailySpendStore(join(paths.dataDir, 'budget-spend.json')),
    });
  }
  return shared;
}

/** Test helper: drop the singleton so the next getBudgetLedger() rebuilds it. */
export function resetBudgetLedger(): void {
  shared = undefined;
}
