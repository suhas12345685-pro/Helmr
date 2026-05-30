import { createClient, type Client } from '@libsql/client';

import type { AcquiredLock, LockMode, LockRequest, AcquireWithTimeoutOptions } from './workspace-lock.js';
import { LockAcquisitionTimeoutError } from './workspace-lock.js';

const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 25;

export interface SqliteWorkspaceLockManagerOptions {
  /** libsql URL — e.g. `file:/path/to/locks.db` or `:memory:`. */
  url: string;
}

/**
 * Cross-process workspace lock manager. Locks are persisted to SQLite via
 * libsql, and the check-and-insert step runs inside a single write
 * transaction so two workers in two processes cannot both observe an
 * empty conflict set before either records ownership.
 */
export class SqliteWorkspaceLockManager {
  static async create(options: SqliteWorkspaceLockManagerOptions): Promise<SqliteWorkspaceLockManager> {
    const client = createClient({ url: options.url });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS workspace_locks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('read','write','exclusive')),
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);
    await client.execute(
      `CREATE INDEX IF NOT EXISTS workspace_locks_workspace_id_idx ON workspace_locks(workspace_id)`,
    );
    await client.execute(
      `CREATE INDEX IF NOT EXISTS workspace_locks_expires_at_idx ON workspace_locks(expires_at)`,
    );
    return new SqliteWorkspaceLockManager(client);
  }

  private constructor(private readonly client: Client) {}

  async tryAcquire(request: LockRequest): Promise<AcquiredLock | null> {
    const now = request.now ?? new Date();
    const ttlMs = request.ttlMs ?? DEFAULT_LOCK_TTL_MS;
    const nowIso = now.toISOString();
    const expiresIso = new Date(now.getTime() + ttlMs).toISOString();

    let tx;
    try {
      tx = await this.client.transaction('write');
    } catch (err) {
      if (isSqliteBusy(err)) return null;
      throw err;
    }
    try {
      await tx.execute({ sql: `DELETE FROM workspace_locks WHERE expires_at <= ?`, args: [nowIso] });
      const existing = await tx.execute({
        sql: `SELECT mode FROM workspace_locks WHERE workspace_id = ?`,
        args: [request.workspaceId],
      });
      const modes = existing.rows.map((row) => String(row['mode']) as LockMode);
      if (isConflicting(modes, request.mode)) {
        await tx.rollback();
        return null;
      }
      await tx.execute({
        sql: `INSERT INTO workspace_locks (workspace_id, owner_id, mode, acquired_at, expires_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [request.workspaceId, request.ownerId, request.mode, nowIso, expiresIso],
      });
      await tx.commit();
      return {
        workspaceId: request.workspaceId,
        ownerId: request.ownerId,
        mode: request.mode,
        acquiredAt: nowIso,
        expiresAt: expiresIso,
      };
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        // swallow: original error is the meaningful one
      }
      // SQLITE_BUSY = another writer holds the DB lock right now. Surface
      // as "not acquired" so acquireWithTimeout can poll instead of
      // bubbling a transient error to the caller.
      if (isSqliteBusy(err)) return null;
      throw err;
    }
  }

  async acquireWithTimeout(request: AcquireWithTimeoutOptions): Promise<AcquiredLock> {
    const timeoutMs = request.timeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
    const pollMs = request.pollMs ?? DEFAULT_POLL_MS;
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      const lock = await this.tryAcquire(request);
      if (lock) return lock;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new LockAcquisitionTimeoutError(request.workspaceId, request.mode, timeoutMs);
  }

  async release(lock: AcquiredLock): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM workspace_locks
            WHERE workspace_id = ? AND owner_id = ? AND mode = ? AND acquired_at = ?`,
      args: [lock.workspaceId, lock.ownerId, lock.mode, lock.acquiredAt],
    });
  }

  async renew(lock: AcquiredLock, ttlMs: number = DEFAULT_LOCK_TTL_MS, now: Date = new Date()): Promise<AcquiredLock> {
    const newExpires = new Date(now.getTime() + ttlMs).toISOString();
    const result = await this.client.execute({
      sql: `UPDATE workspace_locks SET expires_at = ?
            WHERE workspace_id = ? AND owner_id = ? AND mode = ? AND acquired_at = ?`,
      args: [newExpires, lock.workspaceId, lock.ownerId, lock.mode, lock.acquiredAt],
    });
    if (Number(result.rowsAffected ?? 0) === 0) {
      throw new Error(`cannot renew inactive lock: ${lock.workspaceId}`);
    }
    return { ...lock, expiresAt: newExpires };
  }

  async clearExpiredLocks(now: Date = new Date()): Promise<number> {
    const result = await this.client.execute({
      sql: `DELETE FROM workspace_locks WHERE expires_at <= ?`,
      args: [now.toISOString()],
    });
    return Number(result.rowsAffected ?? 0);
  }

  async activeLocks(workspaceId: string, now: Date = new Date()): Promise<AcquiredLock[]> {
    await this.clearExpiredLocks(now);
    const result = await this.client.execute({
      sql: `SELECT workspace_id, owner_id, mode, acquired_at, expires_at
            FROM workspace_locks WHERE workspace_id = ?`,
      args: [workspaceId],
    });
    return result.rows.map((row) => ({
      workspaceId: String(row['workspace_id']),
      ownerId: String(row['owner_id']),
      mode: String(row['mode']) as LockMode,
      acquiredAt: String(row['acquired_at']),
      expiresAt: String(row['expires_at']),
    }));
  }

  close(): void {
    this.client.close();
  }
}

function isSqliteBusy(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code === 'SQLITE_BUSY';
}

function isConflicting(existing: LockMode[], requested: LockMode): boolean {
  if (existing.length === 0) return false;
  if (existing.includes('exclusive')) return true;
  if (requested === 'exclusive') return true;
  if (existing.includes('write')) return true;
  if (requested === 'write') return true;
  return false;
}
