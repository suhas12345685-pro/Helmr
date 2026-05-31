import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SecretStore } from './secret-store.js';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-secrets-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('readAll returns empty object when no store exists yet', async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(dir);
    assert.deepEqual(await store.readAll(), {});
    assert.equal(await store.get('ANTHROPIC_API_KEY'), undefined);
  });
});

test('set then get round-trips and persists across instances', async () => {
  await withTempDir(async (dir) => {
    await new SecretStore(dir).set('ANTHROPIC_API_KEY', 'sk-secret');
    // A fresh instance reads it back from disk.
    const reopened = new SecretStore(dir);
    assert.equal(await reopened.get('ANTHROPIC_API_KEY'), 'sk-secret');
  });
});

test('set trims whitespace and refuses empty values', async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(dir);
    await store.set('OPENAI_API_KEY', '  sk-trim  ');
    assert.equal(await store.get('OPENAI_API_KEY'), 'sk-trim');
    await assert.rejects(() => store.set('OPENAI_API_KEY', '   '), /empty secret/);
  });
});

test('the secrets file is written with owner-only (0600) permissions', async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(dir);
    await store.set('GROQ_API_KEY', 'sk-perm');
    const info = await stat(join(dir, 'secrets.json'));
    // Low 9 permission bits should be rw-------.
    assert.equal(info.mode & 0o777, 0o600);
  });
});

test('loadInto applies stored keys but never clobbers the environment', async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(dir);
    await store.set('ANTHROPIC_API_KEY', 'stored-anthropic');
    await store.set('OPENAI_API_KEY', 'stored-openai');

    const env: Record<string, string | undefined> = { OPENAI_API_KEY: 'env-openai' };
    const loaded = await store.loadInto(env);

    // Stored key with no env value is applied.
    assert.equal(env['ANTHROPIC_API_KEY'], 'stored-anthropic');
    // Environment wins over the store for already-present keys.
    assert.equal(env['OPENAI_API_KEY'], 'env-openai');
    assert.deepEqual(loaded, ['ANTHROPIC_API_KEY']);
  });
});

test('delete removes a key and reports whether it existed', async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(dir);
    await store.set('XAI_API_KEY', 'sk-del');
    assert.equal(await store.delete('XAI_API_KEY'), true);
    assert.equal(await store.get('XAI_API_KEY'), undefined);
    assert.equal(await store.delete('XAI_API_KEY'), false);
  });
});

test('a corrupt store surfaces an error from readAll (startup loader swallows it)', async () => {
  await withTempDir(async (dir) => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'secrets.json'), 'not json', 'utf8');
    // readAll is honest about corruption rather than silently dropping keys.
    await assert.rejects(() => new SecretStore(dir).readAll());
  });
});

test('non-object JSON (array/null) is treated as an empty store', async () => {
  await withTempDir(async (dir) => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'secrets.json'), 'null', 'utf8');
    assert.deepEqual(await new SecretStore(dir).readAll(), {});
  });
});
