import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runShellRead, runGitStatus } from './shell-tools.js';

const WORKSPACE = process.cwd();

test('shellReadTool blocks disallowed commands', async () => {
  await assert.rejects(
    () => runShellRead(WORKSPACE, ['rm', '-rf', '/']),
    /not in read-only allowlist/,
  );

  await assert.rejects(
    () => runShellRead(WORKSPACE, ['npm', 'install', 'malware']),
    /not in read-only allowlist/,
  );
});

test('shellReadTool allows node version check', async () => {
  const result = await runShellRead(WORKSPACE, ['node', '--version']);
  assert.match(result.stdout, /v\d+\.\d+/);
  assert.equal(result.command, 'node --version');
});

test('gitStatusTool does not throw in non-git directory', async () => {
  const result = await runGitStatus(WORKSPACE);
  assert.ok(typeof result.stdout === 'string');
  assert.ok(typeof result.stderr === 'string');
});
