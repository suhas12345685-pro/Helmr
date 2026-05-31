import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IrcAdapter, parseIrcLine, encodeSaslPlain } from './irc.js';
import type { EventEmitter } from './types.js';

test('parseIrcLine splits prefix, command, and trailing param', () => {
  const message = parseIrcLine(':alice!alice@host PRIVMSG helmr :deploy the app');
  assert.equal(message.prefix, 'alice!alice@host');
  assert.equal(message.command, 'PRIVMSG');
  assert.deepEqual(message.params, ['helmr', 'deploy the app']);
});

test('parseIrcLine parses a prefix-less PING with trailing token', () => {
  const message = parseIrcLine('PING :tepid.libera.chat');
  assert.equal(message.prefix, undefined);
  assert.equal(message.command, 'PING');
  assert.deepEqual(message.params, ['tepid.libera.chat']);
});

test('encodeSaslPlain produces a NUL-separated authzid/authcid/passwd payload', () => {
  const decoded = Buffer.from(encodeSaslPlain('helmr', 'secret'), 'base64').toString('utf8');
  assert.equal(decoded, 'helmr\0helmr\0secret');
});

test('IRC private query becomes a limited remote chat event', async () => {
  const events: Array<Awaited<Parameters<EventEmitter>[0]>> = [];
  const onEvent: EventEmitter = async (event) => { events.push(event); };

  await (new IrcAdapter({ host: 'irc.example.net', channel: '#helmr', nick: 'helmr', onEvent }) as unknown as {
    handleLine(line: string): Promise<void>;
  }).handleLine(':maintainer!m@host PRIVMSG helmr :restart the worker');

  assert.equal(events.length, 1);
  assert.equal(events[0]?.source, 'chat');
  assert.equal(events[0]?.principal.id, 'irc:maintainer');
  assert.equal(events[0]?.principal.type, 'remote-user');
  assert.equal(events[0]?.principal.trustLevel, 'limited');
});

test('IRC ignores messages echoed from the bot nick itself', async () => {
  const events: unknown[] = [];
  const onEvent: EventEmitter = async (event) => { events.push(event); };

  await (new IrcAdapter({ host: 'irc.example.net', channel: '#helmr', nick: 'helmr', onEvent }) as unknown as {
    handleLine(line: string): Promise<void>;
  }).handleLine(':helmr!helmr@host PRIVMSG #helmr :Your Helmr pairing code: ABCD1234');

  assert.deepEqual(events, []);
});

test('IRC configure rejects an out-of-range port', async () => {
  const adapter = new IrcAdapter({ onEvent: async () => {} });
  await assert.rejects(
    adapter.configure({ host: 'irc.example.net', channel: '#helmr', port: '70000' }),
    /port must be a valid TCP port/,
  );
});

test('IRC pairing then start requires an active, paired channel', async () => {
  const adapter = new IrcAdapter({ host: 'irc.example.net', channel: '#helmr', onEvent: async () => {} });
  await assert.rejects(adapter.start(), /Channel must be active before starting/);

  const { code } = await adapter.startPairing('maintainer');
  const paired = await adapter.confirmPairing(code);
  assert.equal(paired, true);
  assert.equal(adapter.getStatus(), 'active');
  assert.equal(adapter.getInfo().paired, true);
});
