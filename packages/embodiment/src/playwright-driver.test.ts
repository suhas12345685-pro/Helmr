import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PlaywrightBrowserDriver, BrowserWorkspaceProvider, permissionSet } from './index.js';

test('PlaywrightBrowserDriver throws a clear, actionable error when playwright is absent', async () => {
  const driver = new PlaywrightBrowserDriver({ headless: true });
  await assert.rejects(
    () => driver.newContext({ startUrl: 'https://example.com' }),
    /Playwright is not installed/,
  );
});

test('PlaywrightBrowserDriver satisfies the BrowserDriver interface for the provider', () => {
  // It plugs straight into the embodiment browser provider without a build-time
  // playwright dependency.
  const provider = new BrowserWorkspaceProvider(new PlaywrightBrowserDriver());
  assert.equal(provider.kind, 'browser-context');
  assert.ok(permissionSet().has('workspace_only'));
});
