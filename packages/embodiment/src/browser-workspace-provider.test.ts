import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BrowserWorkspaceProvider,
  MultiAgentRuntime,
  permissionSet,
  type BrowserContextHandle,
  type BrowserDriver,
} from './index.js';

/** A fake browser driver — stands in for Playwright/Puppeteer/CDP in tests. */
function fakeDriver(): { driver: BrowserDriver; contexts: string[] } {
  const contexts: string[] = [];
  const driver: BrowserDriver = {
    async newContext({ startUrl }) {
      const id = `ctx_${contexts.length + 1}`;
      contexts.push(id);
      let url = startUrl ?? 'about:blank';
      let typed = '';
      const handle: BrowserContextHandle = {
        id,
        async goto(next) {
          url = next;
        },
        async snapshot() {
          return {
            url,
            visibleText: [url, typed].filter(Boolean),
            uiElements: [{ id: 'q', role: 'textbox', name: 'Query', value: typed }],
            focusedElement: { id: 'q', role: 'textbox' },
          };
        },
        async focus() {},
        async type(text) {
          typed += text;
        },
        async press() {},
        async shortcut() {},
        async mouseMove() {},
        async mouseClick() {},
        async mouseDrag() {},
        async scroll() {},
        async close() {},
      };
      return handle;
    },
  };
  return { driver, contexts };
}

test('browser provider gives each agent its own isolated context', async () => {
  const { driver, contexts } = fakeDriver();
  const runtime = new MultiAgentRuntime(new BrowserWorkspaceProvider(driver));

  const [a, b] = await runtime.spawnAgents([
    { role: 'research', startUrl: 'https://example.com', permissions: ['read_only', 'workspace_only', 'browser_safe'] },
    { role: 'verify', startUrl: 'https://example.org', permissions: ['read_only', 'workspace_only', 'browser_safe'] },
  ]);

  // Two distinct browser contexts were created — not one shared window.
  assert.equal(contexts.length, 2);
  assert.notEqual(a.workspaceId, b.workspaceId);

  await a.keyboard.sendText('q', 'pricing');
  const obsA = await a.vision.observe();
  const obsB = await b.vision.observe();

  assert.equal(obsA.uiElements?.find((e) => e.id === 'q')?.value, 'pricing');
  assert.equal(obsB.uiElements?.find((e) => e.id === 'q')?.value, '');
  assert.match(obsA.rawVisualRef ?? '', /^browser:/);

  await runtime.shutdown();
});

test('navigating without browser_safe permission is denied', async () => {
  const { driver } = fakeDriver();
  const provider = new BrowserWorkspaceProvider(driver);
  await assert.rejects(
    () =>
      provider.createWorkspace({
        agentId: 'a',
        role: 'r',
        startUrl: 'https://example.com',
        permissions: permissionSet(['read_only', 'workspace_only']),
      }),
    /permission denied/,
  );
});
