import { createClient, type Client } from '@libsql/client';

/**
 * Budgets & circuit breakers — one of the four edge boundaries
 * (docs/phase1-implementation-plan.md). A dedicated body contains filesystem
 * mistakes, but it does NOT cap spend: a smart model stuck in a loop can burn
 * money or compute indefinitely from inside a perfectly isolated box. The
 * BudgetLedger puts hard ceilings on spend, actions, wall-clock, and tool-call
 * rate per job; tripping a limit pauses the job.
 *
 * A limit <= 0 means "unlimited" for that dimension.
 */
export interface BudgetLimits {
  usdPerJob: number;
  actionsPerJob: number;
  jobSeconds: number;
  toolRatePerMin: number;
}

export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  usdPerJob: 1,
  actionsPerJob: 200,
  jobSeconds: 1800,
  toolRatePerMin: 120,
};

export type BudgetLimitName = 'usd' | 'actions' | 'time' | 'rate';

export interface BudgetCheck {
  allowed: boolean;
  trippedLimit?: BudgetLimitName;
  detail?: string;
}

export interface BudgetUsage {
  jobId: string;
  usd: number;
  tokens: number;
  actions: number;
  startedAt: string;
}

export interface ActionCost {
  usd?: number;
  tokens?: number;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveBudgetLimits(
  env: Record<string, string | undefined> = process.env,
): BudgetLimits {
  return {
    usdPerJob: num(env['HELMR_BUDGET_USD_PER_JOB'], DEFAULT_BUDGET_LIMITS.usdPerJob),
    actionsPerJob: num(env['HELMR_MAX_ACTIONS_PER_JOB'], DEFAULT_BUDGET_LIMITS.actionsPerJob),
    jobSeconds: num(env['HELMR_MAX_JOB_SECONDS'], DEFAULT_BUDGET_LIMITS.jobSeconds),
    toolRatePerMin: num(env['HELMR_TOOL_RATE_PER_MIN'], DEFAULT_BUDGET_LIMITS.toolRatePerMin),
  };
}

export interface BudgetLedgerOptions {
  url: string;
  limits?: BudgetLimits;
}

export class BudgetLedger {
  static async create(options: BudgetLedgerOptions): Promise<BudgetLedger> {
    const client = createClient({ url: options.url });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS budgets (
        job_id TEXT PRIMARY KEY,
        usd REAL NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        actions INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS budget_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        at TEXT NOT NULL
      )
    `);
    await client.execute(
      `CREATE INDEX IF NOT EXISTS budget_actions_job_idx ON budget_actions(job_id, at)`,
    );
    return new BudgetLedger(client, options.limits ?? resolveBudgetLimits());
  }

  private constructor(
    private readonly client: Client,
    readonly limits: BudgetLimits,
  ) {}

  private async ensureRow(jobId: string, now: Date): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO budgets (job_id, started_at, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(job_id) DO NOTHING`,
      args: [jobId, now.toISOString(), now.toISOString()],
    });
  }

  async usage(jobId: string): Promise<BudgetUsage | null> {
    const result = await this.client.execute({
      sql: `SELECT usd, tokens, actions, started_at FROM budgets WHERE job_id = ?`,
      args: [jobId],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      jobId,
      usd: Number(row['usd']),
      tokens: Number(row['tokens']),
      actions: Number(row['actions']),
      startedAt: String(row['started_at']),
    };
  }

  /**
   * Check whether the job may take one more action with the projected cost.
   * Does not mutate usage — call recordAction once the action is taken.
   */
  async check(jobId: string, projected: ActionCost = {}, now: Date = new Date()): Promise<BudgetCheck> {
    await this.ensureRow(jobId, now);
    const usage = (await this.usage(jobId))!;

    if (this.limits.actionsPerJob > 0 && usage.actions + 1 > this.limits.actionsPerJob) {
      return { allowed: false, trippedLimit: 'actions', detail: `action cap ${this.limits.actionsPerJob} reached` };
    }

    const projectedUsd = usage.usd + (projected.usd ?? 0);
    if (this.limits.usdPerJob > 0 && projectedUsd > this.limits.usdPerJob) {
      return { allowed: false, trippedLimit: 'usd', detail: `spend cap $${this.limits.usdPerJob} would be exceeded` };
    }

    if (this.limits.jobSeconds > 0) {
      const elapsedSec = (now.getTime() - new Date(usage.startedAt).getTime()) / 1000;
      if (elapsedSec > this.limits.jobSeconds) {
        return { allowed: false, trippedLimit: 'time', detail: `time cap ${this.limits.jobSeconds}s exceeded` };
      }
    }

    if (this.limits.toolRatePerMin > 0) {
      const windowStart = new Date(now.getTime() - 60_000).toISOString();
      const recent = await this.client.execute({
        sql: `SELECT COUNT(*) AS n FROM budget_actions WHERE job_id = ? AND at > ?`,
        args: [jobId, windowStart],
      });
      const n = Number(recent.rows[0]?.['n'] ?? 0);
      if (n >= this.limits.toolRatePerMin) {
        return { allowed: false, trippedLimit: 'rate', detail: `rate cap ${this.limits.toolRatePerMin}/min reached` };
      }
    }

    return { allowed: true };
  }

  async recordAction(jobId: string, cost: ActionCost = {}, now: Date = new Date()): Promise<void> {
    await this.ensureRow(jobId, now);
    await this.client.execute({
      sql: `UPDATE budgets
            SET usd = usd + ?, tokens = tokens + ?, actions = actions + 1, updated_at = ?
            WHERE job_id = ?`,
      args: [cost.usd ?? 0, cost.tokens ?? 0, now.toISOString(), jobId],
    });
    await this.client.execute({
      sql: `INSERT INTO budget_actions (job_id, at) VALUES (?, ?)`,
      args: [jobId, now.toISOString()],
    });
  }

  async reset(jobId: string): Promise<void> {
    await this.client.execute({ sql: `DELETE FROM budgets WHERE job_id = ?`, args: [jobId] });
    await this.client.execute({ sql: `DELETE FROM budget_actions WHERE job_id = ?`, args: [jobId] });
  }

  close(): void {
    this.client.close();
  }
}
