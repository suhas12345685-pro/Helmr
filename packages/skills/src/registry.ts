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
export interface SkillRegistryEntry { manifest?: SkillManifest; path: string; status: 'enabled' | 'disabled' | 'broken'; error?: string }

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

  /** Inspect all skill files, quarantining malformed modules instead of crashing. */
  async entries(): Promise<SkillRegistryEntry[]> {
    let entries: string[];
    try {
      entries = await readdir(this.skillsDir);
    } catch {
      return [];
    }

    const loaded = await Promise.all(entries.sort().map(async (entry) => {
      if (!entry.endsWith(SKILL_FILE_SUFFIX)) return null;
      const path = join(this.skillsDir, entry);
      try {
        const raw = await readFile(path, 'utf8');
        const manifest = parseSkillManifest(JSON.parse(raw));
        return { manifest, path, status: manifest.enabled ? 'enabled' : 'disabled' } satisfies SkillRegistryEntry;
      } catch (err) {
        return { path, status: 'broken', error: err instanceof Error ? err.message : String(err) } satisfies SkillRegistryEntry;
      }
    }));
    return loaded.filter((entry): entry is SkillRegistryEntry => entry !== null);
  }

  async listBroken(): Promise<SkillRegistryEntry[]> {
    return (await this.entries()).filter((entry) => entry.status === 'broken');
  }

  async health(): Promise<Array<{ id: string; ok: boolean; detail: string }>> {
    return (await this.entries()).map((entry) => entry.manifest
      ? { id: entry.manifest.id, ok: entry.status !== 'broken' && entry.manifest.enabled, detail: entry.status }
      : { id: entry.path, ok: false, detail: entry.error ?? 'broken manifest' });
  }

  async docsMarkdown(): Promise<string> {
    const skills = await this.list();
    return ['# Helmr Skill Registry', '', ...skills.map((skill) => `## ${skill.id}\n${skill.description}\n\n- Kind: ${skill.kind}\n- Risk: ${skill.riskLevel}\n- Permissions: ${skill.permissions.join(', ') || 'none'}`)].join('\n');
  }

  /** All valid skills on disk. Malformed skill files are visible via entries/listBroken. */
  async list(): Promise<SkillManifest[]> {
    let entries: string[];
    try {
      entries = await readdir(this.skillsDir);
    } catch {
      return [];
    }

    const results = await this.entries();
    return results.map((entry) => entry.manifest).filter((skill): skill is SkillManifest => Boolean(skill));
  }

  async listEnabled(): Promise<SkillManifest[]> {
    return (await this.list()).filter((skill) => skill.enabled);
  }

  async get(id: string): Promise<SkillManifest | undefined> {
    try {
      const raw = await readFile(this.fileFor(id), 'utf8');
      return parseSkillManifest(JSON.parse(raw));
    } catch {
      return undefined;
    }
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
export function filterSkillsByPermissions(skills: SkillManifest[], allowedPermissions: string[]): SkillManifest[] {
  const allowed = new Set(allowedPermissions);
  return skills.filter((skill) => skill.permissions.every((permission) => allowed.has(permission)));
}

export function matchSkills(skills: SkillManifest[], text: string): SkillManifest[] {
  const haystack = text.toLowerCase();
  return skills
    .filter((skill) => skill.enabled)
    .filter((skill) => skill.triggers.some((trigger) => haystack.includes(trigger.toLowerCase())));
}
