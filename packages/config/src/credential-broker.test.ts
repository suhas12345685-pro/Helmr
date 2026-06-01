import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CredentialBroker } from './credential-broker.js';

const SECRETS = {
  OPENAI_API_KEY: 'sk-openai',
  ANTHROPIC_API_KEY: 'sk-anthropic',
  GITHUB_TOKEN: 'ghp-token',
  STRIPE_SECRET: 'stripe-secret',
};

test('a read-only job (no scoped capabilities) gets no secrets', () => {
  const broker = new CredentialBroker();
  assert.deepEqual(broker.grant(['workspace_read', 'shell_read'], SECRETS), {});
});

test('a network job gets network/provider secrets but not nothing-matching ones excluded', () => {
  const broker = new CredentialBroker();
  const granted = broker.grant(['network'], SECRETS);
  assert.equal(granted['OPENAI_API_KEY'], 'sk-openai');
  assert.equal(granted['ANTHROPIC_API_KEY'], 'sk-anthropic');
  assert.equal(granted['STRIPE_SECRET'], 'stripe-secret');
});

test('a git_write job gets only git credentials', () => {
  const broker = new CredentialBroker();
  const granted = broker.grant(['git_write'], SECRETS);
  assert.deepEqual(Object.keys(granted), ['GITHUB_TOKEN']);
});

test('secrets_read grants everything', () => {
  const broker = new CredentialBroker();
  assert.deepEqual(broker.grant(['secrets_read'], SECRETS), SECRETS);
});

test('scopedEnv removes ungranted known secrets but keeps non-secret env', () => {
  const broker = new CredentialBroker();
  const baseEnv = { ...SECRETS, PATH: '/usr/bin', HELMR_DATA_DIR: '/data' };
  const scoped = broker.scopedEnv(baseEnv, ['git_write'], Object.keys(SECRETS));
  assert.equal(scoped['GITHUB_TOKEN'], 'ghp-token');
  assert.equal(scoped['OPENAI_API_KEY'], undefined);
  assert.equal(scoped['STRIPE_SECRET'], undefined);
  // Non-secret env survives.
  assert.equal(scoped['PATH'], '/usr/bin');
  assert.equal(scoped['HELMR_DATA_DIR'], '/data');
});
