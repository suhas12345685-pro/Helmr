import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StandingPolicyStore, STANDING_POLICY_FILE } from './standing-policy.js';
import { DEFAULT_STANDING_POLICY } from '../../cortex/src/gate.js';

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-policy-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('load returns fail-safe default when no file exists', async () => {
  await withDir(async (dir) => {
    const store = new StandingPolicyStore(dir);
    assert.deepEqual(await store.load(), DEFAULT_STANDING_POLICY);
  });
});

test('save then load round-trips a policy', async () => {
  await withDir(async (dir) => {
    const store = new StandingPolicyStore(dir);
    const policy = { rules: { network: { allowHosts: ['api.github.com'] } } };
    await store.save(policy);
    assert.deepEqual(await store.load(), policy);
  });
});

test('malformed policy file falls back to default rather than throwing', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, STANDING_POLICY_FILE), '{ not valid json', 'utf8');
    const store = new StandingPolicyStore(dir);
    assert.deepEqual(await store.load(), DEFAULT_STANDING_POLICY);
  });
});

test('init writes a template only when absent', async () => {
  await withDir(async (dir) => {
    const store = new StandingPolicyStore(dir);
    await store.init();
    const first = await store.load();
    // Mutate, then init again — init must not clobber the existing file.
    await store.save({ rules: { browser: {} } });
    await store.init();
    assert.deepEqual(await store.load(), { rules: { browser: {} } });
    assert.ok(first.rules);
  });
});
