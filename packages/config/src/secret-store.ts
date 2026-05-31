import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';

const SECRETS_FILE = 'secrets.json';

export type SecretRecord = Record<string, string>;

/**
 * Durable, file-backed secret storage for provider API keys.
 *
 * Secrets are persisted as a single JSON object under the Helmr config
 * directory with owner-only (0600) permissions. This replaces the previous
 * process-only model where keys configured at runtime were lost on restart.
 *
 * The store deliberately treats the environment as authoritative: values
 * already present in the environment (e.g. injected by the container,
 * systemd EnvironmentFile, or an external secrets manager) are never
 * overwritten by `loadInto`. The on-disk store is the fallback for keys
 * configured interactively through Hatchery onboarding.
 */
export class SecretStore {
  private readonly path: string;

  constructor(private readonly configDir: string) {
    this.path = join(configDir, SECRETS_FILE);
  }

  async readAll(): Promise<SecretRecord> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return {};
      const out: SecretRecord = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') out[key] = value;
      }
      return out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.readAll())[key];
  }

  async set(key: string, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('refusing to store an empty secret');
    }
    const all = await this.readAll();
    all[key] = trimmed;
    await this.persist(all);
  }

  async delete(key: string): Promise<boolean> {
    const all = await this.readAll();
    if (!(key in all)) return false;
    delete all[key];
    await this.persist(all);
    return true;
  }

  /**
   * Load persisted secrets into `env`, without clobbering values the
   * environment already provides. Returns the keys that were applied.
   */
  async loadInto(env: Record<string, string | undefined> = process.env): Promise<string[]> {
    const all = await this.readAll();
    const loaded: string[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (!env[key]?.trim()) {
        env[key] = value;
        loaded.push(key);
      }
    }
    return loaded;
  }

  private async persist(record: SecretRecord): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await writeFile(this.path, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    // writeFile only applies mode when creating the file; enforce it on every write.
    await chmod(this.path, 0o600).catch(() => undefined);
  }
}
