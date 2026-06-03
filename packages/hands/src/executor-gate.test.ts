import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeReceipt } from './executor.js';
import type { StandingApprovalPolicy } from '../../cortex/src/gate.js';
import type { ToolReceipt } from '../../shared/src/index.js';

function outwardReceipt(partial: Partial<ToolReceipt> = {}): ToolReceipt {
  return {
    id: 'r1',
    jobId: 'j1',
    stepId: 's1',
    tool: 'http_request',
    capability: 'network',
    input: { url: 'https://api.github.com/x' },
    risk: 'high',
    approval: 'required',
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

test('a gated outward receipt without approval is refused before dispatch', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'helmr-gate-'));
  try {
    const result = await executeReceipt(outwardReceipt(), ws);
    assert.equal(result.status, 'failed');
    assert.match(result.error ?? '', /gated/);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test('standing policy promotes a matching host and dispatch proceeds', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'helmr-gate-'));
  const policy: StandingApprovalPolicy = { rules: { network: { allowHosts: ['api.github.com'] } } };
  try {
    // No http_request tool exists yet, so dispatch fails on unknown tool — but
    // crucially NOT with a `gated` error: the gate let it through.
    const result = await executeReceipt(outwardReceipt(), ws, { standingPolicy: policy });
    assert.equal(result.status, 'failed');
    assert.doesNotMatch(result.error ?? '', /gated/);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test('an approved gated receipt is allowed past the gate', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'helmr-gate-'));
  try {
    const result = await executeReceipt(outwardReceipt({ approval: 'approved' }), ws);
    assert.equal(result.status, 'failed');
    assert.doesNotMatch(result.error ?? '', /gated/);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});
