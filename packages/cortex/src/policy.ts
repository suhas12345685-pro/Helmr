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
 * Helmr "understands momentum" — for the owner, low-risk self-extension
 * (creating a skill) can carry standing approval so it feels automatic, while
 * still being a gated capability for anyone less trusted. Set
 * HELMR_SKILL_AUTONOMY=manual to require an explicit approval every time.
 */
export type SkillAutonomy = 'standing' | 'manual';

export function getSkillAutonomy(
  env: Record<string, string | undefined> = process.env,
): SkillAutonomy {
  return env['HELMR_SKILL_AUTONOMY']?.trim().toLowerCase() === 'manual' ? 'manual' : 'standing';
}

export interface StandingApprovalContext {
  trustLevel: PrincipalTrustLevel;
  autonomy: SkillAutonomy;
}

/**
 * Whether the owner has standing approval for this operation, so it can run
 * without pausing for an explicit confirmation. Deliberately narrow: only the
 * owner, only when autonomy is standing, only low-risk skill writes.
 */
export function hasStandingApproval(
  op: { capability: Capability; risk: PlanRisk },
  context: StandingApprovalContext,
): boolean {
  return (
    context.autonomy === 'standing' &&
    context.trustLevel === 'owner' &&
    op.capability === 'skill_write' &&
    op.risk === 'low'
  );
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
