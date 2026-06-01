import type { Capability } from './contracts.js';

/**
 * Inward vs outward capability classification — the spine of the "Own Body,
 * Guarded Edge" autonomy model (see docs/autonomy-roadmap.md).
 *
 * A deployment body (sandbox / PC / VPS) contains everything *inward*: actions
 * whose blast radius stays inside the box (reading/writing the workspace, local
 * shell, local git, installing into the box). Those run on the agent's own
 * initiative.
 *
 * *Outward* capabilities escape the box — they reach the network, the web, or
 * the host's service layer, and can therefore spend money, message third
 * parties, or take effects that no isolation can undo. Those are the edges that
 * the outward-action gate governs even under full autonomy.
 */
export type CapabilityDirection = 'inward' | 'outward';

const OUTWARD_CAPABILITIES = new Set<Capability>([
  // Arbitrary network egress: can call paid APIs, exfiltrate, hit third parties.
  'network',
  // Browser automation reaches the live web (and any WebMCP tool a page exposes).
  'browser',
  // Changes the host's service layer beyond the workspace.
  'service_install',
]);

export function capabilityDirection(capability: Capability): CapabilityDirection {
  return OUTWARD_CAPABILITIES.has(capability) ? 'outward' : 'inward';
}

export function isOutwardCapability(capability: Capability): boolean {
  return capabilityDirection(capability) === 'outward';
}

export function isInwardCapability(capability: Capability): boolean {
  return capabilityDirection(capability) === 'inward';
}

/** The outward capabilities present in a set of required capabilities. */
export function outwardCapabilities(capabilities: readonly Capability[]): Capability[] {
  return capabilities.filter(isOutwardCapability);
}
