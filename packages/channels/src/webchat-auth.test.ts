import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { test } from 'node:test';

import { WebSocket } from 'ws';

import { WebChatAdapter } from './webchat.js';
import type { EventEmitter } from './types.js';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      server.close(() => resolve(addr.port));
    });
  });
}

test('WebChatAdapter rejects unauthenticated handshakes when apiToken is configured', async () => {
  const port = await freePort();
  const noopEvent: EventEmitter = async () => {};
  const adapter = new WebChatAdapter({ port, onEvent: noopEvent, apiToken: 'super-secret-token' });
  await adapter.start();

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const [error] = (await once(ws, 'error')) as [Error];
    assert.match(error.message, /401|Unauthorized|Unexpected server response/);
  } finally {
    await adapter.stop();
  }
});

test('WebChatAdapter rejects handshakes with a wrong token', async () => {
  const port = await freePort();
  const noopEvent: EventEmitter = async () => {};
  const adapter = new WebChatAdapter({ port, onEvent: noopEvent, apiToken: 'super-secret-token' });
  await adapter.start();

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, ['attacker-token', 'helmr']);
    const [error] = (await once(ws, 'error')) as [Error];
    assert.match(error.message, /401|Unauthorized|Unexpected server response/);
  } finally {
    await adapter.stop();
  }
});

test('WebChatAdapter accepts handshakes presenting the configured token', async () => {
  const port = await freePort();
  const received: unknown[] = [];
  const onEvent: EventEmitter = async (event) => {
    received.push(event);
  };
  const adapter = new WebChatAdapter({ port, onEvent, apiToken: 'super-secret-token' });
  await adapter.start();

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, ['super-secret-token', 'helmr']);
    await once(ws, 'open');
    ws.send(JSON.stringify({ text: 'authorized hello' }));
    // Give the event loop a tick to deliver the message.
    await new Promise((resolve) => setTimeout(resolve, 25));
    ws.close();
    await once(ws, 'close');
    assert.equal(received.length, 1);
  } finally {
    await adapter.stop();
  }
});

test('WebChatAdapter remains open when no apiToken is configured (local-dev default)', async () => {
  const port = await freePort();
  const noopEvent: EventEmitter = async () => {};
  const adapter = new WebChatAdapter({ port, onEvent: noopEvent });
  await adapter.start();

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(ws, 'open');
    ws.close();
    await once(ws, 'close');
  } finally {
    await adapter.stop();
  }
});
