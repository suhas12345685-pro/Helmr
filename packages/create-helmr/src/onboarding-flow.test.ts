import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENTERPRISE_GREETING, HATCHERY_ONBOARDING_FLOW, ONBOARDING_PROVIDERS, PERSONAL_GREETING } from './index.js';

test('Hatchery onboarding flow supports Personal and Enterprise BYOAK setup without Anthropic lock-in', () => {
  assert.match(HATCHERY_ONBOARDING_FLOW.join('\n'), /Personal or Enterprise/);
  assert.match(HATCHERY_ONBOARDING_FLOW.join('\n'), /budgets/);
  assert.equal(PERSONAL_GREETING, 'Hey, I came online. Set my vibe, who I am, and who you are.');
  assert.equal(ENTERPRISE_GREETING, 'Hey, I came online. Tell me my role, my tasks, my channel, company name, escalation rules, and approval policy.');
  assert.deepEqual(ONBOARDING_PROVIDERS.map((p) => p.id), ['openai','anthropic','google-gemini','groq','perplexity-sonar','xai-grok','deepseek','kimi','ollama','lm-studio']);
});
