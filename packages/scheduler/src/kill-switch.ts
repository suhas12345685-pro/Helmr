/**
 * Kill-switch: a durable, recallable halt on autonomous work.
 *
 * "Autonomy is a loan of trust, and it can be recalled." (soul.md) The switch is
 * the recall mechanism — a single, fast-to-check flag the runtime and embodied
 * agent loops consult so they can stop within one step, from the CLI or the
 * Hatchery UI, even if the process is busy.
 *
 * Scopes:
 *   - `global` — halts ALL work. Any per-agent check also returns halted.
 *   - `<agentId>` — halts a single embodied agent.
 *
 * Backing is durable (the `control_flags` table) so a halt survives a restart —
 * an operator hitting stop must mean it stays stopped. An in-process cache with
 * a short TTL keeps the hot-path check cheap (one DB read per TTL window, not per
 * step); `halt`/`resume` refresh the cache immediately so a local toggle takes
 * effect at once.
 */

export const GLOBAL_SCOPE = 'global';

export interface ControlFlagStore {
  setControlFlag(scope: string, halted: boolean, reason?: string): Promise<void>;
  getControlFlag(scope: string): Promise<{ halted: boolean; reason?: string; updatedAt: string } | undefined>;
  listControlFlags(): Promise<Array<{ scope: string; halted: boolean; reason?: string; updatedAt: string }>>;
}

export interface KillSwitchState {
  halted: boolean;
  scope: string;
  reason?: string;
}

export interface KillSwitchOptions {
  store: ControlFlagStore;
  /** Cache TTL for the hot-path check, in ms. Default 1000. */
  cacheTtlMs?: number;
  now?: () => number;
}

interface CacheEntry {
  halted: boolean;
  reason?: string;
  fetchedAt: number;
}

const DEFAULT_CACHE_TTL_MS = 1000;

export class KillSwitch {
  private readonly store: ControlFlagStore;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: KillSwitchOptions) {
    this.store = options.store;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Engage the switch for a scope (default global). */
  async halt(scope: string = GLOBAL_SCOPE, reason?: string): Promise<void> {
    await this.store.setControlFlag(scope, true, reason);
    this.cache.set(scope, { halted: true, reason, fetchedAt: this.now() });
  }

  /** Clear the switch for a scope (default global). */
  async resume(scope: string = GLOBAL_SCOPE): Promise<void> {
    await this.store.setControlFlag(scope, false);
    this.cache.set(scope, { halted: false, fetchedAt: this.now() });
  }

  /**
   * True if work in `scope` should stop. Global halt dominates: a per-agent
   * check is halted whenever the global switch is engaged.
   */
  async isHalted(scope: string = GLOBAL_SCOPE): Promise<boolean> {
    if (scope !== GLOBAL_SCOPE && (await this.readCached(GLOBAL_SCOPE)).halted) return true;
    return (await this.readCached(scope)).halted;
  }

  /** The full state for a scope (resolving global dominance), uncached miss aside. */
  async state(scope: string = GLOBAL_SCOPE): Promise<KillSwitchState> {
    if (scope !== GLOBAL_SCOPE) {
      const global = await this.readCached(GLOBAL_SCOPE);
      if (global.halted) return { halted: true, scope: GLOBAL_SCOPE, reason: global.reason };
    }
    const entry = await this.readCached(scope);
    return { halted: entry.halted, scope, reason: entry.reason };
  }

  /** All engaged scopes, for status surfaces (CLI / Hatchery). */
  async listHalted(): Promise<Array<{ scope: string; reason?: string; updatedAt: string }>> {
    const flags = await this.store.listControlFlags();
    return flags.filter((f) => f.halted).map(({ scope, reason, updatedAt }) => ({ scope, reason, updatedAt }));
  }

  /** Drop the in-process cache (test helper / after external writes). */
  invalidate(): void {
    this.cache.clear();
  }

  private async readCached(scope: string): Promise<CacheEntry> {
    const cached = this.cache.get(scope);
    if (cached && this.now() - cached.fetchedAt < this.cacheTtlMs) return cached;
    const flag = await this.store.getControlFlag(scope);
    const entry: CacheEntry = { halted: flag?.halted ?? false, reason: flag?.reason, fetchedAt: this.now() };
    this.cache.set(scope, entry);
    return entry;
  }
}

/** Raised on the runtime hot-path when the switch is engaged mid-job. */
export class KillSwitchEngagedError extends Error {
  readonly scope: string;
  constructor(state: KillSwitchState) {
    super(`kill-switch engaged (${state.scope})${state.reason ? `: ${state.reason}` : ''}`);
    this.name = 'KillSwitchEngagedError';
    this.scope = state.scope;
  }
}
