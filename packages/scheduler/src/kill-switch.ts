import { createClient, type Client } from '@libsql/client';

/**
 * The kill-switch — the Operator's recall on autonomy.
 *
 * soul.md: "Autonomy is a loan of trust, and it can be recalled." Full autonomy
 * only stays safe if there is a single, durable, immediate stop. A halt is a row
 * in `control_flags`; the runtime and the embodied agent loop check it between
 * steps and stop within one step.
 *
 * Scopes:
 *   - 'global'      halts everything.
 *   - 'agent:<id>'  halts one embodied agent.
 *
 * A global halt implies every agent scope is halted, so isHalted('agent:x')
 * returns true whenever the global flag is set.
 */
export const GLOBAL_SCOPE = 'global';

export function agentScope(agentId: string): string {
  return `agent:${agentId}`;
}

export interface HaltRecord {
  scope: string;
  reason: string | null;
  createdAt: string;
}

export interface KillSwitchOptions {
  /** libsql URL — e.g. `file:/path/to/helmr.db` or `:memory:`. */
  url: string;
}

export class KillSwitch {
  static async create(options: KillSwitchOptions): Promise<KillSwitch> {
    const client = createClient({ url: options.url });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS control_flags (
        scope TEXT PRIMARY KEY,
        reason TEXT,
        created_at TEXT NOT NULL
      )
    `);
    return new KillSwitch(client);
  }

  private constructor(private readonly client: Client) {}

  async halt(scope: string = GLOBAL_SCOPE, reason?: string): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO control_flags (scope, reason, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(scope) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`,
      args: [scope, reason ?? null, new Date().toISOString()],
    });
  }

  async resume(scope: string = GLOBAL_SCOPE): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM control_flags WHERE scope = ?`,
      args: [scope],
    });
  }

  /** A global halt implies every scope is halted. */
  async isHalted(scope: string = GLOBAL_SCOPE): Promise<boolean> {
    const result = await this.client.execute({
      sql:
        scope === GLOBAL_SCOPE
          ? `SELECT 1 FROM control_flags WHERE scope = ? LIMIT 1`
          : `SELECT 1 FROM control_flags WHERE scope IN (?, ?) LIMIT 1`,
      args: scope === GLOBAL_SCOPE ? [GLOBAL_SCOPE] : [scope, GLOBAL_SCOPE],
    });
    return result.rows.length > 0;
  }

  /** The reason the given scope (or the global flag) is halted, if any. */
  async haltReason(scope: string = GLOBAL_SCOPE): Promise<string | null> {
    const scopes = scope === GLOBAL_SCOPE ? [GLOBAL_SCOPE] : [scope, GLOBAL_SCOPE];
    const placeholders = scopes.map(() => '?').join(', ');
    const result = await this.client.execute({
      sql: `SELECT reason FROM control_flags WHERE scope IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`,
      args: scopes,
    });
    if (result.rows.length === 0) return null;
    const reason = result.rows[0]?.['reason'];
    return reason == null ? null : String(reason);
  }

  async listHalts(): Promise<HaltRecord[]> {
    const result = await this.client.execute(
      `SELECT scope, reason, created_at FROM control_flags ORDER BY created_at DESC`,
    );
    return result.rows.map((row) => ({
      scope: String(row['scope']),
      reason: row['reason'] == null ? null : String(row['reason']),
      createdAt: String(row['created_at']),
    }));
  }

  close(): void {
    this.client.close();
  }
}
