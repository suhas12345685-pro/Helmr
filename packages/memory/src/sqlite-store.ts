import { createClient, type Client } from '@libsql/client';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { HelmrJob, HelmrPlan, ToolReceipt, ToolResult, Capability } from '../../shared/src/index.js';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  getAppliedVersion,
  migrateToLatest,
  rollbackToVersion,
  type MigrationStep,
} from './migrations.js';

export const CURRENT_SCHEMA_VERSION = LATEST_SCHEMA_VERSION;

export interface SchemaStatus {
  current: number;
  latest: number;
  pending: number[];
}

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
}

export type HelmrStoreJob = HelmrJob & {
  lastError?: string;
  payloadText?: string;
  workspacePath?: string;
  finalResult?: string;
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

    // The migration ledger is the one table the runner needs up front.
    await this.client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT
      );
    `);
    await this.ensureColumn('schema_migrations', 'description', 'TEXT');

    // Snapshot before mutating the schema of an existing database, so an
    // upgrade always has a restore point even if a forward migration fails.
    const before = await getAppliedVersion(this.client);
    if (before > 0 && before < LATEST_SCHEMA_VERSION) {
      await this.snapshotDatabase(`pre-upgrade-v${before}`);
    }

    await migrateToLatest(this.client);
  }

  async getSchemaVersion(): Promise<number> {
    return getAppliedVersion(this.client);
  }

  /** Report the applied schema version, the latest known, and any pending versions. */
  async schemaStatus(): Promise<SchemaStatus> {
    const current = await getAppliedVersion(this.client);
    return {
      current,
      latest: LATEST_SCHEMA_VERSION,
      pending: MIGRATIONS.filter((m) => m.version > current).map((m) => m.version),
    };
  }

  /**
   * Roll the control-plane schema back to `targetVersion`, running each
   * migration's reverse step newest-first. A pre-rollback snapshot of the
   * database is taken automatically (unless disabled) so the operation itself
   * is recoverable. Returns the reverted steps.
   */
  async rollbackSchema(
    targetVersion: number,
    options: { backup?: boolean } = {},
  ): Promise<MigrationStep[]> {
    if (options.backup !== false) {
      const current = await getAppliedVersion(this.client);
      await this.snapshotDatabase(`pre-rollback-v${current}-to-v${targetVersion}`);
    }
    return rollbackToVersion(this.client, targetVersion);
  }

  /**
   * Take a consistent SQLite snapshot of the live database using `VACUUM INTO`
   * (never a torn raw copy) under a `migration-backups/` sibling directory.
   * Returns the absolute path of the snapshot.
   */
  async snapshotDatabase(label: string): Promise<string> {
    const backupDir = join(dirname(this.dbPath), 'migration-backups');
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '-');
    const snapshotPath = join(backupDir, `helmr-${safeLabel}-${stamp}.db`);
    await this.client.execute(`VACUUM INTO ${sqliteStringLiteral(snapshotPath)}`);
    return snapshotPath;
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

  async upsertJob(job: HelmrStoreJob): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO jobs
        (id,event_id,workspace_id,status,lane,priority,attempts,max_attempts,created_at,updated_at,lease_until,last_error,payload_text,workspace_path,final_result)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        job.id, job.eventId, job.workspaceId, job.status, job.lane,
        job.priority, job.attempts, job.maxAttempts,
        job.createdAt, job.updatedAt,
        job.leaseUntil ?? null, job.lastError ?? null,
        job.payloadText ?? null, job.workspacePath ?? null, job.finalResult ?? null,
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
}

function sqliteStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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
  };
}
