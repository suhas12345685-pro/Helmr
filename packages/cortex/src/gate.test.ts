import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gateToolReceipt, type StandingApprovalPolicy } from './gate.js';
import type { ToolReceipt } from '../../shared/src/index.js';

function receipt(partial: Partial<ToolReceipt> & Pick<ToolReceipt, 'capability'>): ToolReceipt {
  return {
    id: 'r1',
    jobId: 'j1',
    stepId: 's1',
    tool: 't',
    input: {},
    risk: 'medium',
    approval: 'not_required',
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

test('inward capabilities are auto — no gate', () => {
  for (const capability of ['workspace_write', 'shell_write', 'git_write'] as const) {
    const decision = gateToolReceipt(receipt({ capability }));
    assert.equal(decision.tier, 'auto');
  }
});

test('outward capability with no rule is gated (fail-safe default)', () => {
  const decision = gateToolReceipt(receipt({ capability: 'network' }));
  assert.equal(decision.tier, 'gated');
});

test('alwaysGated rule forces gated even when constraints would match', () => {
  const policy: StandingApprovalPolicy = {
    rules: { package_install: { alwaysGated: true, allowHosts: ['registry.npmjs.org'] } },
  };
  const decision = gateToolReceipt(receipt({ capability: 'package_install' }), policy);
  assert.equal(decision.tier, 'gated');
});

test('branch within allow-list and not denied is standing', () => {
  const policy: StandingApprovalPolicy = {
    rules: { network: { allowBranches: ['claude/*'], denyBranches: ['main', 'release/*'] } },
  };
  const allowed = gateToolReceipt(receipt({ capability: 'network', input: { branch: 'claude/feature' } }), policy);
  assert.equal(allowed.tier, 'standing');

  const denied = gateToolReceipt(receipt({ capability: 'network', input: { branch: 'main' } }), policy);
  assert.equal(denied.tier, 'gated');

  const unlisted = gateToolReceipt(receipt({ capability: 'network', input: { branch: 'hotfix/x' } }), policy);
  assert.equal(unlisted.tier, 'gated');
});

test('deny-list takes precedence over allow-list', () => {
  const policy: StandingApprovalPolicy = {
    rules: { network: { allowBranches: ['*'], denyBranches: ['main'] } },
  };
  const decision = gateToolReceipt(receipt({ capability: 'network', input: { branch: 'main' } }), policy);
  assert.equal(decision.tier, 'gated');
});

test('host allow-list matches exact and wildcard subdomains', () => {
  const policy: StandingApprovalPolicy = {
    rules: { network: { allowHosts: ['api.github.com', '*.example.com'] } },
  };
  assert.equal(gateToolReceipt(receipt({ capability: 'network', input: { url: 'https://api.github.com/x' } }), policy).tier, 'standing');
  assert.equal(gateToolReceipt(receipt({ capability: 'network', input: { url: 'https://svc.example.com/y' } }), policy).tier, 'standing');
  assert.equal(gateToolReceipt(receipt({ capability: 'network', input: { url: 'https://example.com/z' } }), policy).tier, 'standing');
  assert.equal(gateToolReceipt(receipt({ capability: 'network', input: { url: 'https://evil.test/z' } }), policy).tier, 'gated');
});

test('host-constrained rule without a host in input is gated', () => {
  const policy: StandingApprovalPolicy = { rules: { network: { allowHosts: ['api.github.com'] } } };
  const decision = gateToolReceipt(receipt({ capability: 'network', input: {} }), policy);
  assert.equal(decision.tier, 'gated');
});

test('unconstrained rule grants blanket standing authority', () => {
  const policy: StandingApprovalPolicy = { rules: { browser: {} } };
  const decision = gateToolReceipt(receipt({ capability: 'browser' }), policy);
  assert.equal(decision.tier, 'standing');
});
