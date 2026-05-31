import type { Capability } from '../../shared/src/index.js';

export type SandboxMode = 'disabled' | 'readonly' | 'write' | 'exclusive';

export interface SandboxPolicy {
  mode: SandboxMode;
  allowedCapabilities: Capability[];
}

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  mode: 'readonly',
  allowedCapabilities: ['workspace_read', 'shell_read', 'git_read'],
};

export function capabilityAllowedBySandbox(policy: SandboxPolicy, capability: Capability): boolean {
  if (policy.mode === 'disabled') return false;
  return policy.allowedCapabilities.includes(capability);
}
