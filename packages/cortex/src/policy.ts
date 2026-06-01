import {
  type HelmrPlan,
  type ToolReceipt,
  type Capability,
  type PlanRisk,
  type PrincipalTrustLevel,
  isApprovalGatedCapability,
  isOutwardCapability,
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

/**
 * The autonomy tier of an action under the "Own Body, Guarded Edge" model
 * (docs/autonomy-roadmap.md):
 *   - `auto`     inward, reversible — runs on the agent's own initiative.
 *   - `standing` outward but a pre-authorized class — runs without a prompt,
 *                within budget.
 *   - `gated`    outward / high-blast-radius — hard stop until explicit authority.
 */
export type PolicyTier = 'auto' | 'standing' | 'gated';

/**
 * Which outward capabilities the Operator has pre-authorized to run under
 * standing approval. Everything outward not listed here is `gated`.
 */
export interface OutwardPolicy {
  standing: Set<Capability>;
}

export function resolveOutwardPolicy(
  env: Record<string, string | undefined> = process.env,
): OutwardPolicy {
  const raw = env['HELMR_STANDING_OUTWARD']?.trim();
  const standing = new Set<Capability>();
  if (raw) {
    for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      standing.add(part as Capability);
    }
  }
  return { standing };
}

export interface TierDecision extends PolicyDecision {
  tier: PolicyTier;
}

/**
 * Classify a receipt into an autonomy tier and decide whether it may run without
 * pausing. Inward approval-gated writes keep their existing gated behavior;
 * outward capabilities are `standing` (pre-authorized) or `gated`.
 */
export function evaluateAutonomousReceipt(
  receipt: ToolReceipt,
  policy: OutwardPolicy = resolveOutwardPolicy(),
): TierDecision {
  if (isOutwardCapability(receipt.capability)) {
    if (receipt.approval === 'approved') {
      return { tier: 'standing', allowed: true, requiresApproval: false, reasons: [] };
    }
    if (policy.standing.has(receipt.capability)) {
      return { tier: 'standing', allowed: true, requiresApproval: false, reasons: [] };
    }
    return {
      tier: 'gated',
      allowed: false,
      requiresApproval: true,
      reasons: [`${receipt.capability} is an outward action and requires explicit authority`],
    };
  }

  const base = evaluateToolReceipt(receipt);
  const tier: PolicyTier = isApprovalGatedCapability(receipt.capability) ? 'gated' : 'auto';
  return { ...base, tier };
}
