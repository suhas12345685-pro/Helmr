import assert from 'node:assert/strict';
import test from 'node:test';

import { HELMR_DOCTRINE_PREAMBLE, HELMR_DYNAMIC_RUNTIME, withDoctrine } from './doctrine.js';

test('dynamic runtime doctrine captures per-task assembly', () => {
  assert.deepEqual(HELMR_DYNAMIC_RUNTIME.assembles, [
    'identity',
    'skills',
    'tools',
    'memory context',
    'decision strategy',
    'sub-agents',
    'execution method',
    'safety policy',
    'verification process',
  ]);
  assert.match(HELMR_DYNAMIC_RUNTIME.description, /dynamic agent runtime/);
  assert.match(HELMR_DYNAMIC_RUNTIME.skillModel, /runtime rather than hardcoded/);
});

test('agent doctrine prompt includes dynamic runtime model', () => {
  assert.match(HELMR_DOCTRINE_PREAMBLE, /dynamic agent runtime/);
  assert.match(HELMR_DOCTRINE_PREAMBLE, /identity, skills, tools, memory context/);
  assert.match(HELMR_DOCTRINE_PREAMBLE, /Skills are discovered and loaded at runtime/);

  const instructions = withDoctrine('Role-specific instruction.');
  assert.match(instructions, /dynamic agent runtime/);
  assert.match(instructions, /Role-specific instruction\./);
});
