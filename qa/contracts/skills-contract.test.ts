import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseSkillManifest } from '../../packages/skills/src/index.js';

test('built-in starter skills satisfy the expanded Helmr skill manifest contract', async () => {
  const ids = ['memory.remember', 'browser.research', 'scheduler.cron', 'channel.reply', 'workspace.read', 'code.review', 'decision.council', 'safety.approval', 'audit.explain'];
  for (const id of ids) {
    const manifest = parseSkillManifest(JSON.parse(await readFile(join('packages/skills/builtin', `${id}.skill.json`), 'utf8')));
    assert.equal(manifest.id, id);
    assert.ok(manifest.permissions.length > 0);
  }
});
