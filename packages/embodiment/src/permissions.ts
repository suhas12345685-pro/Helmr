/**
 * Permission zones for embodied agents.
 *
 * Agents do not get unlimited access by default. Before an agent can drive a
 * browser/app/files, the zone for that action must be granted. Dangerous actions
 * require explicit user approval no matter what.
 */

export type PermissionZone =
  | 'read_only'
  | 'browser_safe'
  | 'workspace_only'
  | 'local_files_read'
  | 'local_files_write'
  | 'external_network'
  | 'dangerous_action_requires_user_approval';

export type PermissionSet = ReadonlySet<PermissionZone>;

/** Conservative default: an agent can look and act inside its own workspace. */
export const DEFAULT_PERMISSION_ZONES: PermissionZone[] = ['read_only', 'workspace_only'];

export function permissionSet(zones: Iterable<PermissionZone> = DEFAULT_PERMISSION_ZONES): PermissionSet {
  return new Set(zones);
}

export class PermissionDeniedError extends Error {
  constructor(
    public readonly zone: PermissionZone,
    public readonly action: string,
  ) {
    super(`permission denied: "${action}" requires zone "${zone}"`);
    this.name = 'PermissionDeniedError';
  }
}

export function hasPermission(set: PermissionSet, zone: PermissionZone): boolean {
  return set.has(zone);
}

/** Throw unless the zone is granted. Used to guard virtual input + navigation. */
export function assertPermission(set: PermissionSet, zone: PermissionZone, action: string): void {
  if (!set.has(zone)) {
    throw new PermissionDeniedError(zone, action);
  }
}

/**
 * Whether an action must be escalated to the user. An action flagged dangerous
 * is allowed inline only if the dangerous-action zone is explicitly granted;
 * otherwise it requires user approval.
 */
export function requiresUserApproval(set: PermissionSet, dangerous: boolean): boolean {
  if (!dangerous) return false;
  return !set.has('dangerous_action_requires_user_approval');
}
