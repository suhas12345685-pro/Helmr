import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';

import { createOpenCommand, formatBanner, parseInstallerArgs, runInstaller, runRequiredCommand } from './index.js';

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
    assert.equal(parseInstallerArgs([]).start, true);
    assert.equal(parseInstallerArgs(['--no-start']).start, false);
    assert.equal(parseInstallerArgs(['--no-open']).openHatchery, false);
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
  fix-ci-failures-1901177994268664348
  assert.deepEqual(calls, ['optional:pnpm --version', 'optional:npm --version']);
 
  assert.ok(calls.includes('optional:npm --version') || calls.includes('optional:pnpm --version'));
     main
  assert.match(logs.join('\n'), /Dry run mode/);
  assert.match(logs.join('\n'), /would create ~\/\.helmr\/data/);
  assert.match(logs.join('\n'), /would install helmr CLI globally/);
  assert.match(logs.join('\n'), /Dry run would start Gateway and Hatchery/);
  assert.match(logs.join('\n'), /would open Hatchery onboarding/);
});

test('installer normal path installs, starts Gateway/Hatchery, and opens onboarding without prompts', async () => {
  const calls: string[] = [];

  const code = await runInstaller([], {
    log: () => undefined,
    error: () => undefined,
    prompt: async () => {
      calls.push('prompt');
      return 'n';
    },
    runOptionalCommand: (cmd) => {
      calls.push(`optional:${cmd}`);
      if (cmd.startsWith('pnpm')) {
        throw new Error('Command failed');
      }
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
    spawn: ((command: string, args: string[]) => {
      calls.push(`spawn:${command} ${args.join(' ')}`);
      return { unref() {} };
    }) as never,
  });

  assert.equal(code, 0);
  assert.equal(calls.includes('prompt'), false);
  assert.ok(calls.includes('required:npm install -g helmr') || calls.includes('required:pnpm add -g helmr'));
  assert.ok(calls.some((call) => call === 'spawn:helmr start'));
  assert.ok(calls.some((call) => call.includes('http://localhost:4000')));
});

test('open command is platform-specific and shell-safe', () => {
  assert.deepEqual(createOpenCommand('http://localhost:4000', 'win32'), {
    command: 'cmd',
    args: ['/c', 'start', '', 'http://localhost:4000'],
  });
  assert.deepEqual(createOpenCommand('http://localhost:4000', 'darwin'), {
    command: 'open',
    args: ['http://localhost:4000'],
  });
  assert.deepEqual(createOpenCommand('http://localhost:4000', 'linux'), {
    command: 'xdg-open',
    args: ['http://localhost:4000'],
  });
});
