import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CredentialBroker, isCredentialScopedCapability } from './credential-broker.js';

const source = {
  PATH: '/usr/bin',
  HOME: '/home/agent',
  // Provider secrets that tools must NOT inherit.
  ANTHROPIC_API_KEY: 'sk-ant-secret',
  OPENAI_API_KEY: 'sk-openai-secret',
  // Capability-scoped credentials.
  GITHUB_TOKEN: 'ghp_token',
  NPM_TOKEN: 'npm_token',
};

test('base env is always granted but provider API keys never are', () => {
  const broker = new CredentialBroker(source);
  const { env, grantedKeys } = broker.grant(['workspace_read']);
  assert.equal(env['PATH'], '/usr/bin');
  assert.equal(env['HOME'], '/home/agent');
  assert.equal(env['ANTHROPIC_API_KEY'], undefined);
  assert.equal(env['OPENAI_API_KEY'], undefined);
  assert.deepEqual(grantedKeys, []);
});

test('git_write grants the git token but not the npm token', () => {
  const broker = new CredentialBroker(source);
  const { env, grantedKeys } = broker.grant(['git_write']);
  assert.equal(env['GITHUB_TOKEN'], 'ghp_token');
  assert.equal(env['NPM_TOKEN'], undefined);
  assert.equal(env['ANTHROPIC_API_KEY'], undefined);
  assert.ok(grantedKeys.includes('GITHUB_TOKEN'));
});

test('package_install grants the npm token but not the git token', () => {
  const broker = new CredentialBroker(source);
  const { env, grantedKeys } = broker.grant(['package_install']);
  assert.equal(env['NPM_TOKEN'], 'npm_token');
  assert.equal(env['GITHUB_TOKEN'], undefined);
  assert.ok(grantedKeys.includes('NPM_TOKEN'));
});

test('grants are unioned across multiple capabilities', () => {
  const broker = new CredentialBroker(source);
  const { env } = broker.grant(['git_write', 'package_install']);
  assert.equal(env['GITHUB_TOKEN'], 'ghp_token');
  assert.equal(env['NPM_TOKEN'], 'npm_token');
});

test('absent or empty secrets are not granted', () => {
  const broker = new CredentialBroker({ PATH: '/usr/bin', GITHUB_TOKEN: '   ' });
  const { env, grantedKeys } = broker.grant(['git_write']);
  assert.equal(env['GITHUB_TOKEN'], undefined);
  assert.deepEqual(grantedKeys, []);
});

test('isCredentialScopedCapability reflects the mapping', () => {
  assert.equal(isCredentialScopedCapability('git_write'), true);
  assert.equal(isCredentialScopedCapability('package_install'), true);
  assert.equal(isCredentialScopedCapability('workspace_read'), false);
});
