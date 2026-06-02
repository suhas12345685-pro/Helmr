import type { BudgetLimits } from './budget.js';

/**
 * Resolve budget limits from the environment. Defaults are deliberately
 * conservative so an unconfigured deployment still has a safety ceiling for
 * unattended operation — the Operator raises them explicitly.
 *
 *   HELMR_BUDGET_USD_PER_JOB   (default 2.00)
 *   HELMR_BUDGET_USD_PER_DAY   (default 20.00)
 *   HELMR_MAX_ACTIONS_PER_JOB  (default 200)
 *   HELMR_MAX_JOB_SECONDS      (default 1800 = 30m)
 *   HELMR_TOOL_RATE_PER_MIN    (default 120)
 *
 * A value of `0` (or a negative/invalid value) disables that specific limit.
 */
export const DEFAULT_BUDGET_LIMITS: Required<BudgetLimits> = {
  usdPerJob: 2,
  usdPerDay: 20,
  maxActionsPerJob: 200,
  maxJobSeconds: 1800,
  toolRatePerMin: 120,
};

function num(raw: string | undefined, fallback: number): number | undefined {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  // 0 or negative explicitly disables the limit.
  return parsed > 0 ? parsed : undefined;
}

export function loadBudgetLimits(
  env: Record<string, string | undefined> = process.env,
): BudgetLimits {
  return {
    usdPerJob: num(env['HELMR_BUDGET_USD_PER_JOB'], DEFAULT_BUDGET_LIMITS.usdPerJob),
    usdPerDay: num(env['HELMR_BUDGET_USD_PER_DAY'], DEFAULT_BUDGET_LIMITS.usdPerDay),
    maxActionsPerJob: num(env['HELMR_MAX_ACTIONS_PER_JOB'], DEFAULT_BUDGET_LIMITS.maxActionsPerJob),
    maxJobSeconds: num(env['HELMR_MAX_JOB_SECONDS'], DEFAULT_BUDGET_LIMITS.maxJobSeconds),
    toolRatePerMin: num(env['HELMR_TOOL_RATE_PER_MIN'], DEFAULT_BUDGET_LIMITS.toolRatePerMin),
  };
}
