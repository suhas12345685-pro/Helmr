import { runWithFailover, type FailoverOptions } from '../../router/src/failover.js';

/**
 * Resilient LLM generation: wraps Mastra agent `.generate` calls with the
 * provider-failover primitive so a timeout, rate-limit or transient provider
 * fault retries and, if configured, fails over to an alternate model — instead
 * of sinking the job. It also surfaces the winning call's token `usage` so the
 * runtime can convert it to USD and feed the budget ledger.
 *
 * It is model-agnostic: callers pass an ordered list of agents (primary first,
 * fallbacks after) plus the shared messages/options.
 */

export type GenMessage = { role: 'user' | 'system' | 'assistant'; content: string };

export interface MastraGenerateResult {
  text?: string;
  object?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
  [key: string]: unknown;
}

export interface GenerateAgent {
  generate(messages: GenMessage[], options?: unknown): Promise<MastraGenerateResult>;
}

export interface AgentAttempt {
  label: string;
  agent: GenerateAgent;
}

export interface ResilientGenerateOptions extends FailoverOptions {
  /** Fired with the winning attempt's model label and token usage. */
  onUsage?: (info: { label: string; usage: MastraGenerateResult['usage'] }) => void;
}

const DEFAULT_LLM_TIMEOUT_MS = 60_000;

/** Per-attempt LLM timeout, overridable via `HELMR_LLM_TIMEOUT_MS`. */
export function llmTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env['HELMR_LLM_TIMEOUT_MS'];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LLM_TIMEOUT_MS;
}

/**
 * Run `.generate` across an ordered list of agents with timeout + retry +
 * cross-model failover. Returns the first successful result; throws a
 * `FailoverError` only if every agent (and its retries) fails.
 */
export async function generateWithFailover(
  attempts: ReadonlyArray<AgentAttempt>,
  messages: GenMessage[],
  genOptions?: unknown,
  options: ResilientGenerateOptions = {},
): Promise<MastraGenerateResult> {
  const { onUsage, ...failover } = options;
  return runWithFailover(
    attempts.map((attempt) => ({
      label: attempt.label,
      run: async () => {
        const result = await attempt.agent.generate(messages, genOptions);
        onUsage?.({ label: attempt.label, usage: result.usage });
        return result;
      },
    })),
    { timeoutMs: llmTimeoutMs(), retriesPerAttempt: 1, ...failover },
  );
}
