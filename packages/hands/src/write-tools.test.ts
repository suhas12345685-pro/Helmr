import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  writeWorkspaceFile,
  deleteWorkspaceFile,
  renameWorkspaceFile,
  runShellWrite,
  gitAdd,
  gitCommit,
  gitCheckout,
  npmInstall,
} from './write-tools.js';

test('filesystem write tools block path traversal', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'helmr-write-workspace-'));
  try {
    // 1. writeWorkspaceFile path traversal
    await assert.rejects(
      () => writeWorkspaceFile(workspace, '../outside.txt', 'hello'),
      /path traversal denied/,
    );
    await assert.rejects(
      () => writeWorkspaceFile(workspace, '..\\outside.txt', 'hello'),
      /path traversal denied/,
    );
    await assert.rejects(
      () => writeWorkspaceFile(workspace, '', 'hello'),
      /path traversal denied/,
    );

    // 2. deleteWorkspaceFile path traversal
    await assert.rejects(
      () => deleteWorkspaceFile(workspace, '../outside.txt'),
      /path traversal denied/,
    );

    // 3. renameWorkspaceFile path traversal
    await assert.rejects(
      () => renameWorkspaceFile(workspace, 'file.txt', '../outside.txt'),
      /path traversal denied/,
    );
    await assert.rejects(
      () => renameWorkspaceFile(workspace, '../outside.txt', 'file.txt'),
      /path traversal denied/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('filesystem write tools work successfully for valid paths', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'helmr-write-workspace-'));
  try {
    // Write a file
    const writeRes = await writeWorkspaceFile(workspace, 'src/test.txt', 'hello world');
    assert.equal(writeRes.success, true);
    assert.equal(writeRes.operation, 'write');
    assert.equal(writeRes.path.replace(/\\/g, '/'), 'src/test.txt');

    const fileContent = await readFile(join(workspace, 'src/test.txt'), 'utf8');
    assert.equal(fileContent, 'hello world');

    // Rename a file
    const renameRes = await renameWorkspaceFile(workspace, 'src/test.txt', 'src/new-test.txt');
    assert.equal(renameRes.success, true);
    assert.equal(renameRes.operation, 'rename');
    assert.equal(renameRes.path.replace(/\\/g, '/'), 'src/new-test.txt');

    await assert.rejects(() => access(join(workspace, 'src/test.txt')));
    const renamedContent = await readFile(join(workspace, 'src/new-test.txt'), 'utf8');
    assert.equal(renamedContent, 'hello world');

    // Delete a file
    const deleteRes = await deleteWorkspaceFile(workspace, 'src/new-test.txt');
    assert.equal(deleteRes.success, true);
    assert.equal(deleteRes.operation, 'delete');
    await assert.rejects(() => access(join(workspace, 'src/new-test.txt')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runShellWrite gates and blocks non-allowlisted commands', async () => {
  const workspace = process.cwd();

  // Non-allowlisted command
  await assert.rejects(
    () => runShellWrite(workspace, ['format', 'c:']),
    /command not in write allowlist/,
  );

  // Command starting with allowed prefix but containing chaining/injection
  await assert.rejects(
    () => runShellWrite(workspace, ['git', 'status', '&&', 'rm', '-rf', '/']),
    /command not in write allowlist/,
  );

  await assert.rejects(
    () => runShellWrite(workspace, ['curl', 'http://evil.test']),
    /command not in write allowlist/,
  );

  await assert.rejects(
    () => runShellWrite(workspace, ['echo', 'hello']),
    /command not in write allowlist/,
  );
});

test('gitAdd, gitCommit, gitCheckout validate inputs and sanitize parameters', async () => {
  const workspace = process.cwd();

  // gitAdd path traversal checks
  await assert.rejects(
    () => gitAdd(workspace, ['../outside.txt']),
    /path traversal denied in gitAdd/,
  );

  await assert.rejects(
    () => gitAdd(workspace, ['src/file.ts\nrm']),
    /invalid characters in path/,
  );

  // gitCommit metacharacter check
  await assert.rejects(
    () => gitCommit(workspace, 'feat: something\nrm -rf'),
    /commit message contains forbidden control delimiters/,
  );

  // gitCheckout ref validation
  await assert.rejects(
    () => gitCheckout(workspace, 'branch-name; rm -rf'),
    /invalid ref for checkout/,
  );
});

test('npmInstall validates packages and options', async () => {
  const workspace = process.cwd();

  // npmInstall shell injection in packages
  await assert.rejects(
    () => npmInstall(workspace, ['lodash; rm -rf']),
    /invalid package name or specifier/,
  );

  await assert.rejects(
    () => npmInstall(workspace, ['lodash && whoami']),
    /invalid package name or specifier/,
  );
});

test('package_install receipts require approval and dispatch to npmInstall validation', async () => {
  const { executeReceipt } = await import('./executor.js');
  const workspace = process.cwd();
  const baseReceipt = {
    id: 'receipt_package_install',
    jobId: 'job_package_install',
    stepId: 'step_package_install',
    tool: 'package_install',
    capability: 'package_install' as const,
    input: { packages: ['lodash; rm -rf'] },
    risk: 'high' as const,
    createdAt: new Date().toISOString(),
  };

  const denied = await executeReceipt({ ...baseReceipt, approval: 'required' as const }, workspace);
  assert.equal(denied.status, 'failed');
  assert.match(denied.error ?? '', /approval is required/);

  const approvedButInvalid = await executeReceipt({ ...baseReceipt, approval: 'approved' as const }, workspace);
  assert.equal(approvedButInvalid.status, 'failed');
  assert.match(approvedButInvalid.error ?? '', /invalid package name or specifier/);
});
