import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NucleoidLogicProvider } from './nucleoid-adapter.js';

const readOnlyPlan = {
  id: 'plan_1',
  jobId: 'job_1',
  summary: 'read workspace',
  risk: 'low' as const,
  requiresApproval: false,
  steps: [
    {
      id: 'step_1',
      title: 'read files',
      kind: 'read' as const,
      agent: 'research' as const,
      canRunInParallelWith: [],
      requiredCapabilities: ['workspace_read' as const],
    },
  ],
};

const writePlan = {
  id: 'plan_2',
  jobId: 'job_1',
  summary: 'write files',
  risk: 'medium' as const,
  requiresApproval: true,
  steps: [
    {
      id: 'step_2',
      title: 'write file',
      kind: 'write' as const,
      agent: 'coding' as const,
      canRunInParallelWith: [],
      requiredCapabilities: ['workspace_write' as const],
    },
  ],
};

test('NucleoidLogicProvider disabled — delegates to Helmr deterministic engine', async () => {
  const provider = new NucleoidLogicProvider({ enabled: false });

  const explanation = await provider.explain({ kind: 'plan', plan: readOnlyPlan });
  assert.equal(explanation.allowed, true);
  assert.equal(explanation.provider, 'helmr-deterministic');
});

test('NucleoidLogicProvider disabled — write plan is explained as allowed=false', async () => {
  const provider = new NucleoidLogicProvider({ enabled: false });

  const explanation = await provider.explain({ kind: 'plan', plan: writePlan });
  assert.equal(explanation.allowed, false);
  assert.ok(explanation.reasons.length > 0);
});

test('NucleoidLogicProvider disabled — suggest returns empty array', async () => {
  const provider = new NucleoidLogicProvider({ enabled: false });

  const suggestions = await provider.suggest?.({ kind: 'plan', plan: readOnlyPlan });
  assert.deepEqual(suggestions, []);
});

test('NucleoidLogicProvider disabled — write plan suggest returns advisory', async () => {
  const provider = new NucleoidLogicProvider({ enabled: false });

  const suggestions = await provider.suggest?.({ kind: 'plan', plan: writePlan });
  assert.equal(suggestions?.length, 0);
});
