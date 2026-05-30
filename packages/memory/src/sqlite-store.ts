import { createClient, type Client } from '@libsql/client';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { HelmrJob, HelmrPlan, ToolReceipt, ToolResult, Capability } from '../../shared/src/index.js';

export const CURRENT_SCHEMA_VERSION = 1;

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
}

export type HelmrStoreJob = HelmrJob & {
  lastError?: string;
  payloadText?: string;
  workspacePath?: string;
};

export class HelmrSQLiteStore {
  private db: Client;

  constructor(private readonly dbPath: string) {
    this.db = createClient({ url: `file:${dbPath}` });
  }

  async init(): Promise<void> {
    await mkdir(join(this.dbPath, '..'), { recursive: true });
    await this.db.executeMultiple(`
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
        workspace_path TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON jobs(workspace_id);

      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id)
      );

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

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        receipt_id TEXT,
        kind TEXT NOT NULL DEFAULT 'plan',
        decision TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_decision ON approvals(decision);
    `);

    await this.recordSchemaVersion(CURRENT_SCHEMA_VERSION);
  }

  async getSchemaVersion(): Promise<number> {
    const rs = await this.db.execute('SELECT MAX(version) AS version FROM schema_migrations');
    const version = rs.rows[0]?.['version'];
    return typeof version === 'number' ? version : 0;
  }

  private async recordSchemaVersion(version: number): Promise<void> {
    await this.db.execute({
      sql: 'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      args: [version, new Date().toISOString()],
    });
  }

  async upsertJob(job: HelmrStoreJob): Promise<void> {
    await this.db.execute({
      sql: `INSERT OR REPLACE INTO jobs
        (id,event_id,workspace_id,status,lane,priority,attempts,max_attempts,created_at,updated_at,lease_until,last_error,payload_text,workspace_path)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        job.id, job.eventId, job.workspaceId, job.status, job.lane,
        job.priority, job.attempts, job.maxAttempts,
        job.createdAt, job.updatedAt,
        job.leaseUntil ?? null, job.lastError ?? null,
        job.payloadText ?? null, job.workspacePath ?? null,
      ],
    });
  }

  async updateJobStatus(id: string, status: HelmrJob['status'], error?: string): Promise<void> {
    const now = new Date().toISOString();
    if (status === 'running') {
      await this.db.execute({
        sql: 'UPDATE jobs SET status=?, updated_at=?, last_error=? WHERE id=?',
        args: [status, now, error ?? null, id],
      });
      return;
    }

    await this.db.execute({
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
    const rs = await this.db.execute({ sql: 'SELECT * FROM jobs WHERE id=?', args: [id] });
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
    const rs = await this.db.execute({ sql: `SELECT * FROM jobs ${where} ORDER BY priority DESC, created_at ASC LIMIT ?`, args: [...args, limit] as import('@libsql/client').InValue[] });
    return rs.rows.map((r) => rowToJob(r as unknown as JobRow));
  }

  async savePlan(plan: HelmrPlan): Promise<void> {
    await this.db.execute({
      sql: 'INSERT OR REPLACE INTO plans (id,job_id,data,created_at) VALUES (?,?,?,?)',
      args: [plan.id, plan.jobId, JSON.stringify(plan), new Date().toISOString()],
    });
  }

  async getPlan(jobId: string): Promise<HelmrPlan | undefined> {
    const rs = await this.db.execute({ sql: 'SELECT data FROM plans WHERE job_id=? ORDER BY created_at DESC LIMIT 1', args: [jobId] });
    if (!rs.rows[0]) return undefined;
    return JSON.parse(rs.rows[0]['data'] as string) as HelmrPlan;
  }

  async saveReceipt(receipt: ToolReceipt): Promise<void> {
    await this.db.execute({
      sql: `INSERT OR REPLACE INTO receipts (id,job_id,step_id,tool,capability,input,risk,approval,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [receipt.id, receipt.jobId, receipt.stepId, receipt.tool, receipt.capability,
             JSON.stringify(receipt.input), receipt.risk, receipt.approval, receipt.createdAt],
    });
  }

  async updateReceiptApproval(id: string, approval: ToolReceipt['approval']): Promise<void> {
    await this.db.execute({ sql: 'UPDATE receipts SET approval=? WHERE id=?', args: [approval, id] });
  }

  async getReceipt(id: string): Promise<ToolReceipt | undefined> {
    const rs = await this.db.execute({ sql: 'SELECT * FROM receipts WHERE id=?', args: [id] });
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
    const rs = await this.db.execute({
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
    const rs = await this.db.execute({
      sql: 'SELECT decision FROM approvals WHERE job_id=? AND receipt_id=? LIMIT 1',
      args: [jobId, receiptId]
    });
    const row = rs.rows[0];
    if (!row) return undefined;
    return { decision: (row['decision'] as 'approved' | 'denied' | null) ?? null };
  }

  async getResultForReceipt(receiptId: string): Promise<ToolResult | undefined> {
    const rs = await this.db.execute({
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
    const rs = await this.db.execute({
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
    await this.db.execute({
      sql: 'INSERT OR IGNORE INTO approvals (id,job_id,receipt_id,kind,created_at) VALUES (?,?,?,?,?)',
      args: [id, jobId, receiptId ?? null, kind, new Date().toISOString()],
    });
  }

  async decideApproval(id: string, decision: 'approved' | 'denied'): Promise<void> {
    await this.db.execute({
      sql: 'UPDATE approvals SET decision=?, decided_at=? WHERE id=?',
      args: [decision, new Date().toISOString(), id],
    });
  }

  async getApproval(id: string): Promise<{ decision: 'approved' | 'denied' | null; jobId: string } | undefined> {
    const rs = await this.db.execute({ sql: 'SELECT decision, job_id FROM approvals WHERE id=?', args: [id] });
    const row = rs.rows[0];
    if (!row) return undefined;
    return {
      decision: (row['decision'] as 'approved' | 'denied' | null) ?? null,
      jobId: row['job_id'] as string,
    };
  }

  async getApprovalByJob(jobId: string, kind: 'plan' | 'receipt'): Promise<{ decision: 'approved' | 'denied' | null } | undefined> {
    const rs = await this.db.execute({ sql: 'SELECT decision FROM approvals WHERE job_id=? AND kind=? ORDER BY created_at DESC LIMIT 1', args: [jobId, kind] });
    const row = rs.rows[0];
    if (!row) return undefined;
    return { decision: (row['decision'] as 'approved' | 'denied' | null) ?? null };
  }

  async saveResult(result: ToolResult): Promise<void> {
    await this.db.execute({
      sql: `INSERT OR REPLACE INTO results (id,receipt_id,job_id,status,output,error,created_at)
            VALUES (?,?,?,?,?,?,?)`,
      args: [result.id, result.receiptId, result.jobId, result.status,
             result.output !== undefined ? JSON.stringify(result.output) : null,
             result.error ?? null, result.createdAt],
    });
  }
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
  };
}
