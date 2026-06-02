import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

import { parseSkillManifest, type SkillManifest } from './manifest.js';

const SKILL_FILE_SUFFIX = '.skill.json';

/**
 * Discovers and persists Helmr skills as `<id>.skill.json` files in a directory.
 *
 * The registry is intentionally stateless: every read re-scans the directory, so
 * a skill written by an approved `skill_write` receipt is "auto-wired" — it shows
 * up the next time anything lists skills, with no restart or code change needed.
 */
export class SkillRegistry {
  constructor(private readonly skillsDir: string) {}

  /** Last loaded in-memory snapshot, for live (hot-reloaded) consumers. */
  private snapshot: SkillManifest[] = [];

  /** Absolute path of the skills directory this registry owns. */
  get dir(): string {
    return this.skillsDir;
  }

  async init(): Promise<void> {
    await mkdir(this.skillsDir, { recursive: true });
  }

  /** Refresh the in-memory snapshot from disk and return it. */
  async load(): Promise<SkillManifest[]> {
    this.snapshot = await this.list();
    return this.snapshot;
  }

  /** The last loaded snapshot, without touching disk. */
  cached(): SkillManifest[] {
    return this.snapshot;
  }

  /**
   * Watch the skills directory and hot-reload the snapshot whenever a skill is
   * created, updated, or removed — so long-running consumers (the daemon, the
   * Hatchery server) reflect a new skill the instant it lands, with no restart.
   * Returns an unsubscribe function.
   */
  watch(onChange?: (skills: SkillManifest[]) => void): () => void {
    let watcher: FSWatcher | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      if (timer) clearTimeout(timer);
      // Debounce: editors and writes often emit several events in a burst.
      timer = setTimeout(() => {
        void this.load().then((skills) => onChange?.(skills));
      }, 50);
    };

    void this.init().then(() => {
      try {
        watcher = fsWatch(this.skillsDir, refresh);
        // Never let a forgotten watcher keep a process alive on its own.
        watcher.unref?.();
      } catch {
        // Watching is best-effort; consumers can still call load() on demand.
      }
      void this.load().then((skills) => onChange?.(skills));
    });

    return () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    };
  }

  /** All skills on disk. Malformed skill files are skipped, never thrown. */
  async list(): Promise<SkillManifest[]> {
    let entries: string[];
    try {
      entries = await readdir(this.skillsDir);
    } catch {
      return [];
    }

    const loadSkillPromises = entries.sort().map(async (entry) => {
      if (!entry.endsWith(SKILL_FILE_SUFFIX)) return null;
      try {
        // ⚡ Bolt: parallelize file reading and parsing
        const raw = await readFile(join(this.skillsDir, entry), 'utf8');
        return parseSkillManifest(JSON.parse(raw));
      } catch {
        // Skip malformed or partially-written skill files so discovery is robust.
        return null;
      }
    });

    const results = await Promise.all(loadSkillPromises);
    return results.filter((skill): skill is SkillManifest => skill !== null);
  }

  async listEnabled(): Promise<SkillManifest[]> {
    return (await this.list()).filter((skill) => skill.enabled);
  }

  async get(id: string): Promise<SkillManifest | undefined> {
    return (await this.list()).find((skill) => skill.id === id);
  }

  /** Create or update a skill. Preserves the original createdAt on update. */
  async write(manifest: SkillManifest): Promise<SkillManifest> {
    const now = new Date().toISOString();
    const existing = await this.get(manifest.id);
    const parsed = parseSkillManifest({
      ...manifest,
      createdAt: existing?.createdAt ?? manifest.createdAt ?? now,
      updatedAt: now,
    });
    await this.init();
    await writeFile(this.fileFor(parsed.id), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return parsed;
  }

  async remove(id: string): Promise<boolean> {
    try {
      await rm(this.fileFor(id));
      return true;
    } catch {
      return false;
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<SkillManifest | undefined> {
    const skill = await this.get(id);
    if (!skill) return undefined;
    return this.write({ ...skill, enabled });
  }

  private fileFor(id: string): string {
    return join(this.skillsDir, `${id}${SKILL_FILE_SUFFIX}`);
  }
}

/**
 * Naive relevance match: which enabled skills are triggered by a piece of text.
 * This is the "sense which skill applies" step of the anticipatory loop.
 */
export function matchSkills(skills: SkillManifest[], text: string): SkillManifest[] {
  const haystack = text.toLowerCase();
  return skills
    .filter((skill) => skill.enabled)
    .filter((skill) => skill.triggers.some((trigger) => haystack.includes(trigger.toLowerCase())));
}
