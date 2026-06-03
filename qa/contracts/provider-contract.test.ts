import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderManifestSchema, STARTER_PROVIDERS } from '../../packages/provider-sdk/src/index.js';

test('starter providers cover BYOAK onboarding providers', () => {
  for (const provider of STARTER_PROVIDERS) ProviderManifestSchema.parse(provider);
  assert.deepEqual(STARTER_PROVIDERS.map((p) => p.id), ['openai','anthropic','google-gemini','groq','perplexity-sonar','xai-grok','deepseek','kimi','ollama','lm-studio']);
});
