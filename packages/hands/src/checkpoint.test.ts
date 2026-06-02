import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Checkpointer } from './checkpoint.js';

async function withDirs<T>(fn: (ws: string, store: string) => Promise<T>): Promise<T> {
  const ws = await mkdtemp(join(tmpdir(), 'helmr-ckpt-ws-'));
  const store = await mkdtemp(join(tmpdir(), 'helmr-ckpt-store-'));
  try {
    return await fn(ws, store);
  } finally {
    await rm(ws, { recursive: true, force: true }).catch(() => undefined);
    await rm(store, { recursive: true, force: true }).catch(() => undefined);
  }
}

test('rollback restores modified files, recreates deleted ones, and removes new ones', async () => {
  await withDirs(async (ws, store) => {
    await writeFile(join(ws, 'keep.txt'), 'original');
    await mkdir(join(ws, 'sub'), { recursive: true });
    await writeFile(join(ws, 'sub', 'gone.txt'), 'delete me later');

    const cp = new Checkpointer({ rootDir: store });
    const ref = await cp.create('job1', ws);
    assert.equal(ref.skipped, undefined);
    assert.equal(ref.fileCount, 2);

    // Mutate the workspace: modify, delete, and create.
    await writeFile(join(ws, 'keep.txt'), 'CORRUPTED');
    await rm(join(ws, 'sub', 'gone.txt'));
    await writeFile(join(ws, 'new.txt'), 'agent created this');

    const summary = await cp.rollback(ref);
    assert.equal(summary.restored, 2);
    assert.equal(summary.removed, 1);

    assert.equal(await readFile(join(ws, 'keep.txt'), 'utf8'), 'original');
    assert.equal(await readFile(join(ws, 'sub', 'gone.txt'), 'utf8'), 'delete me later');
    assert.equal(existsSync(join(ws, 'new.txt')), false);
  });
});

test('excludes heavy/derived directories from the snapshot', async () => {
  await withDirs(async (ws, store) => {
    await writeFile(join(ws, 'src.ts'), 'code');
    await mkdir(join(ws, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(ws, 'node_modules', 'pkg', 'index.js'), 'huge dep');
    await mkdir(join(ws, '.git'), { recursive: true });
    await writeFile(join(ws, '.git', 'HEAD'), 'ref: refs/heads/main');

    const cp = new Checkpointer({ rootDir: store });
    const ref = await cp.create('job1', ws);
    assert.equal(ref.fileCount, 1, 'only the source file is snapshotted');
  });
});

test('skips the checkpoint when the tree exceeds the size cap', async () => {
  await withDirs(async (ws, store) => {
    await writeFile(join(ws, 'big.bin'), Buffer.alloc(2048));
    const cp = new Checkpointer({ rootDir: store, maxBytes: 1024 });
    const ref = await cp.create('job1', ws);
    assert.equal(ref.skipped, true);
    await assert.rejects(() => cp.rollback(ref), /skipped/);
  });
});

test('loadLatest returns the most recent recoverable checkpoint for on-demand rollback', async () => {
  await withDirs(async (ws, store) => {
    await writeFile(join(ws, 'a.txt'), 'v1');
    const cp = new Checkpointer({ rootDir: store });
    const ref = await cp.create('job-xyz', ws);

    const loaded = await cp.loadLatest('job-xyz');
    assert.equal(loaded?.id, ref.id);
    assert.equal(await cp.loadLatest('no-such-job'), undefined);
  });
});

test('discard removes the snapshot directory', async () => {
  await withDirs(async (ws, store) => {
    await writeFile(join(ws, 'a.txt'), 'v1');
    const cp = new Checkpointer({ rootDir: store });
    const ref = await cp.create('job1', ws);
    assert.equal(existsSync(ref.dir), true);
    await cp.discard(ref);
    assert.equal(existsSync(ref.dir), false);
  });
});
