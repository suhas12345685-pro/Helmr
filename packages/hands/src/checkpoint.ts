import { randomUUID } from 'node:crypto';
import { mkdir, readdir, copyFile, readFile, writeFile, rm, stat, unlink } from 'node:fs/promises';
import { join, resolve, relative, dirname, sep } from 'node:path';

/**
 * Checkpoint & rollback for reversible autonomous writes.
 *
 * Before a write-batch runs, the runtime takes a checkpoint — a content snapshot
 * of the workspace (excluding heavy/derived dirs). If the job fails, the budget
 * trips mid-write, or the kill-switch engages while writing, the runtime rolls
 * back to the checkpoint and marks the job `rolled_back`. The snapshot is also
 * persisted per-job so `helmr rollback <jobId>` can revert on demand later.
 *
 * The implementation is a dependency-free copy snapshot (works for git and
 * non-git workspaces alike) with a size cap: if the in-scope tree exceeds the
 * cap the checkpoint is recorded as `skipped` rather than silently pretending —
 * the runtime then declines to promise reversibility for that batch.
 */

export interface CheckpointRef {
  id: string;
  jobId: string;
  workspacePath: string;
  /** Directory holding the snapshot + manifest. */
  dir: string;
  fileCount: number;
  bytes: number;
  createdAt: string;
  /** True when the tree was too large to snapshot; no rollback is possible. */
  skipped?: boolean;
  reason?: string;
}

export interface CheckpointerOptions {
  /** Base dir for snapshots (typically the Helmr data dir). */
  rootDir: string;
  /** Max total bytes to snapshot before skipping. Default 50 MB. */
  maxBytes?: number;
  /** Directory names to never snapshot. */
  excludes?: string[];
  now?: () => Date;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_EXCLUDES = ['.git', 'node_modules', 'dist', '.next', 'build', 'coverage', '.turbo', 'tmp', '.helmr'];

export class Checkpointer {
  private readonly rootDir: string;
  private readonly maxBytes: number;
  private readonly excludes: Set<string>;
  private readonly now: () => Date;

  constructor(options: CheckpointerOptions) {
    this.rootDir = options.rootDir;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.excludes = new Set(options.excludes ?? DEFAULT_EXCLUDES);
    this.now = options.now ?? (() => new Date());
  }

  /** Snapshot the in-scope workspace tree. */
  async create(jobId: string, workspacePath: string): Promise<CheckpointRef> {
    const root = resolve(workspacePath);
    const id = `ckpt_${randomUUID()}`;
    const dir = join(this.rootDir, 'checkpoints', jobId, id);
    const filesDir = join(dir, 'files');
    const createdAt = this.now().toISOString();

    const entries = await this.walk(root);
    const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);

    if (totalBytes > this.maxBytes) {
      const ref: CheckpointRef = {
        id, jobId, workspacePath: root, dir, fileCount: 0, bytes: totalBytes,
        createdAt, skipped: true,
        reason: `workspace ${(totalBytes / 1e6).toFixed(1)}MB exceeds checkpoint cap ${(this.maxBytes / 1e6).toFixed(0)}MB`,
      };
      return ref;
    }

    await mkdir(filesDir, { recursive: true });
    for (const entry of entries) {
      const dest = join(filesDir, entry.rel);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(join(root, entry.rel), dest);
    }

    const ref: CheckpointRef = {
      id, jobId, workspacePath: root, dir,
      fileCount: entries.length, bytes: totalBytes, createdAt,
    };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ref, files: entries.map((e) => e.rel) }, null, 2), 'utf8');
    // Record as the job's latest recoverable checkpoint for on-demand rollback.
    await this.writeLatest(jobId, ref);
    return ref;
  }

  /**
   * Restore the workspace to a checkpoint: rewrite snapshotted files to their
   * captured content and remove any in-scope file created after the snapshot.
   */
  async rollback(ref: CheckpointRef): Promise<{ restored: number; removed: number }> {
    if (ref.skipped) {
      throw new Error(`checkpoint ${ref.id} was skipped (${ref.reason ?? 'no snapshot'}); cannot roll back`);
    }
    const manifest = JSON.parse(await readFile(join(ref.dir, 'manifest.json'), 'utf8')) as { files: string[] };
    const root = resolve(ref.workspacePath);
    const snapshotPaths = new Set(manifest.files);

    // Restore captured files.
    let restored = 0;
    for (const rel of manifest.files) {
      const dest = join(root, rel);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(join(ref.dir, 'files', rel), dest);
      restored += 1;
    }

    // Remove files that exist now but were not in the snapshot (agent creations).
    let removed = 0;
    const current = await this.walk(root);
    for (const entry of current) {
      if (!snapshotPaths.has(entry.rel)) {
        await unlink(join(root, entry.rel)).catch(() => undefined);
        removed += 1;
      }
    }
    return { restored, removed };
  }

  /** Delete a checkpoint's snapshot (after a successful job, or post-rollback). */
  async discard(ref: CheckpointRef): Promise<void> {
    await rm(ref.dir, { recursive: true, force: true }).catch(() => undefined);
  }

  /** Load the latest recoverable checkpoint recorded for a job. */
  async loadLatest(jobId: string): Promise<CheckpointRef | undefined> {
    try {
      const raw = await readFile(this.latestPath(jobId), 'utf8');
      return JSON.parse(raw) as CheckpointRef;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  private latestPath(jobId: string): string {
    return join(this.rootDir, 'checkpoints', jobId, 'latest.json');
  }

  private async writeLatest(jobId: string, ref: CheckpointRef): Promise<void> {
    const path = this.latestPath(jobId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(ref, null, 2), 'utf8');
  }

  private async walk(root: string): Promise<Array<{ rel: string; size: number }>> {
    const out: Array<{ rel: string; size: number }> = [];
    const visit = async (absDir: string): Promise<void> => {
      let dirents;
      try {
        dirents = await readdir(absDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (dirent.isSymbolicLink()) continue;
        if (dirent.isDirectory()) {
          if (this.excludes.has(dirent.name)) continue;
          await visit(join(absDir, dirent.name));
        } else if (dirent.isFile()) {
          const abs = join(absDir, dirent.name);
          const rel = relative(root, abs);
          if (rel.startsWith('..') || rel.includes(`..${sep}`)) continue;
          try {
            const st = await stat(abs);
            out.push({ rel, size: st.size });
          } catch {
            // Disappeared mid-walk; ignore.
          }
        }
      }
    };
    await visit(root);
    return out;
  }
}
