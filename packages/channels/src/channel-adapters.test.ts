import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DiscordAdapter } from './discord.js';
import { SlackAdapter } from './slack.js';
import { TelegramAdapter } from './telegram.js';
import { WebChatAdapter } from './webchat.js';
import type { EventEmitter } from './types.js';

function createFetchResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

test('Telegram pairing rejects when Telegram does not accept the pairing message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createFetchResponse({ ok: false, description: 'chat not found' });

  try {
    const adapter = new TelegramAdapter({ token: 'telegram-token', onEvent: async () => {} });

    await assert.rejects(
      adapter.startPairing('123'),
      /Telegram sendMessage failed: chat not found/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Discord pairing rejects when Discord does not create a DM channel', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createFetchResponse({ message: 'Missing Access' }, false);

  try {
    const adapter = new DiscordAdapter({ token: 'discord-token', onEvent: async () => {} });

    await assert.rejects(
      adapter.startPairing('admin-user'),
      /Discord create DM channel failed: Missing Access/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slack pairing rejects when Slack does not accept the pairing message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createFetchResponse({ ok: false, error: 'channel_not_found' });

  try {
    const adapter = new SlackAdapter({ botToken: 'xoxb-token', appToken: 'xapp-token', onEvent: async () => {} });

    await assert.rejects(
      adapter.startPairing('UADMIN'),
      /Slack chat.postMessage failed: channel_not_found/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slack ignores message events without a user instead of emitting local-owner events', async () => {
  const events: unknown[] = [];
  const adapter = new SlackAdapter({
    botToken: 'xoxb-token',
    appToken: 'xapp-token',
    onEvent: async (event) => {
      events.push(event);
    },
  });

  await (adapter as unknown as { handleMessage(raw: string): Promise<void> }).handleMessage(
    JSON.stringify({
      type: 'events_api',
      payload: {
        event: {
          type: 'message',
          text: 'deployment finished',
          channel: 'C123',
        },
      },
    }),
  );

  assert.deepEqual(events, []);
});

test('channel adapters emit chat events for remote principals', async () => {
  const events: Array<Awaited<Parameters<EventEmitter>[0]>> = [];
  const onEvent: EventEmitter = async (event) => {
    events.push(event);
  };

  await (new TelegramAdapter({ token: 'telegram-token', onEvent }) as unknown as {
    handleUpdate(update: unknown): Promise<void>;
  }).handleUpdate({ update_id: 1, message: { text: 'ship it', chat: { id: 42 } } });

  await (new DiscordAdapter({ token: 'discord-token', onEvent }) as unknown as {
    handleMessageCreate(data: unknown): Promise<void>;
  }).handleMessageCreate({ content: 'review status', author: { id: 'discord-user' }, channel_id: 'D1' });

  await (new SlackAdapter({ botToken: 'xoxb-token', appToken: 'xapp-token', onEvent }) as unknown as {
    handleMessage(raw: string): Promise<void>;
  }).handleMessage(
    JSON.stringify({
      type: 'events_api',
      payload: { event: { type: 'message', text: 'queue deploy', user: 'USLACK', channel: 'C1' } },
    }),
  );

  await (new WebChatAdapter({ port: 0, onEvent, workspacePath: 'C:\\Users\\DELL\\Helmr' }) as unknown as {
    handleMessage(raw: string): Promise<void>;
  }).handleMessage(JSON.stringify({ text: 'local web ask' }));

  assert.equal(events.length, 4);
  for (const event of events) {
    assert.equal(event.source, 'chat');
    assert.equal(event.principal.type, 'remote-user');
    assert.equal(event.principal.trustLevel, 'limited');
  }
  assert.deepEqual(
    events.map((event) => event.principal.id),
    ['telegram:42', 'discord:discord-user', 'slack:USLACK', 'webchat:local-owner'],
  );
});
