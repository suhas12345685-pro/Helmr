import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createClient } from '@libsql/client';

import { HelmrSQLiteStore } from './sqlite-store.js';
import {
  LATEST_SCHEMA_VERSION,
  getAppliedVersion,
  migrateToLatest,
  rollbackToVersion,
} from './migrations.js';

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-migrate-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

test('migrateToLatest brings a fresh database to the latest version with full history', async () => {
  await withDir(async (dir) => {
    const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    try {
      assert.equal(await store.getSchemaVersion(), LATEST_SCHEMA_VERSION);
      const status = await store.schemaStatus();
      assert.equal(status.current, LATEST_SCHEMA_VERSION);
      assert.deepEqual(status.pending, []);

      // Every version, not just the latest, is recorded so rollback can target
      // an intermediate version later.
      const client = createClient({ url: `file:${join(dir, 'helmr.db')}` });
      try {
        const rows = await client.execute('SELECT version FROM schema_migrations ORDER BY version');
        assert.deepEqual(
          rows.rows.map((r) => r['version']),
          [1, 2],
        );
      } finally {
        client.close();
      }
    } finally {
      store.close();
    }
  });
});

test('rollbackSchema reverses the latest migration and re-upgrading is idempotent', async () => {
  await withDir(async (dir) => {
    const dbPath = join(dir, 'helmr.db');
    const store = new HelmrSQLiteStore(dbPath);
    await store.init();
    try {
      // A row that exercises the v2 column round-trips before rollback.
      await store.upsertJob({
        id: 'job_rb',
        eventId: 'evt_rb',
        workspaceId: 'default',
        status: 'succeeded',
        lane: 'interactive',
        priority: 50,
        attempts: 1,
        maxAttempts: 3,
        createdAt: '2026-05-28T10:00:00.000Z',
        updatedAt: '2026-05-28T10:00:00.000Z',
        finalResult: 'done',
      });

      const reverted = await store.rollbackSchema(1);
      assert.deepEqual(
        reverted.map((s) => s.version),
        [2],
      );
      assert.equal(await store.getSchemaVersion(), 1);

      // The v2 column is gone after rolling back.
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const info = await client.execute('PRAGMA table_info(jobs)');
        assert.ok(!info.rows.some((r) => r['name'] === 'final_result'), 'final_result should be dropped');
      } finally {
        client.close();
      }

      // Re-upgrading restores the column and the latest version.
      const reopened = new HelmrSQLiteStore(dbPath);
      await reopened.init();
      try {
        assert.equal(await reopened.getSchemaVersion(), LATEST_SCHEMA_VERSION);
        await reopened.completeJob('job_rb', 'again');
        const job = await reopened.getJob('job_rb');
        assert.equal(job?.finalResult, 'again');
      } finally {
        reopened.close();
      }
    } finally {
      store.close();
    }
  });
});

test('migrateToLatest backfills a legacy database that only recorded the latest version', async () => {
  await withDir(async (dir) => {
    const dbPath = join(dir, 'helmr.db');

    // Simulate a database written by the old single-shot initializer: the
    // schema exists and only the latest version row is present.
    const client = createClient({ url: `file:${dbPath}` });
    try {
      await client.executeMultiple(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT);
        CREATE TABLE jobs (id TEXT PRIMARY KEY, event_id TEXT, workspace_id TEXT, status TEXT, lane TEXT,
          priority INTEGER, attempts INTEGER, max_attempts INTEGER, created_at TEXT, updated_at TEXT,
          lease_until TEXT, last_error TEXT, payload_text TEXT, workspace_path TEXT, final_result TEXT);
        INSERT INTO schema_migrations (version, applied_at) VALUES (2, '2026-05-01T00:00:00.000Z');
      `);
      assert.equal(await getAppliedVersion(client), 2);
      const applied = await migrateToLatest(client);
      assert.deepEqual(applied, [], 'no forward migrations should run on an up-to-date legacy db');

      // The missing v1 row is backfilled so rollback to v1 is now possible.
      const rows = await client.execute('SELECT version FROM schema_migrations ORDER BY version');
      assert.deepEqual(
        rows.rows.map((r) => r['version']),
        [1, 2],
      );

      const reverted = await rollbackToVersion(client, 1);
      assert.deepEqual(
        reverted.map((s) => s.version),
        [2],
      );
      assert.equal(await getAppliedVersion(client), 1);
    } finally {
      client.close();
    }
  });
});

test('rollbackToVersion rejects a target ahead of the current version', async () => {
  await withDir(async (dir) => {
    const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    try {
      await assert.rejects(() => store.rollbackSchema(LATEST_SCHEMA_VERSION + 1), /ahead of the current version/);
    } finally {
      store.close();
    }
  });
});

test('rollbackSchema writes an automatic pre-rollback snapshot', async () => {
  await withDir(async (dir) => {
    const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    try {
      await store.rollbackSchema(1);
      const backups = await readdir(join(dir, 'migration-backups'));
      assert.ok(
        backups.some((name) => name.includes('pre-rollback') && name.endsWith('.db')),
        `expected a pre-rollback snapshot, got: ${backups.join(', ')}`,
      );
    } finally {
      store.close();
    }
  });
});
