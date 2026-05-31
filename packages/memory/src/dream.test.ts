import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { synthesizeDream, DreamJournal, type DreamJobMemory } from './dream.js';

function jobs(...entries: Array<Partial<DreamJobMemory> & { id: string }>): DreamJobMemory[] {
  return entries.map((e) => ({ status: 'succeeded', updatedAt: new Date().toISOString(), ...e }));
}

test('an empty mind dreams of staying warm', () => {
  const dream = synthesizeDream({ recentJobs: [] });
  assert.equal(dream.jobsConsidered, 0);
  assert.match(dream.reflection, /No dominant theme/);
  assert.ok(dream.suggestions.some((s) => /workspace inspection/i.test(s)));
});

test('dream surfaces failures as heal proposals', () => {
  const dream = synthesizeDream({
    recentJobs: jobs(
      { id: 'a', status: 'succeeded', payloadText: 'summarize the workspace' },
      { id: 'b', status: 'failed', payloadText: 'deploy the workspace', lastError: 'lock timeout on workspace' },
      { id: 'c', status: 'awaiting_approval', payloadText: 'delete the workspace' },
    ),
  });

  assert.equal(dream.jobsConsidered, 3);
  assert.ok(dream.suggestions.some((s) => /1 failed job/i.test(s) && /lock timeout/i.test(s)));
  assert.ok(dream.suggestions.some((s) => /waiting on approval/i.test(s)));
  // "workspace" recurs across jobs and should surface as a theme.
  assert.ok(dream.themes.includes('workspace'));
});

test('themes require recurrence, not a single mention', () => {
  const dream = synthesizeDream({
    recentJobs: jobs({ id: 'a', payloadText: 'migrate database schema' }),
  });
  assert.deepEqual(dream.themes, []);
});

test('DreamJournal persists and lists dreams newest-first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-dreams-'));
  try {
    const journal = new DreamJournal(dir);
    assert.deepEqual(await journal.list(), []);

    const first = synthesizeDream({ recentJobs: jobs({ id: 'a' }), now: new Date('2026-01-01T00:00:00Z') });
    const second = synthesizeDream({ recentJobs: jobs({ id: 'b' }), now: new Date('2026-01-02T00:00:00Z') });
    await journal.record(first);
    await journal.record(second);

    const listed = await journal.list();
    assert.equal(listed.length, 2);
    assert.equal(listed[0]?.id, second.id); // newest first
    assert.equal(listed[1]?.id, first.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
