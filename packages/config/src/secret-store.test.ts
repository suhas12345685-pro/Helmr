import test from 'node:test';
import assert from 'node:assert/strict';
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

test('SecretStore round-trips persisted values', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'secrets.json');
    const store = new SecretStore(filePath);
    await store.set('ANTHROPIC_API_KEY', 'sk-test-123');

    const reloaded = new SecretStore(filePath);
    assert.equal(await reloaded.get('ANTHROPIC_API_KEY'), 'sk-test-123');
  });
});

test('SecretStore returns undefined for missing keys and tolerates fresh files', async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(join(dir, 'secrets.json'));
    assert.equal(await store.get('missing'), undefined);
    assert.deepEqual(await store.list(), []);
  });
});

test('SecretStore applyToEnv populates process env without overwriting', async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(join(dir, 'secrets.json'));
    await store.set('ANTHROPIC_API_KEY', 'sk-from-store');
    await store.set('OPENAI_API_KEY', 'sk-openai');

    const env: NodeJS.ProcessEnv = Object.create(null);
    env['OPENAI_API_KEY'] = 'existing';
    const applied = await store.applyToEnv(env);
    assert.deepEqual(applied.sort(), ['ANTHROPIC_API_KEY']);
    assert.equal(env['ANTHROPIC_API_KEY'], 'sk-from-store');
    assert.equal(env['OPENAI_API_KEY'], 'existing');
  });
});

test('SecretStore delete removes the secret and persists the change', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'secrets.json');
    const store = new SecretStore(filePath);
    await store.set('KEY', 'value');
    assert.equal(await store.delete('KEY'), true);
    assert.equal(await store.delete('KEY'), false);

    const reloaded = new SecretStore(filePath);
    assert.equal(await reloaded.get('KEY'), undefined);
  });
});

test('SecretStore writes file with 0600 permissions on POSIX', async () => {
  if (process.platform === 'win32') return;
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'secrets.json');
    const store = new SecretStore(filePath);
    await store.set('K', 'V');
    const st = await stat(filePath);
    assert.equal(st.mode & 0o777, 0o600);
  });
});

test('SecretStore recovers from a corrupt secrets file by starting empty', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'secrets.json');
    await (await import('node:fs/promises')).writeFile(filePath, '{not json', 'utf8');
    const store = new SecretStore(filePath);
    assert.equal(await store.get('anything'), undefined);
    await store.set('K', 'V');
    const reloaded = new SecretStore(filePath);
    assert.equal(await reloaded.get('K'), 'V');
    const raw = await readFile(filePath, 'utf8');
    assert.match(raw, /"version": 1/);
  });
});
