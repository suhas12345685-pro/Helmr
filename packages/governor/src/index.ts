export {
  BudgetLedger,
  BudgetExceededError,
  InMemoryDailySpendStore,
  type BudgetLimits,
  type BudgetCheck,
  type TrippedLimit,
  type JobBudgetSnapshot,
  type DailySpendStore,
  type BudgetLedgerOptions,
} from './budget.js';
export { FileDailySpendStore } from './file-spend-store.js';
export { loadBudgetLimits, DEFAULT_BUDGET_LIMITS } from './config.js';
export * from './pricing.js';

export interface GovernorPolicy { killSwitch?: boolean; budgetRemainingUsd: number; approvalRequired?: boolean; allowedTools: string[]; allowedChannels: string[] }
export interface GovernorDecision { allowed: boolean; status: 'allowed' | 'approval_required' | 'denied'; reasons: string[]; rollbackRequired?: boolean }
export interface ActionIntent { tool?: string; channel?: string; estimatedCostUsd?: number; writesWorkspace?: boolean; risk: 'low' | 'medium' | 'high' | 'critical' }

export function evaluateGovernor(policy: GovernorPolicy, intent: ActionIntent): GovernorDecision {
  const reasons: string[] = [];
  if (policy.killSwitch) reasons.push('kill switch engaged');
  if ((intent.estimatedCostUsd ?? 0) > policy.budgetRemainingUsd) reasons.push('budget exceeded');
  if (intent.tool && !policy.allowedTools.includes(intent.tool)) reasons.push(`tool not allowed: ${intent.tool}`);
  if (intent.channel && !policy.allowedChannels.includes(intent.channel)) reasons.push(`channel not allowed: ${intent.channel}`);
  if (reasons.length) return { allowed: false, status: 'denied', reasons, rollbackRequired: Boolean(intent.writesWorkspace) };
  if (policy.approvalRequired || ['high', 'critical'].includes(intent.risk)) return { allowed: false, status: 'approval_required', reasons: ['approval required before side effects'] };
  return { allowed: true, status: 'allowed', reasons: [] };
}
