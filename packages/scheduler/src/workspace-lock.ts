export type LockMode = 'read' | 'write' | 'exclusive';

export interface LockRequest {
  workspaceId: string;
  ownerId: string;
  mode: LockMode;
  now?: Date;
  ttlMs?: number;
}

export interface AcquireWithTimeoutOptions extends LockRequest {
  timeoutMs?: number;
  pollMs?: number;
}

export interface AcquiredLock {
  workspaceId: string;
  ownerId: string;
  mode: LockMode;
  acquiredAt: string;
  expiresAt: string;
}

const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 25;

export class LockAcquisitionTimeoutError extends Error {
  constructor(workspaceId: string, mode: LockMode, timeoutMs: number) {
    super(`timed out acquiring ${mode} lock for ${workspaceId} after ${timeoutMs}ms`);
  }
}

export class WorkspaceLockManager {
  private readonly locks = new Map<string, AcquiredLock[]>();

  tryAcquire(request: LockRequest): AcquiredLock | null {
    const now = request.now ?? new Date();
    this.clearExpiredLocks(now);
    const existing = this.locks.get(request.workspaceId) ?? [];

    if (isConflicting(existing, request.mode)) {
      return null;
    }

    const lock: AcquiredLock = {
      workspaceId: request.workspaceId,
      ownerId: request.ownerId,
      mode: request.mode,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (request.ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString(),
    };

    this.locks.set(request.workspaceId, [...existing, lock]);
    return lock;
  }

  async acquireWithTimeout(request: AcquireWithTimeoutOptions): Promise<AcquiredLock> {
    const timeoutMs = request.timeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
    const pollMs = request.pollMs ?? DEFAULT_POLL_MS;
    const started = Date.now();

    while (Date.now() - started <= timeoutMs) {
      const lock = this.tryAcquire(request);
      if (lock) {
        return lock;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    this.clearExpiredLocks();
    throw new LockAcquisitionTimeoutError(request.workspaceId, request.mode, timeoutMs);
  }

  renew(lock: AcquiredLock, ttlMs = DEFAULT_LOCK_TTL_MS, now = new Date()): AcquiredLock {
    const existing = this.locks.get(lock.workspaceId) ?? [];
    const index = existing.findIndex((candidate) => candidate === lock);
    if (index === -1) {
      throw new Error(`cannot renew inactive lock: ${lock.workspaceId}`);
    }

    const renewed = {
      ...lock,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    existing[index] = renewed;
    this.locks.set(lock.workspaceId, existing);
    return renewed;
  }

  release(lock: AcquiredLock): void {
    const existing = this.locks.get(lock.workspaceId) ?? [];
    const remaining = existing.filter((l) => l !== lock);

    if (remaining.length === 0) {
      this.locks.delete(lock.workspaceId);
    } else {
      this.locks.set(lock.workspaceId, remaining);
    }
  }

  clearExpiredLocks(now = new Date()): number {
    let cleared = 0;
    const nowMs = now.getTime();
    for (const [workspaceId, locks] of this.locks.entries()) {
      const active = locks.filter((lock) => Date.parse(lock.expiresAt) > nowMs);
      cleared += locks.length - active.length;
      if (active.length === 0) {
        this.locks.delete(workspaceId);
      } else {
        this.locks.set(workspaceId, active);
      }
    }
    return cleared;
  }

  activeLocks(workspaceId: string, now = new Date()): AcquiredLock[] {
    this.clearExpiredLocks(now);
    return [...(this.locks.get(workspaceId) ?? [])];
  }
}

function isConflicting(existing: AcquiredLock[], requested: LockMode): boolean {
  if (existing.length === 0) return false;

  // exclusive blocks everything
  if (existing.some((l) => l.mode === 'exclusive')) return true;
  if (requested === 'exclusive') return true;

  // write blocks readers and other writers
  if (existing.some((l) => l.mode === 'write')) return true;
  if (requested === 'write') return true;

  // read coexists with other reads
  return false;
}
