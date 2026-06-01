import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MockWorkspaceProvider, MultiAgentRuntime, runAgentLoop } from '../../../embodiment/src/index.js';
import { createMastraDecider, buildDecisionPrompt, type DecidingAgent } from './agent-decider.js';

test('createMastraDecider drives the loop using the agent\'s structured action', async () => {
  const provider = new MockWorkspaceProvider();
  const runtime = new MultiAgentRuntime(provider);
  const agent = await runtime.spawnAgent({ role: 'browser', permissions: ['read_only', 'workspace_only'] });
  provider.seedUI(agent.workspaceId, [{ id: 'q', role: 'textbox', name: 'Query' }]);

  // A fake "brain": types once, then declares done. Structurally a Mastra agent.
  let call = 0;
  const fakeAgent: DecidingAgent = {
    async generate() {
      call += 1;
      return call === 1
        ? { object: { type: 'type', target: 'q', text: 'competitors' } }
        : { object: { type: 'done', result: 'ok' } };
    },
  };

  const result = await runAgentLoop(agent, {
    task: 'search competitors',
    decider: createMastraDecider(fakeAgent, { includeSoul: false }),
    maxSteps: 5,
  });

  assert.equal(result.status, 'done');
  assert.equal((await agent.vision.observe()).uiElements?.find((e) => e.id === 'q')?.value, 'competitors');

  await runtime.shutdown();
});

test('invalid brain output fails safely instead of throwing', async () => {
  const provider = new MockWorkspaceProvider();
  const runtime = new MultiAgentRuntime(provider);
  const agent = await runtime.spawnAgent({ role: 'browser', permissions: ['read_only', 'workspace_only'] });

  const badAgent: DecidingAgent = {
    async generate() {
      return { object: { type: 'teleport' } };
    },
  };

  const result = await runAgentLoop(agent, {
    task: 'do something',
    decider: createMastraDecider(badAgent, { includeSoul: false }),
    maxSteps: 2,
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /invalid action/);

  await runtime.shutdown();
});

test('buildDecisionPrompt summarizes the live observation as structured UI', () => {
  const prompt = buildDecisionPrompt(
    {
      agentId: 'a',
      role: 'research',
      task: 'find pricing',
      step: 0,
      observation: {
        agentId: 'a',
        workspaceId: 'ws',
        timestamp: new Date().toISOString(),
        uiElements: [{ role: 'textbox', name: 'Query', focused: true }],
        appState: 'search',
      },
      history: [],
    },
    false,
  );

  assert.match(prompt, /Task: find pricing/);
  assert.match(prompt, /textbox "Query" \[focused\]/);
  assert.match(prompt, /ONE action object/);
});
