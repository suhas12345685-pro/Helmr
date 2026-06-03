import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { JsonlAuditLog } from './audit-jsonl.js';
import { backupHelmrState, restoreHelmrState } from './backup.js';
import { HelmrSQLiteStore } from './sqlite-store.js';
import type { HelmrPlan, ToolReceipt, ToolResult } from '../../shared/src/index.js';

test('backup and restore preserves SQLite state, audit chains, and config files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-backup-'));
  const source = {
    dataDir: join(dir, 'source', 'data'),
    auditDir: join(dir, 'source', 'audit'),
    configDir: join(dir, 'source', 'config'),
  };
  const restored = {
    dataDir: join(dir, 'restored', 'data'),
    auditDir: join(dir, 'restored', 'audit'),
    configDir: join(dir, 'restored', 'config'),
  };
  const backupDir = join(dir, 'backup');

  let sourceStore: HelmrSQLiteStore | undefined;
  let restoredStore: HelmrSQLiteStore | undefined;

  try {
    sourceStore = new HelmrSQLiteStore(join(source.dataDir, 'helmr.db'));
    await sourceStore.init();

    await sourceStore.upsertJob({
      id: 'job_backup',
      eventId: 'evt_backup',
      workspaceId: 'workspace_backup',
      status: 'queued',
      lane: 'interactive',
      priority: 80,
      attempts: 0,
      maxAttempts: 3,
      createdAt: '2026-05-31T12:00:00.000Z',
      updatedAt: '2026-05-31T12:00:00.000Z',
      leaseUntil: undefined,
      lastError: undefined,
      payloadText: 'verify backup and restore',
      workspacePath: '/workspace/project',
      finalResult: undefined,
    });

    const plan: HelmrPlan = {
      id: 'plan_backup',
      jobId: 'job_backup',
      summary: 'Read workspace and report backup health',
      risk: 'low',
      requiresApproval: false,
      steps: [
        {
          id: 'step_read',
          title: 'Read workspace',
          kind: 'read',
          agent: 'research',
          canRunInParallelWith: [],
          requiredCapabilities: ['workspace_read'],
        },
      ],
    };
    await sourceStore.savePlan(plan);

    const receipt: ToolReceipt = {
      id: 'receipt_backup',
      jobId: 'job_backup',
      stepId: 'step_read',
      tool: 'summarizeWorkspace',
      capability: 'workspace_read',
      input: { path: '/workspace/project' },
      risk: 'low',
      approval: 'not_required',
      createdAt: '2026-05-31T12:00:01.000Z',
    };
    await sourceStore.saveReceipt(receipt);

    const result: ToolResult = {
      id: 'result_backup',
      receiptId: 'receipt_backup',
      jobId: 'job_backup',
      status: 'succeeded',
      output: { files: 42 },
      error: undefined,
      createdAt: '2026-05-31T12:00:02.000Z',
    };
    await sourceStore.saveResult(result);
    await sourceStore.createApproval('approval_backup', 'job_backup', 'plan');
    await sourceStore.decideApproval('approval_backup', 'approved');

    const sourceAudit = new JsonlAuditLog(source.auditDir);
    await sourceAudit.append({
      kind: 'event',
      jobId: 'job_backup',
      createdAt: '2026-05-31T12:00:00.000Z',
      data: { text: 'verify backup and restore' },
    });
    await sourceAudit.append({
      kind: 'result',
      jobId: 'job_backup',
      createdAt: '2026-05-31T12:00:02.000Z',
      data: result,
    });
    await mkdir(source.configDir, { recursive: true });
    await writeFile(join(source.configDir, 'POLICY.md'), '# Policy\nBackup me.\n');

    await backupHelmrState({ ...source, backupDir });

    await sourceStore.updateJobStatus('job_backup', 'succeeded');
    await appendFile(join(source.auditDir, 'job_backup.jsonl'), 'tampered\n');
    await writeFile(join(source.configDir, 'POLICY.md'), '# Policy\nChanged after backup.\n');

    await restoreHelmrState({ ...restored, backupDir });

    restoredStore = new HelmrSQLiteStore(join(restored.dataDir, 'helmr.db'));
    await restoredStore.init();

    assert.deepEqual(await restoredStore.getJob('job_backup'), {
      id: 'job_backup',
      eventId: 'evt_backup',
      workspaceId: 'workspace_backup',
      status: 'queued',
      lane: 'interactive',
      priority: 80,
      attempts: 0,
      maxAttempts: 3,
      createdAt: '2026-05-31T12:00:00.000Z',
      updatedAt: '2026-05-31T12:00:00.000Z',
      leaseUntil: undefined,
      lastError: undefined,
      payloadText: 'verify backup and restore',
      workspacePath: '/workspace/project',
      finalResult: undefined,
      replyTo: undefined,
    });
    assert.deepEqual(await restoredStore.getPlan('job_backup'), plan);
    assert.deepEqual(await restoredStore.getReceipt('receipt_backup'), receipt);
    assert.deepEqual(await restoredStore.getResultForReceipt('receipt_backup'), result);
    assert.deepEqual(await restoredStore.getApproval('approval_backup'), {
      decision: 'approved',
      jobId: 'job_backup',
    });

    const restoredAudit = new JsonlAuditLog(restored.auditDir);
    assert.deepEqual(await restoredAudit.verifyJob('job_backup'), { valid: true, recordsChecked: 2 });
    assert.equal(await readFile(join(restored.configDir, 'POLICY.md'), 'utf8'), '# Policy\nBackup me.\n');
  } finally {
    sourceStore?.close();
    restoredStore?.close();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
