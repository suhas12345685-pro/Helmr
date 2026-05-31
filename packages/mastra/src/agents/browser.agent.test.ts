import assert from 'node:assert/strict';
import { test } from 'node:test';

import { browserAgent } from './browser.agent.js';
import { mastra } from '../index.js';

test('browser agent identifies as the browser role from the shared contracts', () => {
  assert.equal(browserAgent.id, 'browser');
  assert.equal(browserAgent.name, 'Browser Agent');
});

test('browser agent is registered in the Mastra agents map', () => {
  const agent = mastra.getAgent('browser');
  assert.ok(agent, 'expected `browser` key in mastra agents');
  assert.equal(agent.id, 'browser');
});

test('browser agent description names browser automation', () => {
  assert.match(browserAgent.getDescription() ?? '', /browser/i);
});

test('browser agent instructions require receipts and forbid embedded credentials', async () => {
  const instructions = await browserAgent.getInstructions();
  const text = Array.isArray(instructions) ? instructions.join('\n') : String(instructions);
  assert.match(text, /receipt/i, 'instructions must require receipts for actions');
  assert.match(text, /credentials/i, 'instructions must address credential handling');
});
