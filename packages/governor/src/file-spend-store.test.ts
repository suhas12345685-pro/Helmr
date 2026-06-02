import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileDailySpendStore } from './file-spend-store.js';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-budget-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('accumulates spend and persists across instances', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'spend.json');
    const store = new FileDailySpendStore(path);
    assert.equal(await store.get('2026-06-02'), 0);
    await store.add('2026-06-02', 1.5);
    await store.add('2026-06-02', 2.25);
    assert.equal(await store.get('2026-06-02'), 3.75);

    // A new instance reads the persisted total.
    const reopened = new FileDailySpendStore(path);
    assert.equal(await reopened.get('2026-06-02'), 3.75);
  });
});

test('serializes concurrent adds without lost updates', async () => {
  await withTempDir(async (dir) => {
    const store = new FileDailySpendStore(join(dir, 'spend.json'));
    await Promise.all(Array.from({ length: 20 }, () => store.add('2026-06-02', 0.1)));
    assert.ok(Math.abs((await store.get('2026-06-02')) - 2) < 1e-9);
  });
});

test('writes the spend file with owner-only permissions', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'spend.json');
    const store = new FileDailySpendStore(path);
    await store.add('2026-06-02', 1);
    if (process.platform !== 'win32') {
      const mode = (await stat(path)).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  });
});
