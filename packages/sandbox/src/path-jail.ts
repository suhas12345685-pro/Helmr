import { resolve, relative, sep, isAbsolute } from 'node:path';

/**
 * Returns true when `targetPath`, resolved against `workspaceRoot`, lands
 * outside the workspace tree. The workspace root itself does not escape.
 */
export function escapesWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const root = resolve(workspaceRoot);
  const target = resolve(root, targetPath);

  if (target === root) {
    return false;
  }

  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return true;
  }

  const rootLower = root.toLowerCase();
  const targetLower = target.toLowerCase();
  const sepLower = sep.toLowerCase();

  return !targetLower.startsWith(rootLower + sepLower);
}

/**
 * Resolves `targetPath` against `workspaceRoot`, throwing if the result would
 * escape the sandbox. Mirrors the path-jail used by the Hands write tools so
 * the execution plane shares one boundary definition.
 */
export function assertWithinWorkspace(
  workspaceRoot: string,
  targetPath: string,
  label: string = targetPath,
): string {
  if (escapesWorkspace(workspaceRoot, targetPath)) {
    throw new Error(`path escapes workspace sandbox: ${label}`);
  }
  return resolve(workspaceRoot, targetPath);
}
