import type { Client, Transaction } from '@libsql/client';

/**
 * A reversible schema migration.
 *
 * Each migration owns one forward (`up`) and one backward (`down`) step and is
 * applied inside a single transaction together with its `schema_migrations`
 * bookkeeping row, so an interrupted migration never leaves the recorded
 * version out of sync with the actual schema.
 */
export interface Migration {
  version: number;
  description: string;
  up(tx: Transaction): Promise<void>;
  down(tx: Transaction): Promise<void>;
}

async function jobsHasColumn(tx: Transaction, column: string): Promise<boolean> {
  const info = await tx.execute('PRAGMA table_info(jobs)');
  return info.rows.some((row) => row['name'] === column);
}

/**
 * The ordered, append-only list of Helmr control-plane migrations.
 *
 * Add new migrations to the end with the next integer version and a `down`
 * that exactly reverses `up`. Never edit or renumber an already-shipped
 * migration — deployments rely on these versions being stable.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'base control-plane schema (jobs, plans, receipts, results, approvals)',
    async up(tx) {
      await tx.executeMultiple(`
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
    },
    async down(tx) {
      await tx.executeMultiple(`
        DROP INDEX IF EXISTS idx_approvals_decision;
        DROP TABLE IF EXISTS approvals;
        DROP TABLE IF EXISTS results;
        DROP INDEX IF EXISTS idx_receipts_approval;
        DROP TABLE IF EXISTS receipts;
        DROP TABLE IF EXISTS plans;
        DROP INDEX IF EXISTS idx_jobs_workspace;
        DROP INDEX IF EXISTS idx_jobs_status;
        DROP TABLE IF EXISTS jobs;
      `);
    },
  },
  {
    version: 2,
    description: 'add jobs.final_result for persisted Hatchery answers',
    async up(tx) {
      if (!(await jobsHasColumn(tx, 'final_result'))) {
        await tx.execute('ALTER TABLE jobs ADD COLUMN final_result TEXT');
      }
    },
    async down(tx) {
      if (await jobsHasColumn(tx, 'final_result')) {
        await tx.execute('ALTER TABLE jobs DROP COLUMN final_result');
      }
    },
  },
];

/** The highest version any migration in this build knows how to reach. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
);

export interface MigrationStep {
  version: number;
  description: string;
  direction: 'up' | 'down';
}

/** The currently recorded schema version (the max applied migration). */
export async function getAppliedVersion(client: Client): Promise<number> {
  const rs = await client.execute('SELECT MAX(version) AS version FROM schema_migrations');
  const version = rs.rows[0]?.['version'];
  return typeof version === 'number' ? version : 0;
}

async function recordVersion(tx: Transaction, version: number, description: string): Promise<void> {
  await tx.execute({
    sql: 'INSERT OR IGNORE INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
    args: [version, new Date().toISOString(), description],
  });
}

/**
 * Apply every pending forward migration up to {@link LATEST_SCHEMA_VERSION}.
 *
 * Already-applied (or implicitly-applied legacy) versions are backfilled into
 * `schema_migrations` without re-running their `up`, so a database created by
 * an older single-shot initializer becomes a consistent, fully reversible
 * migration history. Returns the steps that were actually applied.
 */
export async function migrateToLatest(client: Client): Promise<MigrationStep[]> {
  const current = await getAppliedVersion(client);
  const applied: MigrationStep[] = [];

  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (migration.version <= current) {
      // Legacy databases recorded only the latest version; backfill the row so
      // the history is complete and rollback can target intermediate versions.
      const tx = await client.transaction('write');
      try {
        await recordVersion(tx, migration.version, migration.description);
        await tx.commit();
      } catch (err) {
        await tx.rollback().catch(() => undefined);
        throw err;
      }
      continue;
    }

    const tx = await client.transaction('write');
    try {
      await migration.up(tx);
      await recordVersion(tx, migration.version, migration.description);
      await tx.commit();
      applied.push({ version: migration.version, description: migration.description, direction: 'up' });
    } catch (err) {
      await tx.rollback().catch(() => undefined);
      throw new Error(
        `migration up to v${migration.version} (${migration.description}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return applied;
}

/**
 * Roll the schema back down to `targetVersion` by running each `down` migration
 * above it, newest first, removing its `schema_migrations` row in the same
 * transaction. Returns the steps that were reverted.
 *
 * `targetVersion` must be between 0 and the current applied version.
 */
export async function rollbackToVersion(client: Client, targetVersion: number): Promise<MigrationStep[]> {
  const current = await getAppliedVersion(client);

  if (!Number.isInteger(targetVersion) || targetVersion < 0) {
    throw new Error(`invalid rollback target version: ${targetVersion}`);
  }
  if (targetVersion > current) {
    throw new Error(
      `cannot roll back to v${targetVersion}: it is ahead of the current version v${current}. Use migrateToLatest to upgrade.`,
    );
  }

  const reverted: MigrationStep[] = [];
  const descending = [...MIGRATIONS].sort((a, b) => b.version - a.version);

  for (const migration of descending) {
    if (migration.version <= targetVersion || migration.version > current) {
      continue;
    }

    const tx = await client.transaction('write');
    try {
      await migration.down(tx);
      await tx.execute({ sql: 'DELETE FROM schema_migrations WHERE version = ?', args: [migration.version] });
      await tx.commit();
      reverted.push({ version: migration.version, description: migration.description, direction: 'down' });
    } catch (err) {
      await tx.rollback().catch(() => undefined);
      throw new Error(
        `migration down from v${migration.version} (${migration.description}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return reverted;
}
