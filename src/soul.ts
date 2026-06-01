import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * soul.md is Helmr's constitution — its identity, loyalty rules, and operating
 * principles. It is the source of truth: the runtime LOADS it, it is never the
 * code that owns the text. This module reads it, validates it exists, exposes it
 * to context construction, and fails safe (never throws) if it is missing.
 */

export const SOUL_FILENAME = 'soul.md';

export interface SoulLoadResult {
  found: boolean;
  path: string;
  content: string;
  error?: string;
}

/**
 * Resolve the path to soul.md. Priority:
 *   1. HELMR_SOUL_PATH env override
 *   2. <cwd>/soul.md
 *   3. repo root relative to this compiled module (dist/src/soul.js -> ../../)
 */
export function resolveSoulPath(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): string {
  const explicit = env['HELMR_SOUL_PATH']?.trim();
  if (explicit) return explicit;

  const candidates = [join(cwd, SOUL_FILENAME), moduleRelativeSoulPath()];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function moduleRelativeSoulPath(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // Compiled to dist/src/soul.js; repo root is two levels up.
    return join(here, '..', '..', SOUL_FILENAME);
  } catch {
    return join(process.cwd(), SOUL_FILENAME);
  }
}

/**
 * The loader. Caches the result so repeated context construction is cheap;
 * call reload() after soul.md changes.
 */
export class SoulLoader {
  private cached: SoulLoadResult | undefined;

  constructor(
    private readonly path: string = resolveSoulPath(),
    private readonly logger: (message: string) => void = (m) => console.error(m),
  ) {}

  load(): SoulLoadResult {
    if (this.cached) return this.cached;
    this.cached = this.read();
    return this.cached;
  }

  reload(): SoulLoadResult {
    this.cached = undefined;
    return this.load();
  }

  private read(): SoulLoadResult {
    if (!existsSync(this.path)) {
      const error = `soul.md not found at ${this.path} — Helmr is running without its constitution`;
      this.logger(`[soul] ${error}`);
      return { found: false, path: this.path, content: '', error };
    }
    try {
      const content = readFileSync(this.path, 'utf8');
      if (!content.trim()) {
        const error = `soul.md at ${this.path} is empty`;
        this.logger(`[soul] ${error}`);
        return { found: false, path: this.path, content: '', error };
      }
      return { found: true, path: this.path, content };
    } catch (err) {
      const error = `failed to read soul.md at ${this.path}: ${(err as Error).message}`;
      this.logger(`[soul] ${error}`);
      return { found: false, path: this.path, content: '', error };
    }
  }
}

let defaultLoader: SoulLoader | undefined;

function getDefaultLoader(): SoulLoader {
  if (!defaultLoader) defaultLoader = new SoulLoader();
  return defaultLoader;
}

/** Load the soul (cached). Never throws. */
export function loadSoul(): SoulLoadResult {
  return getDefaultLoader().load();
}

/**
 * Build a prompt-ready soul context block for inclusion in system prompts /
 * context construction. Returns '' when soul.md is missing so callers can splice
 * it in unconditionally and degrade safely.
 */
export function buildSoulContext(): string {
  const soul = loadSoul();
  if (!soul.found) return '';
  return `<helmr-soul source="soul.md">\n${soul.content.trim()}\n</helmr-soul>\n\n`;
}
