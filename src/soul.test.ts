import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SoulLoader, resolveSoulPath, buildSoulContext, loadSoul } from './soul.js';

test('the real soul.md loads and contains its core sections', () => {
  const soul = loadSoul();
  assert.equal(soul.found, true, 'soul.md should be found from the repo root');
  assert.match(soul.content, /Prime Directive/);
  assert.match(soul.content, /Multi-Agent Coordination Philosophy/);
  assert.match(soul.content, /Helmr understands momentum/);
});

test('SoulLoader reads an explicit soul file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-soul-'));
  try {
    const path = join(dir, 'soul.md');
    await writeFile(path, '# soul\n\nPrime Directive: amplify.\n', 'utf8');
    const result = new SoulLoader(path).load();
    assert.equal(result.found, true);
    assert.equal(result.path, path);
    assert.match(result.content, /amplify/);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('SoulLoader fails safely when soul.md is missing — no throw, clear error', () => {
  const logs: string[] = [];
  const result = new SoulLoader('/definitely/not/here/soul.md', (m) => logs.push(m)).load();
  assert.equal(result.found, false);
  assert.equal(result.content, '');
  assert.match(result.error ?? '', /not found/);
  assert.ok(logs.some((l) => l.includes('[soul]')), 'a clear error should be logged');
});

test('SoulLoader treats an empty soul.md as not found', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-soul-empty-'));
  try {
    const path = join(dir, 'soul.md');
    await writeFile(path, '   \n', 'utf8');
    const result = new SoulLoader(path, () => {}).load();
    assert.equal(result.found, false);
    assert.match(result.error ?? '', /empty/);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('resolveSoulPath honors HELMR_SOUL_PATH override', () => {
  const path = resolveSoulPath({ HELMR_SOUL_PATH: '/custom/soul.md' }, '/somewhere');
  assert.equal(path, '/custom/soul.md');
});

test('buildSoulContext wraps the constitution for prompt injection', () => {
  const ctx = buildSoulContext();
  assert.match(ctx, /<helmr-soul source="soul.md">/);
  assert.match(ctx, /<\/helmr-soul>/);
});
