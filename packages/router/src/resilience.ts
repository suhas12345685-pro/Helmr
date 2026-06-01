import type { ModelRoute } from './routing-config.js';

/**
 * Provider resilience (Phase 2 of the autonomy roadmap). Full autonomy is only
 * as reliable as the brain behind it: a single provider timeout or outage must
 * not strand a job. runWithFailover retries each route a bounded number of times
 * with backoff, then falls over to the next route in the chain, so the agent
 * degrades to a still-capable path rather than collapsing (soul.md: "I degrade
 * safely").
 */
export interface FailoverOptions {
  retriesPerRoute?: number;
  backoffMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onAttempt?: (info: { route: ModelRoute; attempt: number; error?: unknown }) => void;
  /** Injectable for tests; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export interface FailoverResult<T> {
  result: T;
  route: ModelRoute;
  attempts: number;
}

export class AllRoutesFailedError extends Error {
  constructor(
    readonly routes: ModelRoute[],
    readonly lastError: unknown,
  ) {
    super(
      `all ${routes.length} model route(s) failed; last error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
    this.name = 'AllRoutesFailedError';
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `attempt` against each route in order. Each route is tried up to
 * `retriesPerRoute + 1` times with exponential backoff before falling over to
 * the next route. Throws AllRoutesFailedError if every route is exhausted.
 */
export async function runWithFailover<T>(
  routes: ModelRoute[],
  attempt: (route: ModelRoute, attemptNumber: number) => Promise<T>,
  options: FailoverOptions = {},
): Promise<FailoverResult<T>> {
  if (routes.length === 0) {
    throw new Error('runWithFailover requires at least one route');
  }
  const retriesPerRoute = options.retriesPerRoute ?? 2;
  const backoffMs = options.backoffMs ?? 250;
  const isRetryable = options.isRetryable ?? (() => true);
  const sleep = options.sleep ?? defaultSleep;

  let totalAttempts = 0;
  let lastError: unknown;

  for (const route of routes) {
    for (let tryIndex = 0; tryIndex <= retriesPerRoute; tryIndex++) {
      totalAttempts++;
      try {
        const result = await attempt(route, totalAttempts);
        return { result, route, attempts: totalAttempts };
      } catch (err) {
        lastError = err;
        options.onAttempt?.({ route, attempt: totalAttempts, error: err });
        const moreTriesOnThisRoute = tryIndex < retriesPerRoute;
        if (!isRetryable(err)) break; // non-retryable: fail over to the next route
        if (moreTriesOnThisRoute) await sleep(backoffMs * 2 ** tryIndex);
      }
    }
  }

  throw new AllRoutesFailedError(routes, lastError);
}
