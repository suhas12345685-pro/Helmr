import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCheckpoint, restoreCheckpoint, discardCheckpoint } from './checkpoint.js';

async function tmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

test('restore reverts modified, created, and deleted files', async () => {
  const ws = await tmp('helmr-ckpt-ws-');
  const snaps = await tmp('helmr-ckpt-snap-');
  try {
    await writeFile(join(ws, 'keep.txt'), 'original', 'utf8');
    await writeFile(join(ws, 'remove-me-later.txt'), 'present at checkpoint', 'utf8');
    await mkdir(join(ws, 'src'), { recursive: true });
    await writeFile(join(ws, 'src', 'index.ts'), 'export const v = 1;', 'utf8');

    const checkpoint = await createCheckpoint(ws, snaps);

    // The autonomous agent makes a mess: modify, delete, and create files.
    await writeFile(join(ws, 'keep.txt'), 'CORRUPTED', 'utf8');
    await rm(join(ws, 'remove-me-later.txt'));
    await writeFile(join(ws, 'oops-new-file.txt'), 'should not survive rollback', 'utf8');
    await writeFile(join(ws, 'src', 'index.ts'), 'export const v = 999; // broken', 'utf8');

    await restoreCheckpoint(checkpoint);

    assert.equal(await readFile(join(ws, 'keep.txt'), 'utf8'), 'original');
    assert.equal(await readFile(join(ws, 'remove-me-later.txt'), 'utf8'), 'present at checkpoint');
    assert.equal(await readFile(join(ws, 'src', 'index.ts'), 'utf8'), 'export const v = 1;');
    const names = (await readdir(ws)).sort();
    assert.ok(!names.includes('oops-new-file.txt'), 'agent-created file should be gone after rollback');
  } finally {
    await rm(ws, { recursive: true, force: true });
    await rm(snaps, { recursive: true, force: true });
  }
});

test('node_modules is excluded from snapshot and left untouched on restore', async () => {
  const ws = await tmp('helmr-ckpt-ws-');
  const snaps = await tmp('helmr-ckpt-snap-');
  try {
    await mkdir(join(ws, 'node_modules', 'dep'), { recursive: true });
    await writeFile(join(ws, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;', 'utf8');
    await writeFile(join(ws, 'app.txt'), 'v1', 'utf8');

    const checkpoint = await createCheckpoint(ws, snaps);
    assert.equal(await readdir(checkpoint.snapshotPath).then((e) => e.includes('node_modules')), false);

    await writeFile(join(ws, 'app.txt'), 'v2', 'utf8');
    await restoreCheckpoint(checkpoint);

    assert.equal(await readFile(join(ws, 'app.txt'), 'utf8'), 'v1');
    // node_modules survived because it is never snapshotted or cleared.
    assert.equal(await readFile(join(ws, 'node_modules', 'dep', 'index.js'), 'utf8'), 'module.exports = 1;');
  } finally {
    await rm(ws, { recursive: true, force: true });
    await rm(snaps, { recursive: true, force: true });
  }
});

test('discardCheckpoint removes the snapshot directory', async () => {
  const ws = await tmp('helmr-ckpt-ws-');
  const snaps = await tmp('helmr-ckpt-snap-');
  try {
    await writeFile(join(ws, 'a.txt'), 'a', 'utf8');
    const checkpoint = await createCheckpoint(ws, snaps);
    await discardCheckpoint(checkpoint);
    const remaining = await readdir(snaps);
    assert.ok(!remaining.includes(checkpoint.id));
  } finally {
    await rm(ws, { recursive: true, force: true });
    await rm(snaps, { recursive: true, force: true });
  }
});
