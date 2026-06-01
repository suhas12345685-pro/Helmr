import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SkillRegistry, matchSkills, parseSkillManifest } from './index.js';

async function tempRegistry(): Promise<SkillRegistry> {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-skills-'));
  const registry = new SkillRegistry(join(dir, 'skills'));
  await registry.init();
  return registry;
}

test('write persists a skill and list auto-discovers it', async () => {
  const registry = await tempRegistry();
  const written = await registry.write(
    parseSkillManifest({
      id: 'summarize-pr',
      name: 'Summarize PR',
      description: 'Summarize an open pull request',
      triggers: ['summarize pr', 'pr summary'],
    }),
  );

  assert.equal(written.id, 'summarize-pr');
  assert.ok(written.createdAt, 'createdAt is stamped on write');

  const all = await registry.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.id, 'summarize-pr');
});

test('write preserves createdAt across updates and refreshes updatedAt', async () => {
  const registry = await tempRegistry();
  const first = await registry.write(
    parseSkillManifest({ id: 'note', name: 'Note', description: 'Take a note' }),
  );
  await new Promise((r) => setTimeout(r, 5));
  const second = await registry.write(
    parseSkillManifest({ id: 'note', name: 'Note v2', description: 'Take a better note' }),
  );

  assert.equal(second.createdAt, first.createdAt);
  assert.notEqual(second.updatedAt, first.createdAt);
  assert.equal((await registry.get('note'))?.name, 'Note v2');
});

test('setEnabled toggles a skill and remove deletes it', async () => {
  const registry = await tempRegistry();
  await registry.write(parseSkillManifest({ id: 'demo', name: 'Demo', description: 'demo' }));

  const disabled = await registry.setEnabled('demo', false);
  assert.equal(disabled?.enabled, false);
  assert.equal((await registry.listEnabled()).length, 0);

  assert.equal(await registry.remove('demo'), true);
  assert.equal((await registry.list()).length, 0);
  assert.equal(await registry.remove('demo'), false);
});

test('list skips malformed skill files instead of crashing', async () => {
  const registry = await tempRegistry();
  await registry.write(parseSkillManifest({ id: 'good', name: 'Good', description: 'ok' }));
  await writeFile(join(registry.dir, 'broken.skill.json'), '{ not valid json', 'utf8');
  await writeFile(join(registry.dir, 'ignore-me.txt'), 'not a skill', 'utf8');

  const all = await registry.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.id, 'good');
});

test('list returns empty array when the skills directory is absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-skills-'));
  const registry = new SkillRegistry(join(dir, 'does-not-exist'));
  assert.deepEqual(await registry.list(), []);
});

test('matchSkills returns enabled skills whose triggers appear in the text', async () => {
  const skills = [
    parseSkillManifest({ id: 'pr', name: 'PR', description: 'pr', triggers: ['pull request', 'pr'] }),
    parseSkillManifest({ id: 'off', name: 'Off', description: 'off', triggers: ['pr'], enabled: false }),
    parseSkillManifest({ id: 'deploy', name: 'Deploy', description: 'deploy', triggers: ['deploy'] }),
  ];

  const matched = matchSkills(skills, 'Please open a Pull Request for me');
  assert.deepEqual(matched.map((s) => s.id), ['pr']);
});

test('parseSkillManifest rejects ids that are not lower-case slugs', () => {
  assert.throws(() => parseSkillManifest({ id: 'Bad Id', name: 'x', description: 'y' }));
});

test('load refreshes the cached snapshot from disk', async () => {
  const registry = await tempRegistry();
  assert.deepEqual(registry.cached(), []);

  await registry.write(parseSkillManifest({ id: 'a', name: 'A', description: 'a' }));
  const loaded = await registry.load();
  assert.equal(loaded.length, 1);
  assert.equal(registry.cached().length, 1);

  await registry.write(parseSkillManifest({ id: 'b', name: 'B', description: 'b' }));
  await registry.load();
  assert.equal(registry.cached().length, 2);
});

test('watch performs an initial load, populates the cache, and is stoppable', async () => {
  const registry = await tempRegistry();
  await registry.write(parseSkillManifest({ id: 'live', name: 'Live', description: 'live' }));

  const initial = await new Promise<{ id: string }[]>((resolve) => {
    const stop = registry.watch((skills) => {
      stop();
      resolve(skills);
    });
  });

  assert.ok(initial.some((s) => s.id === 'live'));
  assert.ok(registry.cached().some((s) => s.id === 'live'));
});
