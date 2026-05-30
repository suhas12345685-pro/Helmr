#!/usr/bin/env node
import { execSync, spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const helmrDir = join(homedir(), '.helmr');
const configDir = join(helmrDir, 'config');
const dataDir = join(helmrDir, 'data');

type CommandOptions = { silent?: boolean };

async function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function runOptionalCommand(cmd: string, opts: CommandOptions = {}): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit' }).toString().trim();
  } catch {
    return '';
  }
}

export function runRequiredCommand(cmd: string, opts: CommandOptions = {}): string {
  return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit' }).toString().trim();
}

function checkNode(): boolean {
  const major = parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  return major >= 18;
}

function checkNpm(): boolean {
  const out = runOptionalCommand('npm --version', { silent: true });
  return out.length > 0;
}

export function formatBanner(text: string): string {
  const line = '-'.repeat(60);
  return `\n${line}\n  ${text}\n${line}\n`;
}

function banner(text: string): void {
  console.log(formatBanner(text));
}

function check(label: string, passed: boolean, detail?: string): void {
  const icon = passed ? 'OK' : 'FAIL';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';
  const extra = detail ? `  ${detail}` : '';
  console.log(`  ${color}${icon}${reset} ${label}${extra}`);
}

async function main(): Promise<void> {
  banner('create-helmr - Helmr Onboarding Wizard');

  console.log('Checking system requirements...\n');

  const nodeOk = checkNode();
  check('Node.js >= 18', nodeOk, process.versions.node);
  if (!nodeOk) {
    console.error('\nNode.js 18 or higher is required. Install from https://nodejs.org');
    process.exit(1);
  }

  const npmOk = checkNpm();
  check('npm available', npmOk);
  if (!npmOk) {
    console.error('\nnpm not found. Install Node.js from https://nodejs.org');
    process.exit(1);
  }

  console.log('\nSetting up Helmr data directory...');
  await mkdir(dataDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  check('~/.helmr/data created', true, dataDir);
  check('~/.helmr/config created', true, configDir);

  const envHint = join(helmrDir, '.env.example');
  try {
    await access(envHint);
  } catch {
    await writeFile(
      envHint,
      '# Helmr environment variables\n# Configure your provider during onboarding.\n# HELMR_MODEL=provider/model\n',
    );
    check('~/.helmr/.env.example written', true);
  }

  console.log('\nInstalling Helmr CLI...');
  try {
    runRequiredCommand('npm install -g helmr');
    check('helmr CLI installed globally', true);
  } catch (err) {
    check('helmr CLI install', false, 'run: npm install -g helmr');
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`\nUnable to install the Helmr CLI automatically: ${detail}`);
    console.error('Install the CLI with `npm install -g helmr`, then rerun `create-helmr`.');
    process.exit(1);
  }

  banner('Helmr is ready!');
  console.log('Next steps:\n');
  console.log('  1. Start the daemons:');
  console.log('       helmr start\n');
  console.log('  2. Open the Hatchery WebUI:');
  console.log('       helmr hatchery\n');
  console.log('  3. Run your first job:');
  console.log('       helmr ask "summarize this workspace"\n');
  console.log('  4. Run self-test:');
  console.log('       helmr self-test\n');

  const startNow = await prompt('Start the daemons now? [Y/n]: ');
  if (startNow === '' || startNow.toLowerCase() === 'y') {
    console.log('\nStarting Helmr daemons...');
    const daemon = spawn('helmr', ['start'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    daemon.unref();
    console.log('Daemons started in background.');
    console.log('  Gateway  -> http://localhost:3999');
    console.log('  Hatchery -> http://localhost:4000\n');

    const openNow = await prompt('Open Hatchery in your browser now? [Y/n]: ');
    if (openNow === '' || openNow.toLowerCase() === 'y') {
      const url = 'http://localhost:4000';
      const cmd =
        process.platform === 'win32' ? `start "" "${url}"` :
        process.platform === 'darwin' ? `open "${url}"` :
        `xdg-open "${url}"`;
      try {
        spawn(cmd, { shell: true, detached: true, stdio: 'ignore' }).unref();
        console.log(`Opening ${url}...`);
      } catch {
        console.log(`Visit ${url} in your browser to continue onboarding.`);
      }
    } else {
      console.log('Visit http://localhost:4000 in your browser to continue onboarding.');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
