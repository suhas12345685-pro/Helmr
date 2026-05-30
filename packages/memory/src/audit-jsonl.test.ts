import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { JsonlAuditLog } from './audit-jsonl.js';

test('audit log appends and reads JSONL records by job', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-audit-'));
  try {
    const audit = new JsonlAuditLog(dir);
    await audit.append({
      kind: 'event',
      jobId: 'job_1',
      createdAt: '2026-05-28T10:00:00.000Z',
      data: { text: 'hello' },
    });

    const records = await audit.readJob('job_1');
    assert.equal(records.length, 1);
    assert.equal(records[0]?.kind, 'event');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('audit log verifies hash chains and detects tampering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-audit-'));
  try {
    const audit = new JsonlAuditLog(dir);
    await audit.append({
      kind: 'event',
      jobId: 'job_1',
      createdAt: '2026-05-28T10:00:00.000Z',
      data: { text: 'hello' },
    });
    await audit.append({
      kind: 'result',
      jobId: 'job_1',
      createdAt: '2026-05-28T10:00:01.000Z',
      data: { answer: 'done' },
    });

    const verified = await audit.verifyJob('job_1');
    assert.equal(verified.valid, true);
    assert.equal(verified.recordsChecked, 2);

    const path = join(dir, 'job_1.jsonl');
    const raw = await readFile(path, 'utf8');
    await writeFile(path, raw.replace('"done"', '"changed"'), 'utf8');

    const tampered = await audit.verifyJob('job_1');
    assert.equal(tampered.valid, false);
    assert.equal(tampered.failureReason, 'hash mismatch at line 2');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
