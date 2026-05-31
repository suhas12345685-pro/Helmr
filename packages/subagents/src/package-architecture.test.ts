import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBrowserReceipt } from '../../browser/src/index.js';
import { createReadOnlyCouncilPlan } from '../../council/src/index.js';
import { capabilityAllowedBySandbox, DEFAULT_SANDBOX_POLICY } from '../../sandbox/src/index.js';
import { getSubagent, SUBAGENTS } from './index.js';

test('architecture package stubs expose safe defaults', () => {
  const councilPlan = createReadOnlyCouncilPlan({ jobId: 'job_arch', request: 'summarize workspace' });
  assert.equal(councilPlan.risk, 'low');
  assert.equal(councilPlan.requiresApproval, false);
  assert.deepEqual(councilPlan.steps[0]?.requiredCapabilities, ['workspace_read']);

  assert.ok(SUBAGENTS.length >= 5);
  assert.equal(getSubagent('browser').kind, 'browser');

  const receipt = createBrowserReceipt({
    id: 'receipt_browser',
    jobId: 'job_arch',
    stepId: 'step_browser',
    request: { url: 'https://example.com', goal: 'inspect page', readonly: true },
  });
  assert.equal(receipt.capability, 'browser');
  assert.equal(receipt.approval, 'required');

  assert.equal(capabilityAllowedBySandbox(DEFAULT_SANDBOX_POLICY, 'workspace_read'), true);
  assert.equal(capabilityAllowedBySandbox(DEFAULT_SANDBOX_POLICY, 'workspace_write'), false);
});
