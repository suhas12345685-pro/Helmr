import { type HelmrJob } from '../../shared/src/index.js';

export interface ClaimOptions {
  leaseMs: number;
  now?: Date;
}

type QueueStatus = HelmrJob['status'] | 'leased';

const TERMINAL_STATUSES = new Set<QueueStatus>(['succeeded', 'failed', 'cancelled']);

export type InMemoryQueueJob = Omit<HelmrJob, 'status'> & {
  status: QueueStatus;
  lastError?: string;
};

export class InMemoryJobQueue {
  private readonly jobs = new Map<string, InMemoryQueueJob>();

  enqueue(job: HelmrJob): InMemoryQueueJob {
    if (this.jobs.has(job.id)) {
      throw new Error(`job already exists: ${job.id}`);
    }
    const queued = { ...job, status: 'queued' as const };
    this.jobs.set(job.id, queued);
    return { ...queued };
  }

  get(jobId: string): InMemoryQueueJob | undefined {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : undefined;
  }

  claimNext(options: ClaimOptions): InMemoryQueueJob | undefined {
    const now = options.now ?? new Date();
    const queued = [...this.jobs.values()]
      .filter((job) => isClaimable(job, now))
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0];

    if (!queued) {
      return undefined;
    }

    if (queued.attempts >= queued.maxAttempts) {
      return this.update(queued.id, {
        status: 'failed',
        leaseUntil: undefined,
        updatedAt: now.toISOString(),
      });
    }

    return this.update(queued.id, {
      status: 'leased',
      attempts: queued.attempts + 1,
      leaseUntil: new Date(now.getTime() + options.leaseMs).toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  markRunning(jobId: string, now = new Date()): InMemoryQueueJob {
    const current = this.requireJob(jobId);
    if (current.status !== 'leased') {
      throw new Error(`job must be leased before running: ${jobId}`);
    }
    return this.update(jobId, { status: 'running', updatedAt: now.toISOString() });
  }

  complete(jobId: string, now = new Date()): InMemoryQueueJob {
    const current = this.requireJob(jobId);
    if (current.status !== 'running') {
      throw new Error(`job must be running before completion: ${jobId}`);
    }
    return this.update(jobId, {
      status: 'succeeded',
      leaseUntil: undefined,
      updatedAt: now.toISOString(),
    });
  }

  fail(jobId: string, error: string, now = new Date()): InMemoryQueueJob {
    const current = this.requireJob(jobId);
    if (current.status !== 'leased' && current.status !== 'running') {
      throw new Error(`job must be leased or running before failure: ${jobId}`);
    }

    return this.update(jobId, {
      status: current.attempts >= current.maxAttempts ? 'failed' : 'queued',
      lastError: error,
      leaseUntil: undefined,
      updatedAt: now.toISOString(),
    });
  }

  private requireJob(jobId: string): InMemoryQueueJob {
    const current = this.jobs.get(jobId);
    if (!current) {
      throw new Error(`unknown job: ${jobId}`);
    }
    return current;
  }

  private update(jobId: string, patch: Partial<InMemoryQueueJob>): InMemoryQueueJob {
    const current = this.requireJob(jobId);

    if (TERMINAL_STATUSES.has(current.status)) {
      throw new Error(`job is terminal: ${jobId}`);
    }

    const updated = { ...current, ...patch };
    this.jobs.set(jobId, updated);
    return updated;
  }
}

function isClaimable(job: InMemoryQueueJob, now: Date): boolean {
  if (job.status === 'queued') {
    return true;
  }

  if (job.status !== 'leased' && job.status !== 'running') {
    return false;
  }

  if (!job.leaseUntil) {
    return false;
  }

  return Date.parse(job.leaseUntil) <= now.getTime();
}
