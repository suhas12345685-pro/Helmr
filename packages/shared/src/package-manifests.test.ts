import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

const packageNames = [
  'browser',
  'channels',
  'config',
  'cortex',
  'council',
  'gateway',
  'hands',
  'hatchery-api',
  'mastra',
  'mcp',
  'memory',
  'router',
  'sandbox',
  'scheduler',
  'shared',
  'subagents',
] as const;

test('architecture packages have package manifests', async () => {
  for (const packageName of packageNames) {
    const path = join('packages', packageName, 'package.json');
    await access(path);
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { name?: string; private?: boolean; type?: string };
    assert.equal(manifest.name, `@helmr/${packageName}`);
    assert.equal(manifest.private, true);
    assert.equal(manifest.type, 'module');
  }
});
