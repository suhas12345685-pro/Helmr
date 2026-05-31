import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';

import {
  escapesWorkspace,
  assertWithinWorkspace,
  evaluateCommand,
  assertCommandAllowed,
  scrubEnv,
  keyLooksSecret,
  createSandboxProfile,
  commandPolicyOf,
  prepareSandboxedSpawn,
  checkCommand,
  checkPath,
} from './index.js';

const ROOT = resolve('/tmp/helmr-sandbox-ws');

// ── path jail ───────────────────────────────────────────────────────

test('path jail allows files inside the workspace', () => {
  assert.equal(escapesWorkspace(ROOT, 'src/index.ts'), false);
  assert.equal(escapesWorkspace(ROOT, './a/b/c.txt'), false);
});

test('path jail rejects traversal outside the workspace', () => {
  assert.equal(escapesWorkspace(ROOT, '../secrets.env'), true);
  assert.equal(escapesWorkspace(ROOT, '../../etc/passwd'), true);
  assert.equal(escapesWorkspace(ROOT, '/etc/passwd'), true);
});

test('path jail treats the root itself as non-escaping', () => {
  assert.equal(escapesWorkspace(ROOT, '.'), false);
});

test('assertWithinWorkspace throws on escape and resolves valid paths', () => {
  assert.throws(() => assertWithinWorkspace(ROOT, '../oops'), /escapes workspace sandbox/);
  assert.equal(assertWithinWorkspace(ROOT, 'pkg/file.ts'), resolve(ROOT, 'pkg/file.ts'));
});

// ── command policy ──────────────────────────────────────────────────

const readPolicy = commandPolicyOf(createSandboxProfile('read', ROOT));

test('command policy allows an allowlisted read command', () => {
  assert.equal(evaluateCommand(['git', 'status'], readPolicy).allowed, true);
});

test('command policy denies a command not in the allowlist', () => {
  const decision = evaluateCommand(['rm', '-rf', '.'], readPolicy);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? '', /allowlist/);
});

test('command policy always denies privilege escalation', () => {
  const writePolicy = commandPolicyOf(createSandboxProfile('write', ROOT));
  const decision = evaluateCommand(['sudo', 'npm', 'install'], writePolicy);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? '', /privilege escalation/);
});

test('command policy denies network tools unless network is allowed', () => {
  assert.equal(evaluateCommand(['curl', 'https://x'], readPolicy).allowed, false);
  const exclusive = commandPolicyOf(createSandboxProfile('exclusive', ROOT));
  // exclusive permits network, but curl is still not on the allowlist
  assert.equal(evaluateCommand(['curl', 'https://x'], exclusive).reason?.includes('network'), false);
});

test('assertCommandAllowed throws with the policy reason', () => {
  assert.throws(() => assertCommandAllowed(['sudo', 'ls'], readPolicy), /privilege escalation/);
});

// ── env scrub ───────────────────────────────────────────────────────

test('scrubEnv keeps only allowed, non-secret keys', () => {
  const result = scrubEnv(
    { PATH: '/usr/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'sk-secret', RANDOM: 'x' },
    { allow: ['PATH', 'HOME', 'ANTHROPIC_API_KEY'] },
  );
  assert.equal(result['PATH'], '/usr/bin');
  assert.equal(result['HOME'], '/home/u');
  assert.equal(result['ANTHROPIC_API_KEY'], undefined, 'secret key dropped even when allowed');
  assert.equal(result['RANDOM'], undefined, 'non-allowed key dropped');
});

test('keyLooksSecret flags credential-shaped names', () => {
  assert.equal(keyLooksSecret('OPENAI_API_KEY'), true);
  assert.equal(keyLooksSecret('SESSION_TOKEN'), true);
  assert.equal(keyLooksSecret('PATH'), false);
});

// ── profiles + spawn prep ───────────────────────────────────────────

test('profiles escalate command breadth from read to exclusive', () => {
  const read = createSandboxProfile('read', ROOT);
  const write = createSandboxProfile('write', ROOT);
  const exclusive = createSandboxProfile('exclusive', ROOT);
  assert.ok(read.allowedCommands.length < write.allowedCommands.length);
  assert.ok(write.allowedCommands.length < exclusive.allowedCommands.length);
  assert.equal(read.network, 'denied');
  assert.equal(exclusive.network, 'allowed');
});

test('prepareSandboxedSpawn returns jailed cwd, scrubbed env, and limits', () => {
  const profile = createSandboxProfile('write', ROOT);
  const plan = prepareSandboxedSpawn(profile, ['npm', 'install'], {
    PATH: '/usr/bin',
    GITHUB_TOKEN: 'ghp_secret',
  });
  assert.equal(plan.cwd, ROOT);
  assert.equal(plan.env['PATH'], '/usr/bin');
  assert.equal(plan.env['GITHUB_TOKEN'], undefined);
  assert.equal(plan.timeoutMs, profile.timeoutMs);
  assert.equal(plan.maxBufferBytes, profile.maxBufferBytes);
});

test('prepareSandboxedSpawn throws for denied commands', () => {
  const profile = createSandboxProfile('read', ROOT);
  assert.throws(() => prepareSandboxedSpawn(profile, ['rm', '-rf', '/']), /allowlist|privilege/);
});

test('checkCommand and checkPath expose profile-bound helpers', () => {
  const profile = createSandboxProfile('read', ROOT);
  assert.equal(checkCommand(profile, ['git', 'status']).allowed, true);
  assert.equal(checkPath(profile, 'src/a.ts'), true);
  assert.equal(checkPath(profile, '../escape'), false);
});
