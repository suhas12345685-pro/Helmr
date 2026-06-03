import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  triageBug,
  classifySeverity,
  canAutoOpenFixBranch,
  fixBranchName,
  generateFailingTest,
  BugStore,
  type StoredBug,
} from './index.js';

test('classifySeverity escalates security signals to critical', () => {
  assert.equal(
    classifySeverity({ title: 'Skill leaks credentials', description: 'token exfiltration' }),
    'critical',
  );
  assert.equal(classifySeverity({ title: 'App crashes on launch', description: 'hang' }), 'high');
  assert.equal(classifySeverity({ title: 'Typo in docs', description: 'wording' }), 'low');
  assert.equal(classifySeverity({ title: 'Weird behaviour', description: 'sometimes' }), 'medium');
});

test('triageBug marks non-reproducible reports and lists missing info', () => {
  const report = triageBug({ title: 'It broke', description: 'no details' });
  assert.equal(report.reproducible, false);
  assert.ok(report.missingInfo.includes('steps to reproduce'));
  assert.ok(report.labels.includes('needs-reproduction'));
});

test('triageBug marks reproducible reports with steps + expected', () => {
  const report = triageBug({
    title: 'Crash',
    description: 'crashes',
    steps: ['run helmr ask "x"'],
    expected: 'an answer',
    actual: 'a crash',
  });
  assert.equal(report.reproducible, true);
  assert.ok(!report.labels.includes('needs-reproduction'));
});

test('canAutoOpenFixBranch blocks critical and non-reproducible bugs', () => {
  const critical = triageBug({
    title: 'Security leak',
    description: 'exfiltrates token',
    steps: ['s'],
    expected: 'e',
  });
  assert.equal(canAutoOpenFixBranch(critical).allowed, false);

  const safe = triageBug({
    title: 'Off-by-one in counter',
    description: 'counts wrong',
    steps: ['s'],
    expected: 'e',
    actual: 'a',
  });
  assert.equal(canAutoOpenFixBranch(safe).allowed, true);
});

test('fixBranchName is a valid slug', () => {
  const report = triageBug({ title: 'Fix the Thing!!!', description: 'x' });
  assert.match(fixBranchName(report), /^bugfix\/bug-\d+-fix-the-thing$/);
});

test('generateFailingTest produces a runnable, failing test', () => {
  const report = triageBug({
    title: 'broken',
    description: 'x',
    steps: ['a', 'b'],
    expected: 'ok',
    actual: 'bad',
  });
  const src = generateFailingTest(report);
  assert.match(src, /node:test/);
  assert.match(src, /assert\.ok\(fixed/);
  assert.match(src, /1\. a/);
});

test('BugStore persists and patches bugs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-bugs-'));
  const store = new BugStore(join(dir, 'bugs'));
  const report = triageBug({ title: 'x', description: 'y' }, 'bug-1');
  const stored: StoredBug = { ...report, status: 'reported', updatedAt: report.createdAt };
  await store.write(stored);
  assert.equal((await store.get('bug-1'))?.status, 'reported');
  await store.patch('bug-1', { status: 'reproduced' });
  assert.equal((await store.get('bug-1'))?.status, 'reproduced');
  assert.equal((await store.list()).length, 1);
});
