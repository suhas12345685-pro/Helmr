import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  capabilityDirection,
  isInwardCapability,
  isOutwardCapability,
  outwardCapabilities,
} from './capabilities.js';
import { ALL_CAPABILITIES } from './contracts.js';

test('network, browser, and service_install are outward', () => {
  assert.equal(capabilityDirection('network'), 'outward');
  assert.equal(capabilityDirection('browser'), 'outward');
  assert.equal(capabilityDirection('service_install'), 'outward');
  assert.ok(isOutwardCapability('network'));
});

test('local workspace/shell/git capabilities are inward', () => {
  for (const cap of ['workspace_read', 'workspace_write', 'shell_read', 'shell_write', 'git_read', 'git_write'] as const) {
    assert.equal(capabilityDirection(cap), 'inward', cap);
    assert.ok(isInwardCapability(cap), cap);
  }
});

test('every capability classifies as exactly inward or outward', () => {
  for (const cap of ALL_CAPABILITIES) {
    const dir = capabilityDirection(cap);
    assert.ok(dir === 'inward' || dir === 'outward', `${cap} -> ${dir}`);
  }
});

test('outwardCapabilities filters a mixed set', () => {
  assert.deepEqual(
    outwardCapabilities(['workspace_read', 'network', 'git_write', 'browser']),
    ['network', 'browser'],
  );
});
