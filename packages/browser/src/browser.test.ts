import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseBrowserAction,
  browserActionRisk,
  BrowserSession,
  browserReceiptInput,
  NullBrowserDriver,
  StubBrowserDriver,
} from './index.js';

// ── action contracts ────────────────────────────────────────────────

test('navigate action requires an http(s) url', () => {
  assert.deepEqual(parseBrowserAction({ kind: 'navigate', url: 'https://example.com' }), {
    kind: 'navigate',
    url: 'https://example.com',
  });
  assert.throws(() => parseBrowserAction({ kind: 'navigate', url: 'file:///etc/passwd' }));
  assert.throws(() => parseBrowserAction({ kind: 'navigate', url: 'not-a-url' }));
});

test('unknown action kinds are rejected', () => {
  assert.throws(() => parseBrowserAction({ kind: 'evaluate', script: 'alert(1)' }));
});

test('risk is medium for mutating actions, low for read-only', () => {
  assert.equal(browserActionRisk({ kind: 'click', selector: '#go' }), 'medium');
  assert.equal(browserActionRisk({ kind: 'type', selector: '#q', text: 'hi' }), 'medium');
  assert.equal(browserActionRisk({ kind: 'navigate', url: 'https://x.com' }), 'low');
  assert.equal(browserActionRisk({ kind: 'extractText' }), 'low');
});

// ── session guardrails ──────────────────────────────────────────────

test('session refuses to run without the browser capability', async () => {
  const session = new BrowserSession({ driver: new StubBrowserDriver() });
  await assert.rejects(
    () => session.run({ kind: 'navigate', url: 'https://x.com' }),
    /capability not granted/,
  );
});

test('session validates actions before dispatching to the driver', async () => {
  const session = new BrowserSession({
    driver: new StubBrowserDriver(),
    browserCapabilityGranted: true,
  });
  await assert.rejects(() => session.run({ kind: 'navigate', url: 'ftp://x' }));
});

test('session runs valid actions through an available driver and records history', async () => {
  const driver = new StubBrowserDriver();
  const session = new BrowserSession({ driver, browserCapabilityGranted: true });

  const nav = await session.run({ kind: 'navigate', url: 'https://example.com' });
  assert.equal(nav.ok, true);

  const extract = await session.run({ kind: 'extractText' });
  assert.equal(extract.ok, true);

  assert.equal(session.history.length, 2);
  assert.equal(driver.history.length, 2);
  assert.equal(driver.history[0]?.kind, 'navigate');
});

test('null driver reports unavailable and does not execute', async () => {
  const driver = new NullBrowserDriver();
  assert.equal(driver.isAvailable(), false);

  const session = new BrowserSession({ driver, browserCapabilityGranted: true });
  const result = await session.run({ kind: 'navigate', url: 'https://example.com' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /not available/);
});

// ── receipt bridge ──────────────────────────────────────────────────

test('browserReceiptInput builds a browser-capability receipt input', () => {
  const input = browserReceiptInput('job_1', 'step_1', { kind: 'click', selector: '#submit' });
  assert.equal(input.capability, 'browser');
  assert.equal(input.tool, 'browser_click');
  assert.equal(input.risk, 'medium');
  assert.equal(input.jobId, 'job_1');
  assert.equal(input.stepId, 'step_1');
});
