import { createClient, type Client } from '@libsql/client';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type {
  HelmrJob,
  HelmrPlan,
  ToolReceipt,
  ToolResult,
  Capability,
  Swarm,
  SwarmStatus,
  SwarmTask,
  SwarmTaskStatus,
} from '../../shared/src/index.js';

export const CURRENT_SCHEMA_VERSION = 5;

export interface JobRow {
  id: string;
  event_id: string;
  workspace_id: string;
  status: HelmrJob['status'];
  lane: HelmrJob['lane'];
  priority: number;
  attempts: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  lease_until: string | null;
  last_error: string | null;
  payload_text: string | null;
  workspace_path: string | null;
  final_result: string | null;
  reply_to: string | null;
}

export type HelmrStoreJob = HelmrJob & {
  lastError?: string;
  payloadText?: string;
  workspacePath?: string;
  finalResult?: string;
  replyTo?: string;
};

export class HelmrSQLiteStore {
  private db?: Client;

  constructor(private readonly dbPath: string) {}

  private get client(): Client {
    if (!this.db) {
      throw new Error('HelmrSQLiteStore.init() must be called before use');
    }
    return this.db;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    this.db?.close();
    this.db = createClient({ url: `file:${this.dbPath}` });
    await this.client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        lane TEXT NOT NULL DEFAULT 'interactive',
        priority INTEGER NOT NULL DEFAULT 50,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        lease_until TEXT,
        last_error TEXT,
        payload_text TEXT,
        workspace_path TEXT,
        final_result TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON jobs(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_priority_created ON jobs(priority DESC, created_at ASC);

      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_plans_job ON plans(job_id);

      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        capability TEXT NOT NULL,
        input TEXT NOT NULL,
        risk TEXT NOT NULL,
        approval TEXT NOT NULL DEFAULT 'not_required',
        created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_receipts_job ON receipts(job_id);
      CREATE INDEX IF NOT EXISTS idx_receipts_approval ON receipts(approval);

      CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        status TEXT NOT NULL,
        output TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_results_job ON results(job_id);

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        receipt_id TEXT,
        kind TEXT NOT NULL DEFAULT 'plan',
        decision TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_job ON approvals(job_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_decision ON approvals(decision);

      CREATE TABLE IF NOT EXISTS swarms (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        request TEXT NOT NULL,
        subtasks TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned',
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_swarms_job ON swarms(job_id);

      CREATE TABLE IF NOT EXISTS swarm_tasks (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        output TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(swarm_id) REFERENCES swarms(id)
      );
      CREATE INDEX IF NOT EXISTS idx_swarm_tasks_swarm ON swarm_tasks(swarm_id);

      CREATE TABLE IF NOT EXISTS control_flags (
        scope TEXT PRIMARY KEY,
        halted INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        updated_at TEXT NOT NULL
      );
    `);

    await this.ensureColumn('jobs', 'final_result', 'TEXT');
    // v5: the reply address for channel-originated jobs ("provider:recipientId"),
    // so the worker can deliver the answer back to the originating chat.
    await this.ensureColumn('jobs', 'reply_to', 'TEXT');
    await this.recordSchemaVersion(CURRENT_SCHEMA_VERSION);
  }

  async getSchemaVersion(): Promise<number> {
    const rs = await this.client.execute('SELECT MAX(version) AS version FROM schema_migrations');
    const version = rs.rows[0]?.['version'];
    return typeof version === 'number' ? version : 0;
  }

  private async ensureColumn(table: string, column: string, definition: string): Promise<void> {
    const rs = await this.client.execute(`PRAGMA table_info(${table})`);
    const exists = rs.rows.some((row) => row['name'] === column);
    if (!exists) {
      await this.client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  async claimNextJob(options: { leaseMs: number; now?: Date }): Promise<HelmrStoreJob | undefined> {
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + options.leaseMs).toISOString();

    const tx = await this.client.transaction('write');
    try {
      const candidate = await tx.execute({
        sql: `SELECT * FROM jobs
              WHERE (status = 'queued' OR (status IN ('running','planning') AND lease_until IS NOT NULL AND lease_until <= ?))
              ORDER BY priority DESC, created_at ASC
              LIMIT 1`,
        args: [nowIso],
      });
      const row = candidate.rows[0] as unknown as JobRow | undefined;
      if (!row) {
        await tx.rollback();
        return undefined;
      }

      if (row.attempts >= row.max_attempts) {
        await tx.execute({
          sql: `UPDATE jobs SET status='failed', updated_at=?, lease_until=NULL, last_error=? WHERE id=?`,
          args: [nowIso, 'max attempts exceeded', row.id],
        });
        await tx.commit();
        return undefined;
      }

      const nextAttempts = row.attempts + 1;
      const update = await tx.execute({
        sql: `UPDATE jobs
              SET status = 'running', attempts = ?, lease_until = ?, updated_at = ?, last_error = NULL
              WHERE id = ?
                AND (status = 'queued' OR (status IN ('running','planning') AND lease_until IS NOT NULL AND lease_until <= ?))`,
        args: [nextAttempts, leaseUntil, nowIso, row.id, nowIso],
      });

      if (Number(update.rowsAffected ?? 0) !== 1) {
        await tx.rollback();
        return undefined;
      }

      await tx.commit();
      return this.getJob(row.id);
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        // Preserve the original claim error.
      }
      throw err;
    }
  }

  async completeJob(id: string, finalResultOrNow?: string | Date, now = new Date()): Promise<void> {
    const finalResult = finalResultOrNow instanceof Date ? undefined : finalResultOrNow;
    const completedAt = finalResultOrNow instanceof Date ? finalResultOrNow : now;
    await this.client.execute({
      sql: `UPDATE jobs SET status='succeeded', updated_at=?, lease_until=NULL, last_error=NULL, final_result=? WHERE id=?`,
      args: [completedAt.toISOString(), finalResult ?? null, id],
    });
  }

  async failJob(id: string, error: string, now = new Date()): Promise<void> {
    const current = await this.getJob(id);
    if (!current) return;
    const retryable = current.attempts < current.maxAttempts;
    await this.client.execute({
      sql: `UPDATE jobs SET status=?, updated_at=?, lease_until=NULL, last_error=? WHERE id=?`,
      args: [retryable ? 'queued' : 'failed', now.toISOString(), error, id],
    });
  }

  close(): void {
    this.client.close();
  }

  private async recordSchemaVersion(version: number): Promise<void> {
    await this.client.execute({
      sql: 'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      args: [version, new Date().toISOString()],
    });
  }

  async upsertJob(job: HelmrStoreJob): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO jobs
        (id,event_id,workspace_id,status,lane,priority,attempts,max_attempts,created_at,updated_at,lease_until,last_error,payload_text,workspace_path,final_result,reply_to)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        job.id, job.eventId, job.workspaceId, job.status, job.lane,
        job.priority, job.attempts, job.maxAttempts,
        job.createdAt, job.updatedAt,
        job.leaseUntil ?? null, job.lastError ?? null,
        job.payloadText ?? null, job.workspacePath ?? null, job.finalResult ?? null,
        job.replyTo ?? null,
      ],
    });
  }

  async extendJobLease(id: string, leaseMs: number, now = new Date()): Promise<boolean> {
    const current = await this.getJob(id);
    if (!current || (current.status !== 'running' && current.status !== 'planning')) {
      return false;
    }
    if (!current.leaseUntil || Date.parse(current.leaseUntil) <= now.getTime()) {
      return false;
    }

    const nextLease = new Date(now.getTime() + leaseMs).toISOString();
    const rs = await this.client.execute({
      sql: `UPDATE jobs
            SET lease_until=?, updated_at=?
            WHERE id=?
              AND status IN ('running','planning')
              AND lease_until=?`,
      args: [nextLease, now.toISOString(), id, current.leaseUntil],
    });
    return rs.rowsAffected === 1;
  }

  async updateJobStatus(id: string, status: HelmrJob['status'], error?: string): Promise<void> {
    const now = new Date().toISOString();
    if (status === 'running') {
      await this.client.execute({
        sql: 'UPDATE jobs SET status=?, updated_at=?, last_error=? WHERE id=?',
        args: [status, now, error ?? null, id],
      });
      return;
    }

    await this.client.execute({
      sql: `UPDATE jobs
            SET status=?,
                updated_at=?,
                last_error=?,
                lease_until=NULL
            WHERE id=?`,
      args: [status, now, error ?? null, id],
    });
  }

  async getJob(id: string): Promise<HelmrStoreJob | undefined> {
    const rs = await this.client.execute({ sql: 'SELECT * FROM jobs WHERE id=?', args: [id] });
    const row = rs.rows[0];
    if (!row) return undefined;
    return rowToJob(row as unknown as JobRow);
  }

  async listJobs(opts: { status?: HelmrJob['status']; limit?: number } = {}): Promise<HelmrStoreJob[]> {
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (opts.status) { conditions.push('status=?'); args.push(opts.status); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 100;
    const rs = await this.client.execute({ sql: `SELECT * FROM jobs ${where} ORDER BY priority DESC, created_at ASC LIMIT ?`, args: [...args, limit] as import('@libsql/client').InValue[] });
    return rs.rows.map((r) => rowToJob(r as unknown as JobRow));
  }

  async savePlan(plan: HelmrPlan): Promise<void> {
    await this.client.execute({
      sql: 'INSERT OR REPLACE INTO plans (id,job_id,data,created_at) VALUES (?,?,?,?)',
      args: [plan.id, plan.jobId, JSON.stringify(plan), new Date().toISOString()],
    });
  }

  async getPlan(jobId: string): Promise<HelmrPlan | undefined> {
    const rs = await this.client.execute({ sql: 'SELECT data FROM plans WHERE job_id=? ORDER BY created_at DESC LIMIT 1', args: [jobId] });
    if (!rs.rows[0]) return undefined;
    return JSON.parse(rs.rows[0]['data'] as string) as HelmrPlan;
  }

  /** Drop any stored plan(s) for a job so the next run re-plans from scratch. */
  async clearPlan(jobId: string): Promise<void> {
    await this.client.execute({ sql: 'DELETE FROM plans WHERE job_id=?', args: [jobId] });
  }

  async saveReceipt(receipt: ToolReceipt): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO receipts (id,job_id,step_id,tool,capability,input,risk,approval,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [receipt.id, receipt.jobId, receipt.stepId, receipt.tool, receipt.capability,
             JSON.stringify(receipt.input), receipt.risk, receipt.approval, receipt.createdAt],
    });
  }

  async updateReceiptApproval(id: string, approval: ToolReceipt['approval']): Promise<void> {
    await this.client.execute({ sql: 'UPDATE receipts SET approval=? WHERE id=?', args: [approval, id] });
  }

  async getReceipt(id: string): Promise<ToolReceipt | undefined> {
    const rs = await this.client.execute({ sql: 'SELECT * FROM receipts WHERE id=?', args: [id] });
    const row = rs.rows[0];
    if (!row) return undefined;
    return {
      id: row['id'] as string,
      jobId: row['job_id'] as string,
      stepId: row['step_id'] as string,
      tool: row['tool'] as string,
      capability: row['capability'] as Capability,
      input: JSON.parse(row['input'] as string),
      risk: row['risk'] as any,
      approval: row['approval'] as any,
      createdAt: row['created_at'] as string,
    };
  }

  async getReceiptByStep(jobId: string, stepId: string): Promise<ToolReceipt | undefined> {
    const rs = await this.client.execute({
      sql: 'SELECT * FROM receipts WHERE job_id=? AND step_id=? ORDER BY created_at DESC LIMIT 1',
      args: [jobId, stepId]
    });
    const row = rs.rows[0];
    if (!row) return undefined;
    return {
      id: row['id'] as string,
      jobId: row['job_id'] as string,
      stepId: row['step_id'] as string,
      tool: row['tool'] as string,
      capability: row['capability'] as Capability,
      input: JSON.parse(row['input'] as string),
      risk: row['risk'] as any,
      approval: row['approval'] as any,
      createdAt: row['created_at'] as string,
    };
  }

  async getApprovalForReceipt(jobId: string, receiptId: string): Promise<{ decision: 'approved' | 'denied' | null } | undefined> {
    const rs = await this.client.execute({
      sql: 'SELECT decision FROM approvals WHERE job_id=? AND receipt_id=? LIMIT 1',
      args: [jobId, receiptId]
    });
    const row = rs.rows[0];
    if (!row) return undefined;
    return { decision: (row['decision'] as 'approved' | 'denied' | null) ?? null };
  }

  async getResultForReceipt(receiptId: string): Promise<ToolResult | undefined> {
    const rs = await this.client.execute({
      sql: 'SELECT * FROM results WHERE receipt_id=? LIMIT 1',
      args: [receiptId]
    });
    const row = rs.rows[0];
    if (!row) return undefined;
    return {
      id: row['id'] as string,
      receiptId: row['receipt_id'] as string,
      jobId: row['job_id'] as string,
      status: row['status'] as any,
      output: row['output'] ? JSON.parse(row['output'] as string) : undefined,
      error: row['error'] as string ?? undefined,
      createdAt: row['created_at'] as string,
    };
  }

  async getPendingApprovals(): Promise<{ id: string; jobId: string; kind: string; createdAt: string }[]> {
    const rs = await this.client.execute({
      sql: `SELECT a.id, a.job_id, a.kind, a.created_at FROM approvals a
            WHERE a.decision IS NULL ORDER BY a.created_at ASC`,
      args: [],
    });
    return rs.rows.map((r) => ({
      id: r['id'] as string,
      jobId: r['job_id'] as string,
      kind: r['kind'] as string,
      createdAt: r['created_at'] as string,
    }));
  }

  async createApproval(id: string, jobId: string, kind: 'plan' | 'receipt', receiptId?: string): Promise<void> {
    await this.client.execute({
      sql: 'INSERT OR IGNORE INTO approvals (id,job_id,receipt_id,kind,created_at) VALUES (?,?,?,?,?)',
      args: [id, jobId, receiptId ?? null, kind, new Date().toISOString()],
    });
  }

  async decideApproval(id: string, decision: 'approved' | 'denied'): Promise<void> {
    await this.client.execute({
      sql: 'UPDATE approvals SET decision=?, decided_at=? WHERE id=?',
      args: [decision, new Date().toISOString(), id],
    });
  }

  async getApproval(id: string): Promise<{ decision: 'approved' | 'denied' | null; jobId: string } | undefined> {
    const rs = await this.client.execute({ sql: 'SELECT decision, job_id FROM approvals WHERE id=?', args: [id] });
    const row = rs.rows[0];
    if (!row) return undefined;
    return {
      decision: (row['decision'] as 'approved' | 'denied' | null) ?? null,
      jobId: row['job_id'] as string,
    };
  }

  async getApprovalByJob(jobId: string, kind: 'plan' | 'receipt'): Promise<{ decision: 'approved' | 'denied' | null } | undefined> {
    const rs = await this.client.execute({ sql: 'SELECT decision FROM approvals WHERE job_id=? AND kind=? ORDER BY created_at DESC LIMIT 1', args: [jobId, kind] });
    const row = rs.rows[0];
    if (!row) return undefined;
    return { decision: (row['decision'] as 'approved' | 'denied' | null) ?? null };
  }

  async listReceiptsForJob(jobId: string): Promise<ToolReceipt[]> {
    const rs = await this.client.execute({
      sql: 'SELECT * FROM receipts WHERE job_id=? ORDER BY created_at ASC',
      args: [jobId],
    });
    return rs.rows.map((row) => ({
      id: row['id'] as string,
      jobId: row['job_id'] as string,
      stepId: row['step_id'] as string,
      tool: row['tool'] as string,
      capability: row['capability'] as Capability,
      input: JSON.parse(row['input'] as string),
      risk: row['risk'] as any,
      approval: row['approval'] as any,
      createdAt: row['created_at'] as string,
    }));
  }

  async saveResult(result: ToolResult): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO results (id,receipt_id,job_id,status,output,error,created_at)
            VALUES (?,?,?,?,?,?,?)`,
      args: [result.id, result.receiptId, result.jobId, result.status,
             result.output !== undefined ? JSON.stringify(result.output) : null,
             result.error ?? null, result.createdAt],
    });
  }

  // --- Research swarms (persisted so orchestrator + Hatchery share state) ---

  async createSwarm(input: {
    id: string;
    jobId: string;
    request: string;
    subtasks: string[];
    status?: SwarmStatus;
    summary?: string;
    now?: Date;
  }): Promise<void> {
    const now = (input.now ?? new Date()).toISOString();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO swarms (id,job_id,request,subtasks,status,summary,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [
        input.id,
        input.jobId,
        input.request,
        JSON.stringify(input.subtasks),
        input.status ?? 'planned',
        input.summary ?? null,
        now,
        now,
      ],
    });
  }

  async updateSwarmStatus(id: string, status: SwarmStatus, summary?: string, now = new Date()): Promise<void> {
    await this.client.execute({
      sql: 'UPDATE swarms SET status=?, summary=COALESCE(?, summary), updated_at=? WHERE id=?',
      args: [status, summary ?? null, now.toISOString(), id],
    });
  }

  async getSwarm(id: string): Promise<Swarm | undefined> {
    const rs = await this.client.execute({ sql: 'SELECT * FROM swarms WHERE id=?', args: [id] });
    const row = rs.rows[0];
    return row ? rowToSwarm(row) : undefined;
  }

  async getSwarmByJob(jobId: string): Promise<Swarm | undefined> {
    const rs = await this.client.execute({
      sql: 'SELECT * FROM swarms WHERE job_id=? ORDER BY created_at DESC LIMIT 1',
      args: [jobId],
    });
    const row = rs.rows[0];
    return row ? rowToSwarm(row) : undefined;
  }

  async listSwarms(limit = 100): Promise<Swarm[]> {
    const rs = await this.client.execute({
      sql: 'SELECT * FROM swarms ORDER BY created_at DESC LIMIT ?',
      args: [limit],
    });
    return rs.rows.map(rowToSwarm);
  }

  async saveSwarmTask(task: SwarmTask): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO swarm_tasks (id,swarm_id,title,prompt,status,output,error,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [
        task.id,
        task.swarmId,
        task.title,
        task.prompt,
        task.status,
        task.output ?? null,
        task.error ?? null,
        task.createdAt,
        task.updatedAt,
      ],
    });
  }

  async updateSwarmTask(
    id: string,
    fields: { status?: SwarmTaskStatus; output?: string; error?: string },
    now = new Date(),
  ): Promise<void> {
    await this.client.execute({
      sql: `UPDATE swarm_tasks
            SET status=COALESCE(?, status),
                output=COALESCE(?, output),
                error=COALESCE(?, error),
                updated_at=?
            WHERE id=?`,
      args: [fields.status ?? null, fields.output ?? null, fields.error ?? null, now.toISOString(), id],
    });
  }

  async listSwarmTasks(swarmId: string): Promise<SwarmTask[]> {
    const rs = await this.client.execute({
      sql: 'SELECT * FROM swarm_tasks WHERE swarm_id=? ORDER BY created_at ASC',
      args: [swarmId],
    });
    return rs.rows.map(rowToSwarmTask);
  }

  // ── Control flags (durable kill-switch) ──────────────────────────────

  async setControlFlag(scope: string, halted: boolean, reason?: string, now = new Date()): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO control_flags (scope, halted, reason, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(scope) DO UPDATE SET halted=excluded.halted, reason=excluded.reason, updated_at=excluded.updated_at`,
      args: [scope, halted ? 1 : 0, reason ?? null, now.toISOString()],
    });
  }

  async getControlFlag(scope: string): Promise<{ halted: boolean; reason?: string; updatedAt: string } | undefined> {
    const rs = await this.client.execute({
      sql: 'SELECT halted, reason, updated_at FROM control_flags WHERE scope=?',
      args: [scope],
    });
    const row = rs.rows[0];
    if (!row) return undefined;
    return {
      halted: Number(row['halted']) === 1,
      reason: (row['reason'] as string | null) ?? undefined,
      updatedAt: row['updated_at'] as string,
    };
  }

  async listControlFlags(): Promise<Array<{ scope: string; halted: boolean; reason?: string; updatedAt: string }>> {
    const rs = await this.client.execute('SELECT scope, halted, reason, updated_at FROM control_flags ORDER BY scope ASC');
    return rs.rows.map((row) => ({
      scope: row['scope'] as string,
      halted: Number(row['halted']) === 1,
      reason: (row['reason'] as string | null) ?? undefined,
      updatedAt: row['updated_at'] as string,
    }));
  }
}

function rowToSwarm(row: Record<string, unknown>): Swarm {
  return {
    id: row['id'] as string,
    jobId: row['job_id'] as string,
    request: row['request'] as string,
    subtasks: JSON.parse(row['subtasks'] as string) as string[],
    status: row['status'] as SwarmStatus,
    summary: (row['summary'] as string | null) ?? undefined,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function rowToSwarmTask(row: Record<string, unknown>): SwarmTask {
  return {
    id: row['id'] as string,
    swarmId: row['swarm_id'] as string,
    title: row['title'] as string,
    prompt: row['prompt'] as string,
    status: row['status'] as SwarmTaskStatus,
    output: (row['output'] as string | null) ?? undefined,
    error: (row['error'] as string | null) ?? undefined,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function rowToJob(row: JobRow): HelmrStoreJob {
  return {
    id: row.id,
    eventId: row.event_id,
    workspaceId: row.workspace_id,
    status: row.status,
    lane: row.lane,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leaseUntil: row.lease_until ?? undefined,
    lastError: row.last_error ?? undefined,
    payloadText: row.payload_text ?? undefined,
    workspacePath: row.workspace_path ?? undefined,
    finalResult: row.final_result ?? undefined,
    replyTo: row.reply_to ?? undefined,
  };
}
