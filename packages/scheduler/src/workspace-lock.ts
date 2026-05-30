export type LockMode = 'read' | 'write' | 'exclusive';

export interface LockRequest {
  workspaceId: string;
  ownerId: string;
  mode: LockMode;
}

export interface AcquiredLock {
  workspaceId: string;
  ownerId: string;
  mode: LockMode;
}

export class WorkspaceLockManager {
  private readonly locks = new Map<string, AcquiredLock[]>();

  tryAcquire(request: LockRequest): AcquiredLock | null {
    const existing = this.locks.get(request.workspaceId) ?? [];

    if (isConflicting(existing, request.mode)) {
      return null;
    }

    const lock: AcquiredLock = {
      workspaceId: request.workspaceId,
      ownerId: request.ownerId,
      mode: request.mode,
    };

    this.locks.set(request.workspaceId, [...existing, lock]);
    return lock;
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

  activeLocks(workspaceId: string): AcquiredLock[] {
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
