import { writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { resolve, relative, sep, dirname, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

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

// ── Shell sanitization helper ────────────────────────────────────────

function hasShellMetacharacters(command: string): boolean {
  const metacharacters = [';', '&', '|', '`', '$', '>', '<', '\n', '\r'];
  return metacharacters.some((char) => command.includes(char));
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

const WRITE_ALLOWLIST = [
  'npm install',
  'npm ci',
  'npm run',
  'npx tsc',
  'git add',
  'git commit',
  'git checkout',
  'git stash',
  'node',
  'mkdir',
  'rm',
] as const;

function isAllowedWriteCommand(command: string): boolean {
  const trimmed = command.trim();
  const lowerTrimmed = trimmed.toLowerCase();

  const hasAllowedPrefix = WRITE_ALLOWLIST.some((prefix) => {
    const lowerPrefix = prefix.toLowerCase();
    return lowerTrimmed === lowerPrefix || lowerTrimmed.startsWith(lowerPrefix + ' ');
  });

  if (!hasAllowedPrefix) {
    return false;
  }

  if (hasShellMetacharacters(trimmed)) {
    return false;
  }

  return true;
}

export async function runShellWrite(
  workspacePath: string,
  command: string,
): Promise<ShellWriteResult> {
  if (!isAllowedWriteCommand(command)) {
    throw new Error(`command not in write allowlist: ${command}`);
  }

  const root = resolve(workspacePath);
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: root,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout, stderr, command, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      command,
      exitCode: e.code ?? 1,
    };
  }
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

    if (hasShellMetacharacters(rel)) {
      throw new Error(`invalid characters in path: ${p}`);
    }

    const escapedPath = rel.replace(/"/g, '\\"');
    sanitizedPaths.push(`"${escapedPath}"`);
  }

  if (sanitizedPaths.length === 0) {
    throw new Error('no paths provided to gitAdd');
  }

  return runShellWrite(workspacePath, `git add ${sanitizedPaths.join(' ')}`);
}

export async function gitCommit(workspacePath: string, message: string): Promise<ShellWriteResult> {
  if (hasShellMetacharacters(message)) {
    throw new Error('commit message contains forbidden shell metacharacters');
  }

  const safe = message.replace(/"/g, '\\"');
  return runShellWrite(workspacePath, `git commit -m "${safe}"`);
}

export async function gitCheckout(
  workspacePath: string,
  ref: string,
  newBranch = false,
): Promise<ShellWriteResult> {
  const flag = newBranch ? '-b ' : '';
  const cleanRef = ref.replace(/[^a-zA-Z0-9/._-]/g, '');
  if (cleanRef !== ref) {
    throw new Error(`invalid ref for checkout: ${ref}`);
  }
  return runShellWrite(workspacePath, `git checkout ${flag}${cleanRef}`);
}

// ── Package install (approval-gated) ──────────────────────────────

export async function npmInstall(
  workspacePath: string,
  packages: string[],
  opts: { dev?: boolean; exact?: boolean } = {},
): Promise<ShellWriteResult> {
  const flags = [opts.dev ? '--save-dev' : '', opts.exact ? '--save-exact' : '']
    .filter(Boolean)
    .join(' ');
  
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

  const pkgString = sanitizedPkgs.join(' ');
  const command = `npm install ${flags} ${pkgString}`.trim().replace(/\s+/g, ' ');
  return runShellWrite(workspacePath, command);
}
