import {
  type Capability,
  type ToolReceipt,
  capabilityDirection,
} from '../../shared/src/index.js';

/**
 * The outward-action gate.
 *
 * Inward, reversible work runs free (`auto`). Outward actions — those that escape
 * the deployment box (network, browser mutations, host installs, registry
 * fetches) — are classified into one of three tiers:
 *
 *   - `auto`     inward; no prompt.
 *   - `standing` outward but a pre-authorized class within declared constraints
 *                (e.g. git push to `claude/*`, an allow-listed host). Runs under
 *                standing approval and is audited as a gate decision.
 *   - `gated`    outward and high-blast-radius (payments, anything unmatched).
 *                Hard stop → awaiting explicit authority, exactly like a plan
 *                approval.
 *
 * The policy is declarative (see StandingApprovalPolicy) so an operator tunes
 * the edges without code changes. The default is fail-safe: every outward action
 * is `gated` until a constraint explicitly promotes it to `standing`.
 */

export type PolicyTier = 'auto' | 'standing' | 'gated';

export interface GateDecision {
  tier: PolicyTier;
  reason: string;
}

/** Constraints that promote a specific outward capability to `standing`. */
export interface OutwardRule {
  /** Force `gated` no matter what (e.g. payments). */
  alwaysGated?: boolean;
  /** Branch globs allowed for push-like actions (e.g. ["claude/*"]). */
  allowBranches?: string[];
  /** Branch globs explicitly denied (takes precedence, e.g. ["main"]). */
  denyBranches?: string[];
  /** Hosts allowed for network actions (exact or "*.example.com"). */
  allowHosts?: string[];
}

export interface StandingApprovalPolicy {
  /** Per-capability standing rules. A capability with no rule stays `gated`. */
  rules: Partial<Record<Capability, OutwardRule>>;
}

/** Fail-safe default: no standing authority — every outward action is gated. */
export const DEFAULT_STANDING_POLICY: StandingApprovalPolicy = { rules: {} };

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesAny(value: string, globs: string[] | undefined): boolean {
  return Boolean(globs?.some((g) => globToRegExp(g).test(value)));
}

function hostAllowed(host: string, allowHosts: string[] | undefined): boolean {
  if (!allowHosts || allowHosts.length === 0) return false;
  return allowHosts.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".example.com"
      return host === pattern.slice(2) || host.endsWith(suffix);
    }
    return host === pattern;
  });
}

function extractHost(input: Record<string, unknown>): string | undefined {
  const raw = (input['url'] ?? input['host'] ?? input['endpoint']) as string | undefined;
  if (!raw) return undefined;
  try {
    return new URL(raw).host;
  } catch {
    return typeof raw === 'string' ? raw : undefined;
  }
}

/**
 * Classify a receipt into a policy tier. Inward → `auto`. Outward → `standing`
 * only when an explicit rule's constraints are satisfied, else `gated`.
 */
export function gateToolReceipt(
  receipt: ToolReceipt,
  policy: StandingApprovalPolicy = DEFAULT_STANDING_POLICY,
): GateDecision {
  if (capabilityDirection(receipt.capability) === 'inward') {
    return { tier: 'auto', reason: `${receipt.capability} is inward (contained); runs automatically` };
  }

  const rule = policy.rules[receipt.capability];
  if (!rule || rule.alwaysGated) {
    return {
      tier: 'gated',
      reason: rule?.alwaysGated
        ? `${receipt.capability} is always gated by policy`
        : `${receipt.capability} is outward with no standing authority`,
    };
  }

  const input = (receipt.input ?? {}) as Record<string, unknown>;
  const branch = (input['branch'] ?? input['ref']) as string | undefined;
  const host = extractHost(input);

  // Push-like receipts carry a branch: evaluate branch constraints when declared.
  if (typeof branch === 'string') {
    if (matchesAny(branch, rule.denyBranches)) {
      return { tier: 'gated', reason: `branch "${branch}" is denied for standing ${receipt.capability}` };
    }
    if (rule.allowBranches) {
      return matchesAny(branch, rule.allowBranches)
        ? { tier: 'standing', reason: `branch "${branch}" matches standing allow-list` }
        : { tier: 'gated', reason: `branch "${branch}" not in standing allow-list` };
    }
  }

  // HTTP-like receipts carry a host: evaluate host constraints when declared.
  if (typeof host === 'string' && rule.allowHosts) {
    return hostAllowed(host, rule.allowHosts)
      ? { tier: 'standing', reason: `host "${host}" matches standing allow-list` }
      : { tier: 'gated', reason: `host "${host}" not in standing allow-list` };
  }

  // The rule declared constraints but this receipt's subject isn't covered by
  // them — fail safe rather than grant blanket authority.
  if (rule.allowBranches || rule.denyBranches || rule.allowHosts) {
    return { tier: 'gated', reason: `${receipt.capability} receipt not covered by standing constraints` };
  }

  // A rule with no constraints grants blanket standing authority.
  return { tier: 'standing', reason: `${receipt.capability} granted standing authority by policy` };
}
