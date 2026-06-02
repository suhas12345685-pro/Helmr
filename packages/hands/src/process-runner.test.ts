import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

import { runProcess } from './process-runner.js';
import { CredentialBroker } from '../../config/src/credential-broker.js';

const baseOpts = { timeoutMs: 10_000, maxBufferBytes: 1024 * 64 };

test('subprocess inherits full env when no scoped env is provided', async () => {
  const prev = process.env['HELMR_TEST_SECRET'];
  process.env['HELMR_TEST_SECRET'] = 'leaky';
  try {
    const result = await runProcess(
      tmpdir(),
      ['node', '-e', 'process.stdout.write(process.env.HELMR_TEST_SECRET ?? "MISSING")'],
      baseOpts,
    );
    assert.equal(result.stdout, 'leaky');
  } finally {
    if (prev === undefined) delete process.env['HELMR_TEST_SECRET'];
    else process.env['HELMR_TEST_SECRET'] = prev;
  }
});

test('a broker-scoped env keeps provider secrets out of the subprocess', async () => {
  const broker = new CredentialBroker({
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    ANTHROPIC_API_KEY: 'sk-ant-should-not-leak',
    GITHUB_TOKEN: 'ghp_should-be-granted',
  });
  const { env } = broker.grant(['git_write']);

  const leaked = await runProcess(
    tmpdir(),
    ['node', '-e', 'process.stdout.write(process.env.ANTHROPIC_API_KEY ?? "ABSENT")'],
    { ...baseOpts, env },
  );
  assert.equal(leaked.stdout, 'ABSENT', 'provider key must not reach a git subprocess');

  const granted = await runProcess(
    tmpdir(),
    ['node', '-e', 'process.stdout.write(process.env.GITHUB_TOKEN ?? "ABSENT")'],
    { ...baseOpts, env },
  );
  assert.equal(granted.stdout, 'ghp_should-be-granted', 'granted credential must reach the subprocess');
});
