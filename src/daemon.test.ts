import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getDaemonPidServices, parsePidRecord, renderServiceUrl } from './daemon.js';
import { formatSelfTestResults } from './self-test.js';

test('combined daemon writes pid records for gateway and hatchery', () => {
  assert.deepEqual(getDaemonPidServices('all'), ['gateway', 'hatchery']);
  assert.deepEqual(getDaemonPidServices('gateway'), ['gateway']);
  assert.deepEqual(getDaemonPidServices('hatchery'), ['hatchery']);
});

test('pid records preserve ports for status output and still read legacy pid files', () => {
  assert.deepEqual(parsePidRecord('1234'), { pid: 1234 });
  assert.deepEqual(parsePidRecord('{"pid":4321,"gatewayPort":4555,"hatcheryPort":4666}'), {
    pid: 4321,
    gatewayPort: 4555,
    hatcheryPort: 4666,
  });
  assert.equal(renderServiceUrl('gateway', { pid: 4321, gatewayPort: 4555 }), '  Gateway  http://localhost:4555');
  assert.equal(renderServiceUrl('hatchery', { pid: 4321, hatcheryPort: 4666 }), '  Hatchery http://localhost:4666');
});

test('self-test terminal output is ascii-safe', () => {
  const output = formatSelfTestResults([
    { name: 'node_version', passed: true, detail: '25.9.1' },
    { name: 'mastra_runtime', passed: true },
  ]);

  assert.match(output, /\[OK\] node_version/);
  assert.match(output, /\[OK\] mastra_runtime/);
  assert.doesNotMatch(output, /[^\x00-\x7F]/);
});
