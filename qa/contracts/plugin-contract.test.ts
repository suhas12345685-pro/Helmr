import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryPluginHarness, defineHelmrPlugin, runPluginHealth } from '../../packages/plugin-sdk/src/index.js';

test('plugin SDK validates manifests and runs health hooks', async () => {
  const plugin = defineHelmrPlugin({ manifest: { id: 'demo', name: 'Demo', version: '0.1.0', description: 'Demo plugin', capabilities: ['tool'], permissions: ['audit:write'] }, health: () => ({ ok: true }) });
  assert.equal((await runPluginHealth(plugin, createMemoryPluginHarness(plugin))).ok, true);
});
