import {
  type HelmrPlan,
  type ToolReceipt,
  isApprovalGatedCapability,
} from '../../shared/src/index.js';

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
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
