import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readWorkspaceFile, summarizeWorkspace } from './read-tools.js';

test('read tools summarize workspace and block path traversal', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'helmr-workspace-'));
  try {
    await writeFile(join(workspace, 'package.json'), '{"name":"demo"}\n', 'utf8');
    await writeFile(join(workspace, 'README.md'), '# Demo\n', 'utf8');

    const summary = await summarizeWorkspace(workspace);
    assert.equal(summary.files.includes('package.json'), true);
    assert.equal((await readWorkspaceFile(workspace, 'README.md')).includes('# Demo'), true);
    await assert.rejects(() => readWorkspaceFile(workspace, '../outside.txt'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
