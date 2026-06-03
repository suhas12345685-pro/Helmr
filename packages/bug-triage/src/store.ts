import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { BugReport } from './triage.js';

const SUFFIX = '.bug.json';

/** A bug's lifecycle as it moves through report → reproduce → fix → PR. */
export type BugStatus =
  | 'reported'
  | 'needs_reproduction'
  | 'reproduced'
  | 'fixing'
  | 'fixed'
  | 'pr_opened'
  | 'closed';

export interface StoredBug extends BugReport {
  status: BugStatus;
  /** Path to the generated failing test, once written. */
  failingTestPath?: string;
  /** Branch opened for the fix, once created. */
  fixBranch?: string;
  /** PR number/url, once opened. */
  pr?: string;
  updatedAt: string;
}

/** File-backed bug store, one `<id>.bug.json` per report. */
export class BugStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}${SUFFIX}`);
  }

  async list(): Promise<StoredBug[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }
    const bugs = await Promise.all(
      entries
        .filter((e) => e.endsWith(SUFFIX))
        .sort()
        .map(async (e) => {
          try {
            return JSON.parse(await readFile(join(this.dir, e), 'utf8')) as StoredBug;
          } catch {
            return null;
          }
        }),
    );
    return bugs.filter((b): b is StoredBug => b !== null);
  }

  async get(id: string): Promise<StoredBug | undefined> {
    try {
      return JSON.parse(await readFile(this.fileFor(id), 'utf8')) as StoredBug;
    } catch {
      return undefined;
    }
  }

  async write(bug: StoredBug): Promise<StoredBug> {
    await this.init();
    const next = { ...bug, updatedAt: new Date().toISOString() };
    await writeFile(this.fileFor(bug.id), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  async patch(id: string, patch: Partial<StoredBug>): Promise<StoredBug | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    return this.write({ ...existing, ...patch });
  }
}
