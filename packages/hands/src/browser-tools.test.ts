import assert from 'node:assert/strict';
import { test } from 'node:test';

import { executeReceipt } from './executor.js';
import type { ToolReceipt } from '../../shared/src/index.js';

function browserReceipt(partial: Partial<ToolReceipt> = {}): ToolReceipt {
  return {
    id: 'r_browser',
    jobId: 'job1',
    stepId: 's1',
    tool: 'browser_automation',
    capability: 'browser',
    input: { url: 'https://example.com', goal: 'inspect', readonly: true },
    risk: 'low',
    approval: 'required',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...partial,
  };
}

test('browser automation is gated as an outward action when not authorized', async () => {
  delete process.env['HELMR_STANDING_OUTWARD'];
  const result = await executeReceipt(browserReceipt(), process.cwd());
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /outward action|explicit authority|denied/);
});

test('an authorized browser action dispatches and reports Playwright availability', async () => {
  process.env['HELMR_STANDING_OUTWARD'] = 'browser';
  try {
    const result = await executeReceipt(browserReceipt({ approval: 'not_required' }), process.cwd());
    // Playwright is an optional peer. Whether it is installed or not, the action
    // must dispatch past the gate — either succeeding with a perception payload
    // or failing with the actionable install error (never "unknown tool").
    if (result.status === 'failed') {
      assert.doesNotMatch(result.error ?? '', /unknown tool/);
    } else {
      assert.equal(result.status, 'succeeded');
    }
  } finally {
    delete process.env['HELMR_STANDING_OUTWARD'];
  }
});
