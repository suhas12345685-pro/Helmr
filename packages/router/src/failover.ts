/**
 * Provider-resilient execution: timeouts, transient retries, and cross-provider
 * failover for the LLM reasoning plane.
 *
 * The agent's value is "it does the task well", and that depends on the model
 * call actually completing. A single provider hiccup — a timeout, a 429, a 5xx —
 * should not sink a whole job. `runWithFailover` runs an ordered list of
 * attempts (typically the same prompt against successively cheaper/alternate
 * models): each attempt is wrapped in a wall-clock timeout and retried a few
 * times on transient errors; if it still fails, control falls through to the
 * next attempt. Only when every attempt is exhausted does it throw — and then
 * with the full trail of what was tried.
 *
 * This is deliberately model-agnostic: it operates on thunks, so the runtime can
 * hand it real Mastra agent calls and tests can hand it fakes.
 */

export interface FailoverAttempt<T> {
  /** Diagnostic label, e.g. "anthropic/claude-sonnet-4-5". */
  label: string;
  /** Runs the attempt. The signal aborts when the per-attempt timeout trips. */
  run: (signal: AbortSignal) => Promise<T>;
}

export interface FailoverErrorInfo {
  label: string;
  /** 0-based index of the attempt in the chain. */
  attempt: number;
  /** 0-based retry counter within the attempt (0 = first try). */
  retry: number;
  error: unknown;
}

export interface FailoverOptions {
  /** Per-attempt wall-clock timeout in ms. 0 or undefined disables it. */
  timeoutMs?: number;
  /** Transient retries within a single attempt before moving on. Default 1. */
  retriesPerAttempt?: number;
  /** Base backoff between transient retries; grows exponentially. Default 250ms. */
  retryDelayMs?: number;
  /** Classifies an error as transient (retryable within the same attempt). */
  isRetryable?: (err: unknown) => boolean;
  /** Observability hook fired on every failed try. */
  onError?: (info: FailoverErrorInfo) => void;
  /** Injectable sleep, for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Raised when every attempt (and its retries) has failed. */
export class FailoverError extends Error {
  readonly attempts: ReadonlyArray<{ label: string; error: unknown }>;

  constructor(attempts: ReadonlyArray<{ label: string; error: unknown }>) {
    const summary = attempts
      .map((a) => `${a.label}: ${a.error instanceof Error ? a.error.message : String(a.error)}`)
      .join('; ');
    super(`all ${attempts.length} failover attempt(s) failed — ${summary}`);
    this.name = 'FailoverError';
    this.attempts = attempts;
  }
}

const TRANSIENT_PATTERNS = [
  /timed out/i,
  /timeout/i,
  /\baborted\b/i,
  /\becONNRESET\b/i,
  /\beconnreset\b/i,
  /\benotfound\b/i,
  /\betimedout\b/i,
  /network/i,
  /fetch failed/i,
  /socket hang up/i,
  /\b429\b/,
  /rate.?limit/i,
  /too many requests/i,
  /\b5\d\d\b/,
  /overloaded/i,
  /service unavailable/i,
  /internal server error/i,
];

/**
 * Default transient-error classifier: network blips, timeouts, rate limits and
 * 5xx are retryable; everything else (bad request, auth, schema errors) is not,
 * because retrying it just burns budget.
 */
export function isTransientError(err: unknown): boolean {
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status === 'number') {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  const message = err instanceof Error ? err.message : String(err ?? '');
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return run(new AbortController().signal);
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`attempt timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs the attempts in order until one resolves. Each attempt gets a timeout and
 * up to `retriesPerAttempt` transient retries with exponential backoff before
 * the chain advances. Throws {@link FailoverError} if all attempts fail.
 */
export async function runWithFailover<T>(
  attempts: ReadonlyArray<FailoverAttempt<T>>,
  options: FailoverOptions = {},
): Promise<T> {
  if (attempts.length === 0) {
    throw new Error('runWithFailover requires at least one attempt');
  }

  const retriesPerAttempt = Math.max(0, options.retriesPerAttempt ?? 1);
  const retryDelayMs = options.retryDelayMs ?? 250;
  const isRetryable = options.isRetryable ?? isTransientError;
  const sleep = options.sleep ?? defaultSleep;
  const failures: Array<{ label: string; error: unknown }> = [];

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i]!;
    let lastError: unknown;

    for (let retry = 0; retry <= retriesPerAttempt; retry++) {
      try {
        return await withTimeout(options.timeoutMs ?? 0, attempt.run);
      } catch (err) {
        lastError = err;
        options.onError?.({ label: attempt.label, attempt: i, retry, error: err });
        const canRetryHere = retry < retriesPerAttempt && isRetryable(err);
        if (!canRetryHere) break;
        await sleep(retryDelayMs * 2 ** retry);
      }
    }

    failures.push({ label: attempt.label, error: lastError });
  }

  throw new FailoverError(failures);
}
