import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateWithFailover, llmTimeoutMs, type GenerateAgent } from './resilience.js';

function agentReturning(result: { text?: string; object?: unknown; usage?: unknown }): GenerateAgent {
  return { generate: async () => result as never };
}

function agentThrowing(message: string): GenerateAgent {
  return { generate: async () => { throw new Error(message); } };
}

test('returns the primary result and surfaces its usage', async () => {
  let captured: { label: string; usage: unknown } | undefined;
  const result = await generateWithFailover(
    [{ label: 'primary', agent: agentReturning({ text: 'hi', usage: { inputTokens: 10, outputTokens: 5 } }) }],
    [{ role: 'user', content: 'q' }],
    undefined,
    { sleep: async () => undefined, onUsage: (info) => { captured = info; } },
  );
  assert.equal(result.text, 'hi');
  assert.deepEqual(captured, { label: 'primary', usage: { inputTokens: 10, outputTokens: 5 } });
});

test('fails over to the next model when the primary keeps failing', async () => {
  const result = await generateWithFailover(
    [
      { label: 'primary', agent: agentThrowing('overloaded') },
      { label: 'fallback', agent: agentReturning({ text: 'recovered' }) },
    ],
    [{ role: 'user', content: 'q' }],
    undefined,
    { retriesPerAttempt: 0, sleep: async () => undefined },
  );
  assert.equal(result.text, 'recovered');
});

test('llmTimeoutMs reads HELMR_LLM_TIMEOUT_MS with a sane default', () => {
  assert.equal(llmTimeoutMs({}), 60_000);
  assert.equal(llmTimeoutMs({ HELMR_LLM_TIMEOUT_MS: '1234' }), 1234);
  assert.equal(llmTimeoutMs({ HELMR_LLM_TIMEOUT_MS: 'nonsense' }), 60_000);
});
