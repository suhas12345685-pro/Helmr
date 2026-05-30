import { writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import { resolve, relative, sep, dirname, isAbsolute } from 'node:path';

import { runProcess } from './process-runner.js';

export interface WriteResult {
  path: string;
  operation: string;
  success: boolean;
}

export interface ShellWriteResult {
  stdout: string;
  stderr: string;
  command: string;
  exitCode: number;
}

// ── Path traversal check helper ─────────────────────────────────────

function checkPathTraversal(root: string, targetPath: string, label: string): string {
  const target = resolve(root, targetPath);
  const rel = relative(root, target);

  const rootLower = root.toLowerCase();
  const targetLower = target.toLowerCase();
  const sepLower = sep.toLowerCase();

  const isOutside =
    rel.startsWith('..') ||
    rel.includes(`..${sep}`) ||
    rel === '' ||
    targetLower === rootLower ||
    isAbsolute(rel) ||
    !targetLower.startsWith(rootLower + sepLower);

  if (isOutside) {
    throw new Error(`path traversal denied: ${label}`);
  }
  return target;
}

// ── Shell argv validation helper ────────────────────────────────────

function validateArgv(argv: readonly string[]): string[] {
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

// ── Filesystem writes ────────────────────────────────────────────────

export async function writeWorkspaceFile(
  workspacePath: string,
  filePath: string,
  content: string,
): Promise<WriteResult> {
  const root = resolve(workspacePath);
  const target = checkPathTraversal(root, filePath, filePath);
  const rel = relative(root, target);

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  return { path: rel, operation: 'write', success: true };
}

export async function deleteWorkspaceFile(
  workspacePath: string,
  filePath: string,
): Promise<WriteResult> {
  const root = resolve(workspacePath);
  const target = checkPathTraversal(root, filePath, filePath);
  const rel = relative(root, target);

  await unlink(target);
  return { path: rel, operation: 'delete', success: true };
}

export async function renameWorkspaceFile(
  workspacePath: string,
  fromPath: string,
  toPath: string,
): Promise<WriteResult> {
  const root = resolve(workspacePath);
  const from = checkPathTraversal(root, fromPath, fromPath);
  const to = checkPathTraversal(root, toPath, toPath);
  const relTo = relative(root, to);

  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  return { path: relTo, operation: 'rename', success: true };
}

// ── Shell writes (approval-gated) ──────────────────────────────────

const WRITE_ALLOWLIST: ReadonlyArray<readonly string[]> = [
  ['npm', 'install'],
  ['npm', 'ci'],
  ['npm', 'run'],
  ['npx', 'tsc'],
  ['git', 'add'],
  ['git', 'commit'],
  ['git', 'checkout'],
  ['git', 'stash'],
  ['node'],
  ['mkdir'],
  ['rm'],
] as const;

function isAllowedWriteCommand(argv: readonly string[]): boolean {
  const normalized = validateArgv(argv).map((part) => part.toLowerCase());
  return WRITE_ALLOWLIST.some((prefix) => {
    if (normalized.length < prefix.length) {
      return false;
    }
    return prefix.every((part, index) => normalized[index] === part);
  });
}

export async function runShellWrite(
  workspacePath: string,
  argv: readonly string[],
): Promise<ShellWriteResult> {
  if (!isAllowedWriteCommand(argv)) {
    throw new Error(`command not in write allowlist: ${JSON.stringify(argv)}`);
  }

  return runProcess(workspacePath, argv, {
    timeoutMs: 120_000,
    maxBufferBytes: 1024 * 1024,
  });
}

// ── Git write operations ───────────────────────────────────────────

export async function gitAdd(workspacePath: string, paths: string[]): Promise<ShellWriteResult> {
  const root = resolve(workspacePath);
  const sanitizedPaths: string[] = [];

  for (const p of paths) {
    const target = resolve(root, p);
    const rel = relative(root, target);

    if (rel.startsWith('..') || rel.includes(`..${sep}`) || rel === '' || target === root) {
      throw new Error(`path traversal denied in gitAdd: ${p}`);
    }

    if (/[\u0000\r\n]/u.test(rel)) {
      throw new Error(`invalid characters in path: ${p}`);
    }

    sanitizedPaths.push(rel);
  }

  if (sanitizedPaths.length === 0) {
    throw new Error('no paths provided to gitAdd');
  }

  return runShellWrite(workspacePath, ['git', 'add', ...sanitizedPaths]);
}

export async function gitCommit(workspacePath: string, message: string): Promise<ShellWriteResult> {
  if (/[\u0000\r\n]/u.test(message)) {
    throw new Error('commit message contains forbidden control delimiters');
  }

  return runShellWrite(workspacePath, ['git', 'commit', '-m', message]);
}

export async function gitCheckout(
  workspacePath: string,
  ref: string,
  newBranch = false,
): Promise<ShellWriteResult> {
  const cleanRef = ref.replace(/[^a-zA-Z0-9/._-]/g, '');
  if (cleanRef !== ref) {
    throw new Error(`invalid ref for checkout: ${ref}`);
  }
  return runShellWrite(
    workspacePath,
    newBranch ? ['git', 'checkout', '-b', cleanRef] : ['git', 'checkout', cleanRef],
  );
}

// ── Package install (approval-gated) ──────────────────────────────

export async function npmInstall(
  workspacePath: string,
  packages: string[],
  opts: { dev?: boolean; exact?: boolean } = {},
): Promise<ShellWriteResult> {
  const flags = [opts.dev ? '--save-dev' : '', opts.exact ? '--save-exact' : ''].filter(Boolean);

  const sanitizedPkgs = packages.map((p) => {
    const clean = p.replace(/[^a-zA-Z0-9@/._\-^~=]/g, '');
    if (clean !== p) {
      throw new Error(`invalid package name or specifier: ${p}`);
    }
    return clean;
  });

  if (sanitizedPkgs.length === 0) {
    throw new Error('no packages specified for npmInstall');
  }

  return runShellWrite(workspacePath, ['npm', 'install', ...flags, ...sanitizedPkgs]);
}
