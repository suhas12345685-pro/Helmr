import { createHash } from 'node:crypto';

export type DurableJobStatus = 'queued' | 'running' | 'awaiting_approval' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';
export interface DurableJob { id: string; idempotencyKey: string; status: DurableJobStatus; attempts: number; leaseExpiresAt?: string; auditHash?: string; payload: Record<string, unknown> }
export class DurableJobRegistry {
  private jobs = new Map<string, DurableJob>();
  private keys = new Map<string, string>();
  upsert(job: DurableJob): DurableJob { const existing = this.keys.get(job.idempotencyKey); if (existing) return this.jobs.get(existing)!; this.jobs.set(job.id, job); this.keys.set(job.idempotencyKey, job.id); return job; }
  get(id: string): DurableJob | undefined { return this.jobs.get(id); }
  cancel(id: string): boolean { const job = this.jobs.get(id); if (!job) return false; job.status = 'cancelled'; return true; }
  pause(id: string): boolean { const job = this.jobs.get(id); if (!job) return false; job.status = 'paused'; return true; }
  resume(id: string): boolean { const job = this.jobs.get(id); if (!job || job.status !== 'paused') return false; job.status = 'queued'; return true; }
  retryExpired(now = new Date()): DurableJob[] { return [...this.jobs.values()].filter((job) => job.status === 'running' && job.leaseExpiresAt && new Date(job.leaseExpiresAt) <= now).map((job) => { job.status = 'queued'; job.attempts += 1; return job; }); }
}
export function auditHash(events: unknown[]): string { return createHash('sha256').update(JSON.stringify(events)).digest('hex'); }
export function verifyAuditHash(events: unknown[], expected: string): boolean { return auditHash(events) === expected; }
