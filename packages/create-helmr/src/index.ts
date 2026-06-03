#!/usr/bin/env node
import { execSync, spawn as nodeSpawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const helmrDir = join(homedir(), '.helmr');
const configDir = join(helmrDir, 'config');
const dataDir = join(helmrDir, 'data');

export const ONBOARDING_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', authMethods: ['api_key', 'oauth'] },
  { id: 'anthropic', name: 'Anthropic', authMethods: ['api_key'] },
  { id: 'google-gemini', name: 'Google Gemini', authMethods: ['api_key', 'oauth'] },
  { id: 'groq', name: 'Groq', authMethods: ['api_key'] },
  { id: 'perplexity-sonar', name: 'Perplexity Sonar', authMethods: ['api_key'] },
  { id: 'xai-grok', name: 'xAI/Grok', authMethods: ['api_key'] },
  { id: 'deepseek', name: 'DeepSeek', authMethods: ['api_key'] },
  { id: 'kimi', name: 'Kimi', authMethods: ['api_key'] },
  { id: 'ollama', name: 'Ollama', authMethods: ['local'] },
  { id: 'lm-studio', name: 'LM Studio', authMethods: ['local'] },
] as const;

export const HATCHERY_ONBOARDING_FLOW = [
  'choose mode: Personal or Enterprise',
  'choose LLM provider and supported auth method',
  'validate connection',
  'choose model',
  'choose channels',
  'choose skills',
  'choose autonomy level: manual, approval-gated, semi-autonomous, scheduled, enterprise controlled',
  'configure per-job, daily, monthly and token budgets',
  'configure local SQLite memory retention and export/delete options',
  'finish Hatchery',
] as const;

export const PERSONAL_GREETING = 'Hey, I came online. Set my vibe, who I am, and who you are.';
export const ENTERPRISE_GREETING = 'Hey, I came online. Tell me my role, my tasks, my channel, company name, escalation rules, and approval policy.';

type CommandOptions = { silent?: boolean };
type SpawnFn = typeof nodeSpawn;

interface InstallerDeps {
  log: (message?: string) => void;
  error: (message?: string) => void;
  prompt: (question: string) => Promise<string>;
  runOptionalCommand: (cmd: string, opts?: CommandOptions) => string;
  runRequiredCommand: (cmd: string, opts?: CommandOptions) => string;
  mkdir: typeof mkdir;
  access: typeof access;
  writeFile: typeof writeFile;
  spawn: SpawnFn;
}

interface InstallerOptions {
  dryRun: boolean;
  start: boolean;
  openHatchery: boolean;
}

export function parseInstallerArgs(args: string[]): InstallerOptions {
  return {
    dryRun: args.includes('--dry-run') || args.includes('-n'),
    start: !args.includes('--no-start'),
    openHatchery: !args.includes('--no-open'),
  };
}

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

function checkPnpm(deps: Pick<InstallerDeps, 'runOptionalCommand'>): boolean {
  const out = deps.runOptionalCommand('pnpm --version', { silent: true });
  return out.length > 0;
}

function checkNpm(deps: Pick<InstallerDeps, 'runOptionalCommand'>): boolean {
  const out = deps.runOptionalCommand('npm --version', { silent: true });
  return out.length > 0;
}

export function formatBanner(text: string): string {
  const line = '-'.repeat(60);
  return `\n${line}\n  ${text}\n${line}\n`;
}

function banner(text: string, deps: Pick<InstallerDeps, 'log'>): void {
  deps.log(formatBanner(text));
}

function check(label: string, passed: boolean, detail: string | undefined, deps: Pick<InstallerDeps, 'log'>): void {
  const icon = passed ? 'OK' : 'FAIL';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';
  const extra = detail ? `  ${detail}` : '';
  deps.log(`  ${color}${icon}${reset} ${label}${extra}`);
}

export function createOpenCommand(url: string, platform = process.platform): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

function getDefaultDeps(): InstallerDeps {
  return {
    log: console.log,
    error: console.error,
    prompt,
    runOptionalCommand,
    runRequiredCommand,
    mkdir,
    access,
    writeFile,
    spawn: nodeSpawn,
  };
}

export async function runInstaller(args = process.argv.slice(2), deps = getDefaultDeps()): Promise<number> {
  const options = parseInstallerArgs(args);

  banner('create-helmr - Helmr Onboarding Wizard', deps);

  if (options.dryRun) {
    deps.log('Dry run mode: checking prerequisites and printing intended actions only.');
    deps.log('No directories will be created, no files will be written, no packages will be installed, and no daemons will be started.\n');
  }

  deps.log('Checking system requirements...\n');

  const nodeOk = checkNode();
  check('Node.js >= 18', nodeOk, process.versions.node, deps);
  if (!nodeOk) {
    deps.error('\nNode.js 18 or higher is required. Install from https://nodejs.org');
    return 1;
  }

  const pnpmOk = checkPnpm(deps);
  const npmOk = checkNpm(deps);
  const pkgMgrOk = pnpmOk || npmOk;
  const pkgMgr = pnpmOk ? 'pnpm' : 'npm';

  check(`${pkgMgr} available`, pkgMgrOk, undefined, deps);
  if (!pkgMgrOk) {
    deps.error('\nnpm or pnpm not found. Install Node.js/npm or pnpm first.');
    return 1;
  }

  deps.log('\nSetting up Helmr data directory...');
  if (options.dryRun) {
    check('would create ~/.helmr/data', true, dataDir, deps);
    check('would create ~/.helmr/config', true, configDir, deps);
    check('would write ~/.helmr/.env.example if missing', true, join(helmrDir, '.env.example'), deps);
  } else {
    await deps.mkdir(dataDir, { recursive: true });
    await deps.mkdir(configDir, { recursive: true });
    check('~/.helmr/data created', true, dataDir, deps);
    check('~/.helmr/config created', true, configDir, deps);

    const envHint = join(helmrDir, '.env.example');
    try {
      await deps.access(envHint);
    } catch {
      await deps.writeFile(
        envHint,
        '# Helmr environment variables\n# Configure your provider during onboarding.\n# HELMR_MODEL=provider/model\n',
      );
      check('~/.helmr/.env.example written', true, undefined, deps);
    }
  }

  deps.log('\nInstalling Helmr CLI...');
  const installCmd = pkgMgr === 'pnpm' ? 'pnpm add -g helmr' : 'npm install -g helmr';
  if (options.dryRun) {
    check('would install helmr CLI globally', true, installCmd, deps);
  } else {
    try {
      deps.runRequiredCommand(installCmd);
      check('helmr CLI installed globally', true, undefined, deps);
    } catch (err) {
      check('helmr CLI install', false, `run: ${installCmd}`, deps);
      const detail = err instanceof Error ? err.message : String(err);
      deps.error(`\nUnable to install the Helmr CLI automatically: ${detail}`);
      deps.error(`Install the CLI with \`${installCmd}\`, then rerun \`create-helmr\`.`);
      return 1;
    }
  }

  banner(options.dryRun ? 'Helmr dry run complete!' : 'Helmr bootstrap complete!', deps);

  const hatcheryUrl = 'http://localhost:4000';
  if (options.dryRun) {
    deps.log('Dry run would start Gateway and Hatchery:');
    deps.log('  helmr start');
    deps.log(`Dry run would open Hatchery onboarding: ${hatcheryUrl}`);
    deps.log('No daemon was started and no browser was opened.\n');
    return 0;
  }

  if (options.start) {
    deps.log('\nStarting Gateway and Hatchery...');
    const daemon = deps.spawn('helmr', ['start'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    daemon.unref();
    deps.log('Daemon started in background.');
    deps.log('  Gateway  -> http://localhost:3999');
    deps.log(`  Hatchery -> ${hatcheryUrl}\n`);
  } else {
    deps.log('\nSkipping daemon startup because --no-start was provided.');
  }

  if (options.openHatchery) {
    deps.log(`Opening Hatchery onboarding: ${hatcheryUrl}`);
    const open = createOpenCommand(hatcheryUrl, process.platform);
    const browser = deps.spawn(open.command, open.args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    browser.unref();
  } else {
    deps.log(`Hatchery onboarding is available at: ${hatcheryUrl}`);
  }

  deps.log('\nNext command after onboarding:');
  deps.log('  helmr ask "summarize this workspace"');
  deps.log(`Personal: ${PERSONAL_GREETING}`);
  deps.log(`Enterprise: ${ENTERPRISE_GREETING}\n`);

  return 0;

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInstaller().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  }).catch((err) => {
    console.error('Fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
