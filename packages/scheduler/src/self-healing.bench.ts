import { test } from 'node:test';
import { createJobHealingProbe, type JobHealingOptions, type SelfHealingStore, type HealableJob } from './self-healing.js';
import type { JobStatus } from '../../shared/src/index.js';

class MockStore implements SelfHealingStore {
  jobs: HealableJob[] = [];
  constructor(jobCount: number) {
    for (let i = 0; i < jobCount; i++) {
      this.jobs.push({
        id: `job-${i}`,
        status: i % 2 === 0 ? 'running' : 'planning',
        attempts: 1,
        maxAttempts: 3,
        leaseUntil: new Date(Date.now() - 10000).toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  async listJobs(opts: { status?: JobStatus; limit?: number }): Promise<HealableJob[]> {
    // Simulate I/O delay
    await new Promise(resolve => setTimeout(resolve, 50));
    return this.jobs.filter(j => !opts.status || j.status === opts.status).slice(0, opts.limit || 1000);
  }

  async updateJobStatus(id: string, status: JobStatus, error?: string): Promise<void> {}
  async getJob(id: string): Promise<HealableJob | undefined> { return undefined; }
}

test('benchmark detect', async () => {
  const store = new MockStore(1000);
  const probe = createJobHealingProbe({ store, scanLimit: 1000 });

  const start = performance.now();
  await probe.detect();
  const end = performance.now();

  console.log(`Detect took ${end - start} ms`);
});
