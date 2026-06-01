import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Checkpoint & rollback — one of the four edge boundaries
 * (docs/phase1-implementation-plan.md). Deployment isolation protects the
 * Operator's *other* stuff, but the work-in-progress lives inside the box with
 * the agent. A checkpoint taken before a write-batch makes an autonomous mistake
 * one call to revert, so reversible work can run fully autonomously: a slip just
 * rewinds.
 *
 * The snapshot is a filesystem copy (excluding regenerable `node_modules`),
 * which works for both git and non-git workspaces. A git-native, content-addressed
 * checkpoint is a future optimization for large repos.
 */
const EXCLUDED_DIRS = new Set(['node_modules']);

export interface Checkpoint {
  id: string;
  workspacePath: string;
  snapshotPath: string;
  createdAt: string;
}

function excludesNodeModules(source: string): boolean {
  const segments = source.split(/[\\/]/);
  return !segments.some((segment) => EXCLUDED_DIRS.has(segment));
}

/**
 * Filter used when snapshotting the workspace: skip node_modules and never copy
 * the snapshot directory into itself (it may live under the workspace root).
 */
function createFilter(snapshotPath: string): (source: string) => boolean {
  return (source: string): boolean => {
    if (source === snapshotPath || source.startsWith(`${snapshotPath}/`)) return false;
    return excludesNodeModules(source);
  };
}

export async function createCheckpoint(
  workspacePath: string,
  snapshotRoot: string,
): Promise<Checkpoint> {
  const id = `ckpt_${randomUUID()}`;
  const snapshotPath = join(snapshotRoot, id);
  await mkdir(snapshotPath, { recursive: true });
  await cp(workspacePath, snapshotPath, {
    recursive: true,
    filter: createFilter(snapshotPath),
  });
  return { id, workspacePath, snapshotPath, createdAt: new Date().toISOString() };
}

/**
 * Restore the workspace to the checkpointed state: clears everything the
 * snapshot tracked (so files the agent created are removed too), then copies the
 * snapshot back. `node_modules` is left untouched.
 */
export async function restoreCheckpoint(checkpoint: Checkpoint): Promise<void> {
  const entries = await readdir(checkpoint.workspacePath, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => !EXCLUDED_DIRS.has(entry.name))
      .map((entry) => rm(join(checkpoint.workspacePath, entry.name), { recursive: true, force: true })),
  );
  await cp(checkpoint.snapshotPath, checkpoint.workspacePath, {
    recursive: true,
    filter: excludesNodeModules,
  });
}

export async function discardCheckpoint(checkpoint: Checkpoint): Promise<void> {
  await rm(checkpoint.snapshotPath, { recursive: true, force: true });
}
