import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SignalAdapter } from './signal.js';
import { WhatsAppAdapter } from './whatsapp.js';
import { GoogleChatAdapter } from './googlechat.js';
import { TeamsAdapter } from './teams.js';
import { WeChatAdapter } from './wechat.js';
import { IMessageAdapter } from './imessage.js';
import type { EventEmitter } from './types.js';

function createFetchResponse(body: unknown, ok = true): Response {
  return {
    ok,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function collector(): { events: unknown[]; onEvent: EventEmitter } {
  const events: unknown[] = [];
  const onEvent: EventEmitter = async (event) => { events.push(event); };
  return { events, onEvent };
}

test('Signal envelope becomes a limited remote chat event', async () => {
  const { events, onEvent } = collector();
  await (new SignalAdapter({ rpcUrl: 'http://127.0.0.1:8080/api/v1/rpc', account: '+10000000000', onEvent }) as unknown as {
    handleEnvelope(envelope: unknown): Promise<void>;
  }).handleEnvelope({ sourceNumber: '+15551234567', dataMessage: { message: 'redeploy please' } });

  assert.equal(events.length, 1);
  assert.equal((events[0] as { principal: { id: string } }).principal.id, 'signal:+15551234567');
});

test('Signal pairing surfaces daemon JSON-RPC errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createFetchResponse({ error: { message: 'unregistered account' } });
  try {
    const adapter = new SignalAdapter({ rpcUrl: 'http://127.0.0.1:8080/api/v1/rpc', account: '+10000000000', onEvent: async () => {} });
    await assert.rejects(adapter.startPairing('+15551234567'), /Signal send failed: unregistered account/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('WhatsApp webhook payload becomes a limited remote chat event', async () => {
  const { events, onEvent } = collector();
  await new WhatsAppAdapter({ token: 't', phoneNumberId: '123', onEvent }).handleWebhook({
    entry: [{ changes: [{ value: { messages: [{ from: '15551234567', text: { body: 'status?' } }] } }] }],
  });

  assert.equal(events.length, 1);
  assert.equal((events[0] as { principal: { id: string } }).principal.id, 'whatsapp:15551234567');
});

test('WhatsApp pairing surfaces Graph API errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createFetchResponse({ error: { message: 'invalid token' } }, false);
  try {
    const adapter = new WhatsAppAdapter({ token: 't', phoneNumberId: '123', onEvent: async () => {} });
    await assert.rejects(adapter.startPairing('15551234567'), /WhatsApp sendMessage failed: invalid token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Google Chat event becomes a limited remote chat event', async () => {
  const { events, onEvent } = collector();
  await new GoogleChatAdapter({ token: 't', space: 'spaces/AAAA', onEvent }).handleEvent({
    type: 'MESSAGE',
    message: { text: 'plan the migration', sender: { name: 'users/108' } },
  });

  assert.equal(events.length, 1);
  assert.equal((events[0] as { principal: { id: string } }).principal.id, 'googlechat:users/108');
});

test('Google Chat pairing surfaces API errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createFetchResponse({ error: { message: 'PERMISSION_DENIED' } }, false);
  try {
    const adapter = new GoogleChatAdapter({ token: 't', space: 'spaces/AAAA', onEvent: async () => {} });
    await assert.rejects(adapter.startPairing('users/108'), /Google Chat sendMessage failed: PERMISSION_DENIED/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Teams activity becomes a limited remote chat event', async () => {
  const { events, onEvent } = collector();
  await new TeamsAdapter({ appId: 'a', serviceUrl: 'https://smba.example/', onEvent }).handleActivity({
    type: 'message',
    text: 'kick the build',
    from: { id: '29:user' },
    conversation: { id: 'a:conv' },
  });

  assert.equal(events.length, 1);
  assert.equal((events[0] as { principal: { id: string } }).principal.id, 'teams:29:user');
});

test('Teams pairing surfaces connector errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createFetchResponse({ error: { message: 'Unauthorized' } }, false);
  try {
    const adapter = new TeamsAdapter({ appId: 'a', serviceUrl: 'https://smba.example/', token: 'x', onEvent: async () => {} });
    await assert.rejects(adapter.startPairing('a:conv'), /Teams sendActivity failed: Unauthorized/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('WeChat message becomes a limited remote chat event', async () => {
  const { events, onEvent } = collector();
  await new WeChatAdapter({ token: 't', agentId: '1000002', onEvent }).handleMessage({
    MsgType: 'text',
    Content: 'restart worker',
    FromUserName: 'zhangsan',
  });

  assert.equal(events.length, 1);
  assert.equal((events[0] as { principal: { id: string } }).principal.id, 'wechat:zhangsan');
});

test('WeChat pairing surfaces qyapi errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createFetchResponse({ errcode: 81013, errmsg: 'invalid user' });
  try {
    const adapter = new WeChatAdapter({ token: 't', agentId: '1000002', onEvent: async () => {} });
    await assert.rejects(adapter.startPairing('zhangsan'), /WeChat message send failed: invalid user/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('iMessage message becomes a limited remote chat event', async () => {
  const { events, onEvent } = collector();
  await new IMessageAdapter({ adminHandle: 'admin@me.com', platform: 'darwin', onEvent }).handleMessage({
    handle: '+15551234567',
    text: 'summarize today',
  });

  assert.equal(events.length, 1);
  assert.equal((events[0] as { principal: { id: string } }).principal.id, 'imessage:+15551234567');
});

test('iMessage refuses to pair or start off macOS', async () => {
  const adapter = new IMessageAdapter({ adminHandle: 'admin@me.com', platform: 'linux', onEvent: async () => {} });
  await assert.rejects(adapter.startPairing('admin@me.com'), /iMessage is only available on macOS/);
  await assert.rejects(adapter.start(), /iMessage is only available on macOS/);
});

test('iMessage pairing whispers a code through the AppleScript sender and activates', async () => {
  const sent: Array<{ handle: string; text: string }> = [];
  const adapter = new IMessageAdapter({
    adminHandle: 'admin@me.com',
    platform: 'darwin',
    sendViaAppleScript: async (handle, text) => { sent.push({ handle, text }); },
    onEvent: async () => {},
  });

  const { code } = await adapter.startPairing('admin@me.com');
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.text, /Your Helmr pairing code/);
  assert.equal(await adapter.confirmPairing(code), true);
  assert.equal(adapter.getStatus(), 'active');
});

test('remote adapters refuse to start before pairing activates them', async () => {
  const onEvent: EventEmitter = async () => {};
  await assert.rejects(new SignalAdapter({ rpcUrl: 'u', account: 'a', onEvent }).start(), /Channel must be active/);
  await assert.rejects(new WhatsAppAdapter({ token: 't', phoneNumberId: '1', onEvent }).start(), /Channel must be active/);
  await assert.rejects(new GoogleChatAdapter({ token: 't', space: 's', onEvent }).start(), /Channel must be active/);
  await assert.rejects(new TeamsAdapter({ appId: 'a', serviceUrl: 'https://x/', onEvent }).start(), /Channel must be active/);
  await assert.rejects(new WeChatAdapter({ token: 't', agentId: '1', onEvent }).start(), /Channel must be active/);
});
