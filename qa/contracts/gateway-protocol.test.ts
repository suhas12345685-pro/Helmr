import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HELMR_PROTOCOL_VERSION, makeErrorMessage, makeGatewayMessage, safeParseGatewayMessage } from '../../packages/protocol/src/index.js';

test('Gateway protocol validates typed envelopes and side-effect idempotency', () => {
  const hello = makeGatewayMessage('HELLO', { client: 'contract-test', capabilities: [] }, { correlationId: 'corr-1' });
  assert.equal(hello.protocolVersion, HELMR_PROTOCOL_VERSION);
  assert.equal(safeParseGatewayMessage(hello).ok, true);
  assert.equal(safeParseGatewayMessage({ ...hello, protocolVersion: 'old' }).ok, false);
  assert.equal(safeParseGatewayMessage({ ...hello, type: 'REQUEST', payload: {} }).ok, false);
  assert.equal(safeParseGatewayMessage({ ...hello, type: 'REQUEST', payload: {}, idempotencyKey: 'idem-1' }).ok, true);
});

test('Gateway protocol creates typed errors', () => {
  const error = makeErrorMessage('invalid_protocol', 'bad frame', 'corr-1');
  assert.equal(error.type, 'ERROR');
  assert.equal(error.payload.code, 'invalid_protocol');
});
