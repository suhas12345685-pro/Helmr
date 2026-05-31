import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';

import { formatBanner, parseInstallerArgs, runInstaller, runRequiredCommand } from './index.js';

describe('create-helmr installer helpers', () => {
  it('reports required command failures instead of silently continuing', () => {
    assert.throws(
      () => runRequiredCommand('node -e "process.exit(23)"', { silent: true }),
      /Command failed: node -e "process.exit\(23\)"/,
    );
  });

  it('renders onboarding copy without mojibake glyph artifacts', () => {
    const banner = formatBanner('create-helmr - Helmr Onboarding Wizard');

    assert.equal(banner.includes('â'), false);
    assert.equal(banner.includes('create-helmr - Helmr Onboarding Wizard'), true);
  });

  it('parses dry-run flags', () => {
    assert.equal(parseInstallerArgs(['--dry-run']).dryRun, true);
    assert.equal(parseInstallerArgs(['-n']).dryRun, true);
    assert.equal(parseInstallerArgs([]).dryRun, false);
  });
});

test('installer copy uses current helmr start command', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(source, /helmr start/);
  assert.doesNotMatch(source, /helmr daemon start/);
  assert.doesNotMatch(source, /\['daemon', 'start'\]/);
});

test('installer terminal path does not ask architecture onboarding questions', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /provider.*\?/i);
  assert.doesNotMatch(source, /model.*\?/i);
  assert.doesNotMatch(source, /channel.*\?/i);
  assert.doesNotMatch(source, /workspace.*\?/i);
  assert.doesNotMatch(source, /personality.*\?/i);
});

test('dry-run prints intended actions without filesystem, install, prompt, or daemon side effects', async () => {
  const calls: string[] = [];
  const logs: string[] = [];

  const code = await runInstaller(['--dry-run'], {
    log: (message = '') => logs.push(message),
    error: (message = '') => logs.push(message),
    prompt: async () => {
      calls.push('prompt');
      return 'n';
    },
    runOptionalCommand: (cmd) => {
      calls.push(`optional:${cmd}`);
      return '10.0.0';
    },
    runRequiredCommand: (cmd) => {
      calls.push(`required:${cmd}`);
      return '';
    },
    mkdir: async (path) => {
      calls.push(`mkdir:${String(path)}`);
      return undefined;
    },
    access: async (path) => {
      calls.push(`access:${String(path)}`);
    },
    writeFile: async (path) => {
      calls.push(`writeFile:${String(path)}`);
    },
    spawn: (() => {
      calls.push('spawn');
      return { unref() {} };
    }) as never,
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, ['optional:npm --version']);
  assert.match(logs.join('\n'), /Dry run mode/);
  assert.match(logs.join('\n'), /would create ~\/\.helmr\/data/);
  assert.match(logs.join('\n'), /would install helmr CLI globally/);
  assert.match(logs.join('\n'), /Dry run skipped daemon startup prompt/);
});
