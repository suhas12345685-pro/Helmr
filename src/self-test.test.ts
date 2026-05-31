import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { getServiceUrlHints, runSelfTest } from './self-test.js';

test('self-test reports gateway and hatchery URL hints without model checks', () => {
  assert.deepEqual(getServiceUrlHints({}), {
    gateway: 'http://localhost:3999',
    hatchery: 'http://localhost:4000',
  });
  assert.deepEqual(getServiceUrlHints({ HELMR_GATEWAY_PORT: '4999', HELMR_HATCHERY_URL: 'https://hatchery.example.test' }), {
    gateway: 'http://localhost:4999',
    hatchery: 'https://hatchery.example.test',
  });
});

test('self-test includes git, writable state directories, and URL hint checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'helmr-self-test-'));
  const dataDir = join(root, 'data');
  const configDir = join(root, 'config');
  const auditDir = join(root, 'audit');

  try {
    const results = await runSelfTest({
      HELMR_DATA_DIR: dataDir,
      HELMR_CONFIG_DIR: configDir,
      HELMR_AUDIT_DIR: auditDir,
      HELMR_GATEWAY_PORT: '4999',
      HELMR_HATCHERY_PORT: '5000',
    });
    const byName = new Map(results.map((result) => [result.name, result]));

    assert.equal(byName.has('git_version'), true);
    assert.equal(byName.get('data_dir_writable')?.passed, true);
    assert.equal(byName.get('config_dir_writable')?.passed, true);
    assert.equal(byName.get('audit_dir_writable')?.passed, true);
    assert.equal(byName.get('gateway_url_hint')?.detail, 'http://localhost:4999');
    assert.equal(byName.get('hatchery_url_hint')?.detail, 'http://localhost:5000');
    assert.equal([...byName.keys()].some((name) => name.includes('model')), false);

    assert.deepEqual((await readdir(dataDir)).filter((name) => name.startsWith('.helmr-self-test-')), []);
    assert.deepEqual((await readdir(configDir)).filter((name) => name.startsWith('.helmr-self-test-')), []);
    assert.deepEqual((await readdir(auditDir)).filter((name) => name.startsWith('.helmr-self-test-')), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
