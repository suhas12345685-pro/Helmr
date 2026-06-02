import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimateCostUsd, priceForModel, normalizeModelId, DEFAULT_MODEL_PRICE } from './pricing.js';

test('normalizeModelId strips provider prefix and dated suffix', () => {
  assert.equal(normalizeModelId('anthropic/claude-sonnet-4-5'), 'claude-sonnet-4-5');
  assert.equal(normalizeModelId('claude-sonnet-4-5-20250101'), 'claude-sonnet-4-5');
  assert.equal(normalizeModelId('openai/gpt-4o'), 'gpt-4o');
});

test('priceForModel resolves known models and prefix variants', () => {
  assert.deepEqual(priceForModel('anthropic/claude-sonnet-4-5'), { inputPerMTok: 3, outputPerMTok: 15 });
  // Prefix match for an unlisted variant.
  assert.deepEqual(priceForModel('claude-sonnet-4-5-experimental'), { inputPerMTok: 3, outputPerMTok: 15 });
});

test('priceForModel falls back to the conservative default for unknown models', () => {
  assert.deepEqual(priceForModel('some/unknown-model'), DEFAULT_MODEL_PRICE);
});

test('estimateCostUsd computes USD from input/output tokens', () => {
  // 1M input @ $3 + 1M output @ $15 = $18.
  const cost = estimateCostUsd('anthropic/claude-sonnet-4-5', {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(cost, 18);
});

test('estimateCostUsd supports legacy prompt/completion token names', () => {
  const cost = estimateCostUsd('anthropic/claude-haiku-4-5', {
    promptTokens: 1_000_000,
    completionTokens: 0,
  });
  // 1M input @ $1 = $1.
  assert.equal(cost, 1);
});

test('estimateCostUsd attributes a total-only usage to the costlier output side', () => {
  const cost = estimateCostUsd('anthropic/claude-haiku-4-5', { totalTokens: 1_000_000 });
  // priced as output: 1M @ $5.
  assert.equal(cost, 5);
});

test('estimateCostUsd returns 0 for missing usage', () => {
  assert.equal(estimateCostUsd('anthropic/claude-sonnet-4-5', undefined), 0);
});
