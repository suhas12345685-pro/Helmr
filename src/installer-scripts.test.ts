import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// npm test runs from the repository root, so cwd is the repo root.
const root = process.cwd();
const sh = () => readFileSync(join(root, 'install.sh'), 'utf8');
const ps = () => readFileSync(join(root, 'install.ps1'), 'utf8');

test('both hosted installer scripts exist', () => {
  assert.ok(existsSync(join(root, 'install.sh')), 'install.sh missing');
  assert.ok(existsSync(join(root, 'install.ps1')), 'install.ps1 missing');
});

test('install.sh supports --dry-run and fails closed on errors', () => {
  const text = sh();
  assert.match(text, /--dry-run/);
  assert.match(text, /set -euo pipefail/, 'shell script must use strict mode');
});

test('install.ps1 supports a dry-run switch and strict error handling', () => {
  const text = ps();
  assert.match(text, /\$DryRun/);
  assert.match(text, /--dry-run/);
  assert.match(text, /ErrorActionPreference\s*=\s*'Stop'/);
});

test('both installers gate on a minimum Node major version', () => {
  assert.match(sh(), /MIN_NODE_MAJOR=18/);
  assert.match(ps(), /MinNodeMajor = 18/);
});

test('both installers delegate to create-helmr rather than embedding the runtime', () => {
  assert.match(sh(), /npm create helmr@latest/);
  assert.match(ps(), /npm create helmr@latest/);
});

test('install.sh prints intended actions before running create-helmr in dry-run', () => {
  const text = sh();
  // In dry-run mode the script must announce the command and exit before running it.
  assert.match(text, /Would run: npm create helmr@latest/);
});
