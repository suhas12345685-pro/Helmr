import { exec } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ShellResult {
  stdout: string;
  stderr: string;
  command: string;
}

const ALLOWED_PREFIXES = [
  'ls',
  'dir',
  'cat',
  'type',
  'echo',
  'pwd',
  'git status',
  'git log',
  'git diff --stat',
  'git branch',
  'git remote',
  'git show',
  'node --version',
  'npm --version',
  'npm list',
  'npx tsc --noEmit',
] as const;

function isAllowedCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  return ALLOWED_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export async function runShellRead(workspacePath: string, command: string): Promise<ShellResult> {
  if (!isAllowedCommand(command)) {
    throw new Error(`command not in read-only allowlist: ${command}`);
  }

  const root = resolve(workspacePath);
  const { stdout, stderr } = await execAsync(command, {
    cwd: root,
    timeout: 15_000,
    maxBuffer: 1024 * 512,
  });

  return {
    stdout: redactSecrets(stdout),
    stderr: redactSecrets(stderr),
    command,
  };
}

export async function runGitStatus(workspacePath: string): Promise<ShellResult> {
  const root = resolve(workspacePath);
  try {
    const { stdout, stderr } = await execAsync('git status', {
      cwd: root,
      timeout: 10_000,
    });
    return { stdout, stderr, command: 'git status' };
  } catch {
    return { stdout: '', stderr: 'not a git repository or git not available', command: 'git status' };
  }
}

export async function runGitLog(workspacePath: string, maxCount = 10): Promise<ShellResult> {
  const root = resolve(workspacePath);
  const cmd = `git log --oneline -${maxCount}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: root,
      timeout: 10_000,
    });
    return { stdout, stderr, command: cmd };
  } catch {
    return { stdout: '', stderr: 'not a git repository or no commits', command: cmd };
  }
}

function redactSecrets(text: string): string {
  return text
    .replace(/(?:api[_-]?key|token|secret|password|passwd|pwd)\s*=\s*\S+/gi, '[REDACTED]')
    .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_KEY]');
}
