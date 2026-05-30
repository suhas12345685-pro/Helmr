import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HelmrEventSchema,
  normalizeApiEvent,
  normalizeCliEvent,
} from './normalize-event.js';

const fixedNow = () => new Date('2026-05-28T10:15:30.000Z');
const fixedId = () => 'evt_test_123';

test('normalizeCliEvent converts a local CLI ask into a HelmrEvent', () => {
  const event = normalizeCliEvent(
    {
      text: 'summarize this workspace',
      workspacePath: 'C:\\Users\\DELL\\Helmr',
      requestedCapabilities: ['workspace_read', 'git_read'],
    },
    { createId: fixedId, now: fixedNow },
  );

  assert.deepEqual(event, {
    id: 'evt_test_123',
    createdAt: '2026-05-28T10:15:30.000Z',
    source: 'cli',
    principal: {
      id: 'local-owner',
      type: 'local-user',
      trustLevel: 'owner',
    },
    workspace: {
      id: 'local',
      path: 'C:\\Users\\DELL\\Helmr',
    },
    payload: {
      text: 'summarize this workspace',
    },
    requestedCapabilities: ['workspace_read', 'git_read'],
  });
  assert.deepEqual(HelmrEventSchema.parse(event), event);
});

test('normalizeApiEvent converts an authenticated API request into a HelmrEvent', () => {
  const event = normalizeApiEvent(
    {
      body: {
        text: 'run the nightly audit',
        workspace: {
          id: 'workspace_prod',
          path: '/srv/helmr',
        },
        principal: {
          id: 'svc_scheduler',
          type: 'service-account',
          trustLevel: 'trusted',
        },
        payload: {
          attachments: [{ name: 'manifest.json', uri: 'file:///srv/manifest.json', kind: 'json' }],
        },
        requestedCapabilities: ['workspace_read', 'shell_read'],
      },
    },
    { createId: fixedId, now: fixedNow },
  );

  assert.deepEqual(event, {
    id: 'evt_test_123',
    createdAt: '2026-05-28T10:15:30.000Z',
    source: 'api',
    principal: {
      id: 'svc_scheduler',
      type: 'service-account',
      trustLevel: 'trusted',
    },
    workspace: {
      id: 'workspace_prod',
      path: '/srv/helmr',
    },
    payload: {
      text: 'run the nightly audit',
      attachments: [{ name: 'manifest.json', uri: 'file:///srv/manifest.json', kind: 'json' }],
    },
    requestedCapabilities: ['workspace_read', 'shell_read'],
  });
  assert.deepEqual(HelmrEventSchema.parse(event), event);
});

test('normalizeCliEvent rejects blank event text', () => {
  assert.throws(
    () =>
      normalizeCliEvent(
        {
          text: '   ',
          workspacePath: 'C:\\Users\\DELL\\Helmr',
        },
        { createId: fixedId, now: fixedNow },
      ),
    /Event text is required/,
  );
});

test('normalization strips ANSI/control delimiters and normalizes unicode', () => {
  const event = normalizeApiEvent(
    {
      body: {
        text: 'Cafe\u0301\u001b[31m\u0000\r\nrun',
        workspace: { id: 'local', path: process.cwd() },
        principal: { id: 'owner', type: 'local-user', trustLevel: 'owner' },
      },
    },
    {
      createId: () => 'evt_sanitized',
      now: () => new Date('2026-05-28T10:00:00.000Z'),
    },
  );

  assert.equal(event.payload.text, 'Café run');
});
