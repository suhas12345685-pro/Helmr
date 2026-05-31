import { resolve } from 'node:path';

import type { CommandPolicy, NetworkPolicy } from './command-policy.js';
import { DEFAULT_ALLOWED_ENV } from './env-scrub.js';

/** Sandbox levels mirror the workspace lock levels in the architecture. */
export type SandboxLevel = 'read' | 'write' | 'exclusive';

export interface SandboxProfile {
  name: string;
  level: SandboxLevel;
  workspaceRoot: string;
  network: NetworkPolicy;
  allowedCommands: ReadonlyArray<readonly string[]>;
  allowedEnv: readonly string[];
  timeoutMs: number;
  maxBufferBytes: number;
}

const READ_COMMANDS: ReadonlyArray<readonly string[]> = [
  ['node', '--version'],
  ['npm', '--version'],
  ['git', 'status'],
  ['git', 'log'],
  ['git', 'diff'],
  ['git', 'show'],
  ['git', 'rev-parse'],
  ['ls'],
  ['cat'],
];

const WRITE_COMMANDS: ReadonlyArray<readonly string[]> = [
  ...READ_COMMANDS,
  ['npm', 'install'],
  ['npm', 'ci'],
  ['npm', 'run'],
  ['npx', 'tsc'],
  ['git', 'add'],
  ['git', 'commit'],
  ['git', 'checkout'],
  ['git', 'stash'],
  ['mkdir'],
];

const EXCLUSIVE_COMMANDS: ReadonlyArray<readonly string[]> = [
  ...WRITE_COMMANDS,
  ['git', 'push'],
  ['rm'],
];

const BASE: Record<SandboxLevel, Omit<SandboxProfile, 'workspaceRoot'>> = {
  read: {
    name: 'read',
    level: 'read',
    network: 'denied',
    allowedCommands: READ_COMMANDS,
    allowedEnv: DEFAULT_ALLOWED_ENV,
    timeoutMs: 30_000,
    maxBufferBytes: 1024 * 1024,
  },
  write: {
    name: 'write',
    level: 'write',
    network: 'denied',
    allowedCommands: WRITE_COMMANDS,
    allowedEnv: DEFAULT_ALLOWED_ENV,
    timeoutMs: 120_000,
    maxBufferBytes: 4 * 1024 * 1024,
  },
  exclusive: {
    name: 'exclusive',
    level: 'exclusive',
    network: 'allowed',
    allowedCommands: EXCLUSIVE_COMMANDS,
    allowedEnv: DEFAULT_ALLOWED_ENV,
    timeoutMs: 300_000,
    maxBufferBytes: 8 * 1024 * 1024,
  },
};

/** Builds a sandbox profile for a workspace at the requested isolation level. */
export function createSandboxProfile(
  level: SandboxLevel,
  workspaceRoot: string,
): SandboxProfile {
  const base = BASE[level];
  return { ...base, workspaceRoot: resolve(workspaceRoot) };
}

/** Extracts the command policy slice of a profile. */
export function commandPolicyOf(profile: SandboxProfile): CommandPolicy {
  return { allowedCommands: profile.allowedCommands, network: profile.network };
}
