import {
  type HelmrPlan,
  type ToolReceipt,
  type Capability,
  type PlanRisk,
  type PrincipalTrustLevel,
  isApprovalGatedCapability,
} from '../../shared/src/index.js';

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
}

/**
 * Trust-calibrated autonomy for self-extension.
 *
 * Helmr is an employee, not an intern — for the owner it self-extends (creates
 * and updates skills) on its own initiative. The default is `autonomous`. Dial
 * it back with HELMR_SKILL_AUTONOMY: `standing` limits auto-approval to
 * low-risk skill writes, `manual` requires an explicit approval every time.
 */
export type SkillAutonomy = 'autonomous' | 'standing' | 'manual';

export function getSkillAutonomy(
  env: Record<string, string | undefined> = process.env,
): SkillAutonomy {
  const raw = env['HELMR_SKILL_AUTONOMY']?.trim().toLowerCase();
  if (raw === 'manual') return 'manual';
  if (raw === 'standing') return 'standing';
  return 'autonomous';
}

export interface StandingApprovalContext {
  trustLevel: PrincipalTrustLevel;
  autonomy: SkillAutonomy;
}

/**
 * Whether the owner has standing approval for this operation, so it runs without
 * pausing for an explicit confirmation. Scoped to the owner and to self-extension
 * (skill_write): `autonomous` covers any risk, `standing` only low risk.
 */
export function hasStandingApproval(
  op: { capability: Capability; risk: PlanRisk },
  context: StandingApprovalContext,
): boolean {
  if (context.autonomy === 'manual') return false;
  if (context.trustLevel !== 'owner') return false;
  if (op.capability !== 'skill_write') return false;
  return context.autonomy === 'autonomous' || op.risk === 'low';
}

export function evaluatePlan(plan: HelmrPlan): PolicyDecision {
  const gatedCapabilities = plan.steps.flatMap((step) =>
    step.requiredCapabilities.filter(isApprovalGatedCapability),
  );

  if (gatedCapabilities.length === 0) {
    return { allowed: true, requiresApproval: false, reasons: [] };
  }

  return {
    allowed: false,
    requiresApproval: true,
    reasons: gatedCapabilities.map((capability) => `${capability} requires approval`),
  };
}

export function evaluateToolReceipt(receipt: ToolReceipt): PolicyDecision {
  if (!isApprovalGatedCapability(receipt.capability)) {
    return { allowed: true, requiresApproval: false, reasons: [] };
  }

  if (receipt.approval === 'approved') {
    return { allowed: true, requiresApproval: true, reasons: [] };
  }

  return {
    allowed: false,
    requiresApproval: true,
    reasons: [`${receipt.capability} is gated and approval is ${receipt.approval}`],
  };
}
