import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MultiAgentRuntime,
  MockWorkspaceProvider,
  runAgentLoop,
  ScriptedDecider,
  type AgentDecider,
} from './index.js';

test('runAgentLoop perceives, acts through virtual hands, and reports done', async () => {
  const provider = new MockWorkspaceProvider();
  const runtime = new MultiAgentRuntime(provider);
  const agent = await runtime.spawnAgent({ role: 'filler', permissions: ['read_only', 'workspace_only'] });
  provider.seedUI(agent.workspaceId, [{ id: 'name', role: 'textbox', name: 'Name' }]);

  const result = await runAgentLoop(agent, {
    task: 'Fill in the name field',
    decider: new ScriptedDecider([
      { type: 'type', target: 'name', text: 'Helmr' },
      { type: 'done', result: { filled: true } },
    ]),
  });

  assert.equal(result.status, 'done');
  assert.deepEqual(result.result, { filled: true });

  // The action actually changed the agent's own workspace.
  const obs = await agent.vision.observe();
  assert.equal(obs.uiElements?.find((e) => e.id === 'name')?.value, 'Helmr');
  assert.equal(agent.status, 'idle');
  assert.equal(agent.taskState.status, 'done');

  await runtime.shutdown();
});

test('a decider observing its workspace drives to completion', async () => {
  const provider = new MockWorkspaceProvider();
  const runtime = new MultiAgentRuntime(provider);
  const agent = await runtime.spawnAgent({ role: 'reactive', permissions: ['read_only', 'workspace_only'] });
  provider.seedUI(agent.workspaceId, [{ id: 'q', role: 'textbox', name: 'Query' }], 'search');

  // Decider reads the live observation and finishes once the field is filled.
  const decider: AgentDecider = {
    async decide(ctx) {
      const field = ctx.observation.uiElements?.find((e) => e.id === 'q');
      if (!field?.value) return { type: 'type', target: 'q', text: 'pricing' };
      return { type: 'done', result: field.value };
    },
  };

  const result = await runAgentLoop(agent, { task: 'search pricing', decider, maxSteps: 5 });
  assert.equal(result.status, 'done');
  assert.equal(result.result, 'pricing');
  assert.ok(result.steps <= 3);

  await runtime.shutdown();
});

test('the loop stops and fails safely on a permission error', async () => {
  const runtime = new MultiAgentRuntime(new MockWorkspaceProvider());
  const agent = await runtime.spawnAgent({ role: 'observer', permissions: ['read_only'] });

  const result = await runAgentLoop(agent, {
    task: 'try to type without permission',
    decider: new ScriptedDecider([{ type: 'type', text: 'nope' }]),
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /permission denied/);
  assert.equal(agent.status, 'error');

  await runtime.shutdown();
});
