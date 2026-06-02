import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { redactSecrets } from '../../shared/src/redaction.js';

export interface ProcessResult {
  stdout: string;
  stderr: string;
  command: string;
  exitCode: number;
}

export interface ProcessRunOptions {
  timeoutMs: number;
  maxBufferBytes: number;
  /**
   * Scoped environment for the child process. When provided, the child runs with
   * exactly this env (e.g. base operational keys + capability-granted secrets
   * from the credential broker) instead of inheriting the daemon's full env.
   * When omitted, the child inherits `process.env` (back-compat).
   */
  env?: Record<string, string>;
}

export async function runProcess(
  workspacePath: string,
  argv: readonly string[],
  options: ProcessRunOptions,
): Promise<ProcessResult> {
  if (argv.length === 0 || !argv[0]) {
    throw new Error('command argv must include an executable');
  }

  const root = resolve(workspacePath);
  const command = formatCommand(argv);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: root,
      shell: false,
      windowsHide: true,
      ...(options.env ? { env: options.env as NodeJS.ProcessEnv } : {}),
    });

    let stdout = '';
    let stderr = '';
    let bufferedBytes = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
        reject(new Error(`command timed out after ${options.timeoutMs}ms: ${command}`));
        settled = true;
      }
    }, options.timeoutMs);

    const append = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      bufferedBytes += chunk.byteLength;
      if (bufferedBytes > options.maxBufferBytes && !settled) {
        child.kill('SIGTERM');
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`command output exceeded ${options.maxBufferBytes} bytes: ${command}`));
        return;
      }

      if (target === 'stdout') {
        stdout += redactSecrets(chunk.toString('utf8'));
      } else {
        stderr += redactSecrets(chunk.toString('utf8'));
      }
    };

    child.stdout.on('data', (chunk: Buffer) => append(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => append(chunk, 'stderr'));
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolvePromise({ stdout, stderr, command, exitCode: code ?? 1 });
      }
    });
  });
}

export function formatCommand(argv: readonly string[]): string {
  return argv.map((arg) => (/[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg)).join(' ');
}
