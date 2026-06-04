import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChannelManifestSchema, STARTER_CHANNELS } from '../../packages/channels/src/index.js';

test('starter channels are explicit about implemented vs placeholder status', () => {
  for (const channel of STARTER_CHANNELS) ChannelManifestSchema.parse(channel);
  assert.equal(STARTER_CHANNELS.find((c) => c.id === 'slack')?.status, 'placeholder');
  assert.equal(STARTER_CHANNELS.find((c) => c.id === 'webchat.local')?.status, 'implemented');
});
