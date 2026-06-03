import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { executeReceipt } from './executor.js';
import type { StandingApprovalPolicy } from '../../cortex/src/gate.js';
import type { ToolReceipt } from '../../shared/src/index.js';

async function withServer<T>(fn: (url: string, host: string) => Promise<T>): Promise<T> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}/`, `127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function httpReceipt(url: string, partial: Partial<ToolReceipt> = {}): ToolReceipt {
  return {
    id: 'r1',
    jobId: 'j1',
    stepId: 's1',
    tool: 'http_request',
    capability: 'network',
    input: { url },
    risk: 'high',
    approval: 'required',
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

test('a gated outward receipt without approval is refused before dispatch', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'helmr-gate-'));
  try {
    // No standing policy → network is gated; refused with a `gated` error and
    // never reaches the (unreachable) server.
    const result = await executeReceipt(httpReceipt('http://127.0.0.1:1/'), ws);
    assert.equal(result.status, 'failed');
    assert.match(result.error ?? '', /gated/);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test('standing policy promotes a matching host and the request executes', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'helmr-gate-'));
  try {
    await withServer(async (url, host) => {
      const policy: StandingApprovalPolicy = { rules: { network: { allowHosts: [host] } } };
      const result = await executeReceipt(httpReceipt(url), ws, { standingPolicy: policy });
      assert.equal(result.status, 'succeeded');
      assert.equal((result.output as { status: number }).status, 200);
    });
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test('a host outside the standing allow-list stays gated', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'helmr-gate-'));
  try {
    const policy: StandingApprovalPolicy = { rules: { network: { allowHosts: ['api.github.com'] } } };
    const result = await executeReceipt(httpReceipt('http://127.0.0.1:1/'), ws, { standingPolicy: policy });
    assert.equal(result.status, 'failed');
    assert.match(result.error ?? '', /gated/);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test('an explicitly approved gated receipt is allowed past the gate', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'helmr-gate-'));
  try {
    await withServer(async (url) => {
      const result = await executeReceipt(httpReceipt(url, { approval: 'approved' }), ws);
      assert.equal(result.status, 'succeeded');
    });
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});
