import { Agent } from '@mastra/core/agent';

import { createCouncilAgent, councilAgent, councilModel } from './agents/council.agent.js';
import { createResearchAgent, researchAgent, researchModel } from './agents/research.agent.js';
import { createCodingAgent, codingAgent, codingModel } from './agents/coding.agent.js';
import type { AgentAttempt } from './resilience.js';

/**
 * Failover chains for the three runtime agents.
 *
 * The primary is the configured agent; fallbacks are alternate models from
 * `HELMR_FALLBACK_MODELS` (a comma-separated list of `provider/model` ids). They
 * are built once and cached, so a chain is cheap to request per call. When no
 * fallbacks are configured the chain is just the primary — failover then still
 * gives timeout + transient-retry resilience, just no cross-model hop.
 */

export function parseFallbackModels(env: Record<string, string | undefined> = process.env): string[] {
  return (env['HELMR_FALLBACK_MODELS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

type Factory = (model: string) => Agent;

const cache = new Map<string, Agent>();

function fallbackAttempts(factory: Factory, primaryModel: string): AgentAttempt[] {
  return parseFallbackModels()
    // Never duplicate the primary model in the fallback chain.
    .filter((model) => model !== primaryModel)
    .map((model) => {
      const key = `${factory.name}:${model}`;
      let agent = cache.get(key);
      if (!agent) {
        agent = factory(model);
        cache.set(key, agent);
      }
      return { label: model, agent: agent as unknown as AgentAttempt['agent'] };
    });
}

export function councilAgentChain(): AgentAttempt[] {
  return [
    { label: councilModel, agent: councilAgent as unknown as AgentAttempt['agent'] },
    ...fallbackAttempts(createCouncilAgent, councilModel),
  ];
}

export function researchAgentChain(): AgentAttempt[] {
  return [
    { label: researchModel, agent: researchAgent as unknown as AgentAttempt['agent'] },
    ...fallbackAttempts(createResearchAgent, researchModel),
  ];
}

export function codingAgentChain(): AgentAttempt[] {
  return [
    { label: codingModel, agent: codingAgent as unknown as AgentAttempt['agent'] },
    ...fallbackAttempts(createCodingAgent, codingModel),
  ];
}

/** Reset the fallback-agent cache (test helper). */
export function resetAgentChainCache(): void {
  cache.clear();
}
