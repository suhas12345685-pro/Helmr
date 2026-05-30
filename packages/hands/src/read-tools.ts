import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

export interface WorkspaceSummary {
  root: string;
  files: string[];
}

export async function summarizeWorkspace(workspacePath: string, limit = 200): Promise<WorkspaceSummary> {
  const root = resolve(workspacePath);
  const files: string[] = [];
  await walk(root, root, files, limit);
  return { root, files };
}

export async function readWorkspaceFile(workspacePath: string, filePath: string): Promise<string> {
  const root = resolve(workspacePath);
  const target = resolve(root, filePath);
  const rel = relative(root, target);

  if (rel.startsWith('..') || rel === '' || rel.includes(`..${sep}`)) {
    throw new Error(`file is outside workspace: ${filePath}`);
  }

  const info = await stat(target);
  if (!info.isFile()) {
    throw new Error(`not a file: ${filePath}`);
  }

  return readFile(target, 'utf8');
}

async function walk(root: string, current: string, files: string[], limit: number): Promise<void> {
  if (files.length >= limit) {
    return;
  }

  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= limit || ignored(entry.name)) {
      continue;
    }

    const absolute = resolve(current, entry.name);
    const rel = relative(root, absolute);
    if (entry.isDirectory()) {
      await walk(root, absolute, files, limit);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
}

function ignored(name: string): boolean {
  return name === 'node_modules' || name === 'dist' || name === '.git' || name === '.helmr';
}
