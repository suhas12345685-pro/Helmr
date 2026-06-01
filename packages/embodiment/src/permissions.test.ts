import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  permissionSet,
  hasPermission,
  assertPermission,
  requiresUserApproval,
  PermissionDeniedError,
  DEFAULT_PERMISSION_ZONES,
} from './index.js';

test('default permissions are conservative', () => {
  const set = permissionSet();
  assert.deepEqual([...set].sort(), [...DEFAULT_PERMISSION_ZONES].sort());
  assert.equal(hasPermission(set, 'workspace_only'), true);
  assert.equal(hasPermission(set, 'external_network'), false);
  assert.equal(hasPermission(set, 'local_files_write'), false);
});

test('assertPermission throws a typed error when a zone is missing', () => {
  const set = permissionSet(['read_only']);
  assert.throws(() => assertPermission(set, 'workspace_only', 'keyboard.type'), PermissionDeniedError);
  assert.doesNotThrow(() => assertPermission(set, 'read_only', 'observe'));
});

test('dangerous actions require user approval unless explicitly granted', () => {
  const guarded = permissionSet(['read_only', 'workspace_only']);
  assert.equal(requiresUserApproval(guarded, true), true);
  assert.equal(requiresUserApproval(guarded, false), false);

  const trusted = permissionSet(['workspace_only', 'dangerous_action_requires_user_approval']);
  assert.equal(requiresUserApproval(trusted, true), false);
});
