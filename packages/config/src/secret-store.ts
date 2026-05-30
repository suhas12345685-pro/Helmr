import { readFile, writeFile, mkdir, chmod, access, constants } from 'node:fs/promises';
import { dirname } from 'node:path';

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

interface StoredSecret {
  value: string;
  updatedAt: string;
}

interface StoredFile {
  version: 1;
  secrets: Record<string, StoredSecret>;
}

function emptyFile(): StoredFile {
  return { version: 1, secrets: {} };
}

export class SecretStore {
  private cache: StoredFile | null = null;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      await access(this.filePath, constants.R_OK);
    } catch {
      this.cache = emptyFile();
      return;
    }
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoredFile>;
      if (parsed.version === 1 && parsed.secrets && typeof parsed.secrets === 'object') {
        this.cache = { version: 1, secrets: parsed.secrets };
        return;
      }
      this.cache = emptyFile();
    } catch {
      this.cache = emptyFile();
    }
  }

  private async ensureLoaded(): Promise<StoredFile> {
    if (!this.cache) {
      await this.load();
    }
    return this.cache ?? emptyFile();
  }

  async get(key: string): Promise<string | undefined> {
    const file = await this.ensureLoaded();
    return file.secrets[key]?.value;
  }

  async list(): Promise<string[]> {
    const file = await this.ensureLoaded();
    return Object.keys(file.secrets);
  }

  async set(key: string, value: string): Promise<void> {
    const file = await this.ensureLoaded();
    file.secrets[key] = { value, updatedAt: new Date().toISOString() };
    this.cache = file;
    await this.persist(file);
  }

  async delete(key: string): Promise<boolean> {
    const file = await this.ensureLoaded();
    if (!(key in file.secrets)) return false;
    delete file.secrets[key];
    this.cache = file;
    await this.persist(file);
    return true;
  }

  async applyToEnv(env: NodeJS.ProcessEnv = process.env, mapping?: Record<string, string>): Promise<string[]> {
    const file = await this.ensureLoaded();
    const applied: string[] = [];
    for (const [key, secret] of Object.entries(file.secrets)) {
      const envKey = mapping?.[key] ?? key;
      if (envKey && secret.value && !env[envKey]) {
        env[envKey] = secret.value;
        applied.push(envKey);
      }
    }
    return applied;
  }

  private async persist(file: StoredFile): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    const payload = JSON.stringify(file, null, 2);
    await writeFile(this.filePath, payload, { encoding: 'utf8', mode: FILE_MODE });
    try {
      await chmod(this.filePath, FILE_MODE);
      await chmod(dir, DIR_MODE);
    } catch {
      // best-effort on platforms without POSIX modes
    }
  }
}
