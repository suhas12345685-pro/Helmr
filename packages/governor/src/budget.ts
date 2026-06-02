import { estimateCostUsd, type TokenUsage } from './pricing.js';

/**
 * Budget ledger: real-dollar spend, token, action, wall-clock and tool-rate
 * accounting for autonomous jobs.
 *
 * Tracking actions/time/rate is not enough for unattended operation — a runaway
 * loop on an expensive model burns money, not just steps. This ledger converts
 * AI-SDK token usage into USD via the price table and enforces a per-job and a
 * per-day spend cap alongside the action/time/rate caps. The per-day total is
 * persisted, so a restart does not reset the day's spend (`record` adds through
 * the store; `check` reads back through it).
 *
 * On a trip the caller pauses the job (`paused_budget`) and can resume once the
 * Operator raises the cap — the ledger never kills work on its own.
 */

export interface BudgetLimits {
  /** Max USD spend for a single job. */
  usdPerJob?: number;
  /** Max USD spend across all jobs in a calendar day (UTC). */
  usdPerDay?: number;
  /** Max recorded actions (tool calls + LLM calls) for a single job. */
  maxActionsPerJob?: number;
  /** Max wall-clock seconds a single job may run. */
  maxJobSeconds?: number;
  /** Max actions within any sliding 60s window for a single job. */
  toolRatePerMin?: number;
}

export type TrippedLimit =
  | 'usd_per_job'
  | 'usd_per_day'
  | 'actions_per_job'
  | 'job_seconds'
  | 'tool_rate';

export interface BudgetCheck {
  allowed: boolean;
  trippedLimit?: TrippedLimit;
  detail?: string;
}

export interface JobBudgetSnapshot {
  jobId: string;
  spendUsd: number;
  inputTokens: number;
  outputTokens: number;
  actions: number;
  elapsedSeconds: number;
}

/** Persistence for the per-day spend total (survives restarts). */
export interface DailySpendStore {
  get(dateKey: string): Promise<number>;
  add(dateKey: string, usd: number): Promise<number>;
}

/** In-memory daily store — fine for tests and single-process dev. */
export class InMemoryDailySpendStore implements DailySpendStore {
  private readonly totals = new Map<string, number>();
  async get(dateKey: string): Promise<number> {
    return this.totals.get(dateKey) ?? 0;
  }
  async add(dateKey: string, usd: number): Promise<number> {
    const next = (this.totals.get(dateKey) ?? 0) + usd;
    this.totals.set(dateKey, next);
    return next;
  }
}

interface JobState {
  spendUsd: number;
  inputTokens: number;
  outputTokens: number;
  actions: number;
  startedAtMs: number;
  actionTimesMs: number[];
}

const RATE_WINDOW_MS = 60_000;

export interface BudgetLedgerOptions {
  limits?: BudgetLimits;
  dailyStore?: DailySpendStore;
  now?: () => Date;
}

export class BudgetLedger {
  private readonly limits: BudgetLimits;
  private readonly dailyStore: DailySpendStore;
  private readonly now: () => Date;
  private readonly jobs = new Map<string, JobState>();

  constructor(options: BudgetLedgerOptions = {}) {
    this.limits = options.limits ?? {};
    this.dailyStore = options.dailyStore ?? new InMemoryDailySpendStore();
    this.now = options.now ?? (() => new Date());
  }

  private dateKey(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private state(jobId: string): JobState {
    let state = this.jobs.get(jobId);
    if (!state) {
      state = {
        spendUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        actions: 0,
        startedAtMs: this.now().getTime(),
        actionTimesMs: [],
      };
      this.jobs.set(jobId, state);
    }
    return state;
  }

  /**
   * Gate an upcoming action/LLM call. `projectedUsd` is the estimated cost of the
   * call about to be made (0 for a free local action). Returns the first tripped
   * limit, or `{ allowed: true }` when everything is within budget.
   */
  async check(jobId: string, projectedUsd = 0): Promise<BudgetCheck> {
    const state = this.state(jobId);
    const nowMs = this.now().getTime();

    if (this.limits.maxJobSeconds !== undefined) {
      const elapsed = (nowMs - state.startedAtMs) / 1000;
      if (elapsed > this.limits.maxJobSeconds) {
        return { allowed: false, trippedLimit: 'job_seconds', detail: `${elapsed.toFixed(1)}s > ${this.limits.maxJobSeconds}s` };
      }
    }

    if (this.limits.maxActionsPerJob !== undefined && state.actions >= this.limits.maxActionsPerJob) {
      return { allowed: false, trippedLimit: 'actions_per_job', detail: `${state.actions} >= ${this.limits.maxActionsPerJob}` };
    }

    if (this.limits.toolRatePerMin !== undefined) {
      const recent = state.actionTimesMs.filter((t) => nowMs - t < RATE_WINDOW_MS).length;
      if (recent >= this.limits.toolRatePerMin) {
        return { allowed: false, trippedLimit: 'tool_rate', detail: `${recent} actions in last 60s >= ${this.limits.toolRatePerMin}` };
      }
    }

    if (this.limits.usdPerJob !== undefined && state.spendUsd + projectedUsd > this.limits.usdPerJob) {
      return {
        allowed: false,
        trippedLimit: 'usd_per_job',
        detail: `$${(state.spendUsd + projectedUsd).toFixed(4)} > $${this.limits.usdPerJob}`,
      };
    }

    if (this.limits.usdPerDay !== undefined) {
      const today = await this.dailyStore.get(this.dateKey());
      if (today + projectedUsd > this.limits.usdPerDay) {
        return {
          allowed: false,
          trippedLimit: 'usd_per_day',
          detail: `$${(today + projectedUsd).toFixed(4)} > $${this.limits.usdPerDay}`,
        };
      }
    }

    return { allowed: true };
  }

  /** Record a completed LLM call's token usage as USD spend. Returns the cost. */
  async recordLlm(jobId: string, modelId: string, usage: TokenUsage | undefined): Promise<number> {
    const cost = estimateCostUsd(modelId, usage);
    const state = this.state(jobId);
    state.spendUsd += cost;
    state.inputTokens += usage?.inputTokens ?? usage?.promptTokens ?? 0;
    state.outputTokens += usage?.outputTokens ?? usage?.completionTokens ?? 0;
    this.markAction(state);
    if (cost > 0) await this.dailyStore.add(this.dateKey(), cost);
    return cost;
  }

  /** Record a non-LLM action (a tool/receipt execution). */
  recordAction(jobId: string): void {
    this.markAction(this.state(jobId));
  }

  private markAction(state: JobState): void {
    const nowMs = this.now().getTime();
    state.actions += 1;
    state.actionTimesMs.push(nowMs);
    // Keep only the sliding window so the array does not grow unbounded.
    state.actionTimesMs = state.actionTimesMs.filter((t) => nowMs - t < RATE_WINDOW_MS);
  }

  snapshot(jobId: string): JobBudgetSnapshot {
    const state = this.state(jobId);
    return {
      jobId,
      spendUsd: state.spendUsd,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      actions: state.actions,
      elapsedSeconds: (this.now().getTime() - state.startedAtMs) / 1000,
    };
  }

  async daySpendUsd(): Promise<number> {
    return this.dailyStore.get(this.dateKey());
  }
}

/** Raised by helpers that turn a budget trip into a control-flow signal. */
export class BudgetExceededError extends Error {
  readonly trippedLimit: TrippedLimit;
  constructor(check: BudgetCheck) {
    super(`budget tripped (${check.trippedLimit}): ${check.detail ?? ''}`.trim());
    this.name = 'BudgetExceededError';
    this.trippedLimit = check.trippedLimit!;
  }
}
