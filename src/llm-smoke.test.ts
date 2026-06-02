import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldUseLocalAgentFallback } from './local-agent.js';

/**
 * Live-LLM smoke test — the missing coverage for the product's core value.
 *
 * Every other test exercises the offline deterministic fallback, which proves
 * the plumbing but not that "the agent does the task well". This test drives the
 * REAL reasoning path (a live model call through the failover chain, with
 * structured output) and asserts the model returns a schema-valid plan.
 *
 * It is key-gated: with no provider API key configured it skips cleanly (so the
 * default CI run and local dev stay hermetic and free). The dedicated CI job
 * sets ANTHROPIC_API_KEY from a secret to actually run it.
 */

const hasModelKey = !shouldUseLocalAgentFallback();
const skipReason = hasModelKey
  ? false
  : 'no model API key configured — set ANTHROPIC_API_KEY (or another provider key) to run the live smoke test';

test('live LLM: council produces a schema-valid structured plan', { skip: skipReason }, async () => {
  const { councilAgentChain, generateWithFailover } = await import('../packages/mastra/src/index.js');
  const { HelmrPlanSchema } = await import('../packages/shared/src/index.js');

  const result = await generateWithFailover(
    councilAgentChain(),
    [
      {
        role: 'user',
        content:
          'Plan a read-only summary of this workspace as a HelmrPlan JSON object. ' +
          'Use workspace_read capability only. The plan id should be "plan_smoke".',
      },
    ],
    { structuredOutput: { schema: HelmrPlanSchema } },
  );

  const parsed = HelmrPlanSchema.safeParse(result.object);
  assert.ok(parsed.success, `expected a schema-valid HelmrPlan, got: ${JSON.stringify(result.object)}`);
  assert.ok(parsed.data.steps.length >= 1, 'plan should have at least one step');
  assert.ok(result.usage, 'live call should report token usage');
});

test('live LLM: token usage converts to a non-zero USD cost', { skip: skipReason }, async () => {
  const { researchAgentChain, generateWithFailover } = await import('../packages/mastra/src/index.js');
  const { estimateCostUsd } = await import('../packages/governor/src/index.js');
  const { researchModel } = await import('../packages/mastra/src/index.js');

  let usage: unknown;
  const result = await generateWithFailover(
    researchAgentChain(),
    [{ role: 'user', content: 'Reply with the single word: ready.' }],
    undefined,
    { onUsage: (info) => { usage = info.usage; } },
  );

  assert.ok((result.text ?? '').length > 0, 'live call should return text');
  const cost = estimateCostUsd(researchModel, usage as never);
  assert.ok(cost > 0, 'a real completion should have a positive USD cost');
});
