import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { DailySpendStore } from './budget.js';

/**
 * File-backed daily spend store. Persists a `{ [date]: usd }` map as JSON so the
 * per-day budget cap survives process restarts — the whole point of a real
 * dollar budget for unattended operation. Writes are serialized through a tail
 * promise to avoid lost updates under concurrent records, and the file is held
 * at 0600 (it reveals spend, not secrets, but stays owner-only for consistency
 * with the secret store).
 */
export class FileDailySpendStore implements DailySpendStore {
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  private async readAll(): Promise<Record<string, number>> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      }
      return out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async get(dateKey: string): Promise<number> {
    return (await this.readAll())[dateKey] ?? 0;
  }

  add(dateKey: string, usd: number): Promise<number> {
    // Chain writes so concurrent records read-modify-write without clobbering.
    const next = this.writeChain.then(async () => {
      const all = await this.readAll();
      const updated = (all[dateKey] ?? 0) + usd;
      all[dateKey] = updated;
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, `${JSON.stringify(pruneOld(all), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(this.path, 0o600).catch(() => undefined);
      return updated;
    });
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}

/** Keep the ledger small: drop entries older than ~60 days. */
function pruneOld(all: Record<string, number>): Record<string, number> {
  const keys = Object.keys(all).sort();
  if (keys.length <= 60) return all;
  const keep = new Set(keys.slice(-60));
  const out: Record<string, number> = {};
  for (const k of keys) if (keep.has(k)) out[k] = all[k]!;
  return out;
}
