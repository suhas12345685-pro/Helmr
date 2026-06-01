import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryCoordinationBus } from './index.js';
import type { AgentMessage } from './index.js';

test('direct messages reach only the addressed agent', () => {
  const bus = new InMemoryCoordinationBus();
  const toA: AgentMessage[] = [];
  const toB: AgentMessage[] = [];
  bus.subscribe('a', (m) => toA.push(m));
  bus.subscribe('b', (m) => toB.push(m));

  bus.channelFor('a').send({ toAgentId: 'b', channel: 'direct', type: 'handoff', payload: { x: 1 } });

  assert.equal(toB.length, 1);
  assert.equal(toB[0]?.fromAgentId, 'a');
  assert.equal(toB[0]?.type, 'handoff');
  assert.equal(toA.length, 0);
});

test('broadcast reaches every agent except the sender', () => {
  const bus = new InMemoryCoordinationBus();
  const seen: Record<string, number> = { a: 0, b: 0, c: 0 };
  bus.subscribe('a', () => (seen.a += 1));
  bus.subscribe('b', () => (seen.b += 1));
  bus.subscribe('c', () => (seen.c += 1));

  bus.channelFor('a').send({ channel: 'broadcast', type: 'status', payload: 'starting' });

  assert.equal(seen.a, 0);
  assert.equal(seen.b, 1);
  assert.equal(seen.c, 1);
});

test('orchestrator observes direct, broadcast, and orchestrator traffic', () => {
  const bus = new InMemoryCoordinationBus();
  const orchestrator: AgentMessage[] = [];
  bus.subscribeOrchestrator((m) => orchestrator.push(m));
  bus.subscribe('b', () => {});

  bus.channelFor('a').send({ channel: 'orchestrator', type: 'result', payload: 'done' });
  bus.channelFor('a').send({ channel: 'broadcast', type: 'status', payload: 'tick' });
  bus.channelFor('a').send({ toAgentId: 'b', channel: 'direct', type: 'question', payload: '?' });

  assert.equal(orchestrator.length, 3);
  assert.equal(bus.history().length, 3);
});

test('unsubscribing stops delivery', () => {
  const bus = new InMemoryCoordinationBus();
  let count = 0;
  const off = bus.subscribe('a', () => (count += 1));
  bus.channelFor('b').send({ channel: 'broadcast', type: 'heartbeat', payload: 1 });
  off();
  bus.channelFor('b').send({ channel: 'broadcast', type: 'heartbeat', payload: 2 });
  assert.equal(count, 1);
});
