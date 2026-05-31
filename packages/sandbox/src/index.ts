import type { SandboxProfile } from './profiles.js';
import { commandPolicyOf } from './profiles.js';
import { assertCommandAllowed, evaluateCommand, type CommandDecision } from './command-policy.js';
import { assertWithinWorkspace, escapesWorkspace } from './path-jail.js';
import { scrubEnv } from './env-scrub.js';

export * from './path-jail.js';
export * from './command-policy.js';
export * from './env-scrub.js';
export * from './profiles.js';

export interface SandboxSpawnPlan {
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  maxBufferBytes: number;
}

/**
 * Validates a command against a profile and returns the spawn settings the
 * execution plane should use: the jailed cwd, a scrubbed environment, and the
 * profile's resource limits. Throws if the command is denied.
 */
export function prepareSandboxedSpawn(
  profile: SandboxProfile,
  argv: readonly string[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SandboxSpawnPlan {
  assertCommandAllowed(argv, commandPolicyOf(profile));
  return {
    cwd: profile.workspaceRoot,
    env: scrubEnv(env, { allow: profile.allowedEnv }),
    timeoutMs: profile.timeoutMs,
    maxBufferBytes: profile.maxBufferBytes,
  };
}

/** Convenience: command decision for a given profile. */
export function checkCommand(profile: SandboxProfile, argv: readonly string[]): CommandDecision {
  return evaluateCommand(argv, commandPolicyOf(profile));
}

/** Convenience: path-jail check for a given profile. */
export function checkPath(profile: SandboxProfile, targetPath: string): boolean {
  return !escapesWorkspace(profile.workspaceRoot, targetPath);
}

export { assertWithinWorkspace };
