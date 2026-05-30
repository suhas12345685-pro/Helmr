import { runProcess, type ProcessResult } from './process-runner.js';

export interface ShellResult {
  stdout: string;
  stderr: string;
  command: string;
}

const READ_ALLOWLIST: ReadonlyArray<readonly string[]> = [
  ['ls'],
  ['dir'],
  ['cat'],
  ['type'],
  ['echo'],
  ['pwd'],
  ['git', 'status'],
  ['git', 'log'],
  ['git', 'diff', '--stat'],
  ['git', 'branch'],
  ['git', 'remote'],
  ['git', 'show'],
  ['node', '--version'],
  ['npm', '--version'],
  ['npm', 'list'],
  ['npx', 'tsc', '--noEmit'],
] as const;

export type CommandArgv = readonly string[];

function validateArgv(argv: CommandArgv): string[] {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error('command must be provided as an argv array');
  }

  return argv.map((arg) => {
    if (typeof arg !== 'string' || arg.length === 0) {
      throw new Error('command argv entries must be non-empty strings');
    }
    if (/[\u0000\r\n]/u.test(arg)) {
      throw new Error('command argv entries must not contain control delimiters');
    }
    return arg;
  });
}

function isAllowedCommand(argv: CommandArgv): boolean {
  const normalized = validateArgv(argv).map((part) => part.toLowerCase());
  return READ_ALLOWLIST.some((prefix) => {
    if (normalized.length < prefix.length) {
      return false;
    }
    return prefix.every((part, index) => normalized[index] === part);
  });
}

export async function runShellRead(workspacePath: string, argv: CommandArgv): Promise<ShellResult> {
  if (!isAllowedCommand(argv)) {
    throw new Error(`command not in read-only allowlist: ${JSON.stringify(argv)}`);
  }

  const result = await runProcess(workspacePath, argv, {
    timeoutMs: 15_000,
    maxBufferBytes: 1024 * 512,
  });

  return toShellResult(result);
}

export async function runGitStatus(workspacePath: string): Promise<ShellResult> {
  try {
    return toShellResult(await runProcess(workspacePath, ['git', 'status'], {
      timeoutMs: 10_000,
      maxBufferBytes: 1024 * 512,
    }));
  } catch {
    return { stdout: '', stderr: 'not a git repository or git not available', command: 'git status' };
  }
}

export async function runGitLog(workspacePath: string, maxCount = 10): Promise<ShellResult> {
  const safeMaxCount = Number.isInteger(maxCount) && maxCount > 0 ? Math.min(maxCount, 50) : 10;
  const argv = ['git', 'log', '--oneline', `-${safeMaxCount}`];
  try {
    return toShellResult(await runProcess(workspacePath, argv, {
      timeoutMs: 10_000,
      maxBufferBytes: 1024 * 512,
    }));
  } catch {
    return { stdout: '', stderr: 'not a git repository or no commits', command: argv.join(' ') };
  }
}

function toShellResult(result: ProcessResult): ShellResult {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    command: result.command,
  };
}
