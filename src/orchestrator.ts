import {
  runAgentLoop,
  type AgentBody,
  type AgentDecider,
  type BrainContext,
  type MultiAgentRuntime,
  type PermissionZone,
} from '../packages/embodiment/src/index.js';
import { getAgentRuntime } from './agent-runtime.js';

/**
 * The embodied-swarm orchestrator.
 *
 * Given a set of subtasks, it spawns one isolated agent per subtask, runs each
 * agent's perception -> decision -> action brain loop in parallel, records
 * everything to the shared runtime's ledger, and merges the results into one
 * answer. The Operator's real machine is never touched; each agent works in its
 * own body.
 */

export interface SwarmSubtask {
  role: string;
  task: string;
  startUrl?: string;
  permissions?: PermissionZone[];
}

export interface OrchestrateSwarmOptions {
  subtasks: SwarmSubtask[];
  runtime?: MultiAgentRuntime;
  /** Build the decider (brain) for an agent. Defaults to a perceive-and-report decider. */
  deciderFor?: (body: AgentBody, task: string) => AgentDecider;
  maxSteps?: number;
  /** Keep agents alive after completion (for inspection). Default false. */
  keepAlive?: boolean;
  onProgress?: (message: string) => void;
}

export interface SwarmAgentResult {
  agentId: string;
  role: string;
  task: string;
  status: 'done' | 'failed' | 'max_steps';
  result?: unknown;
  error?: string;
}

export interface SwarmResult {
  results: SwarmAgentResult[];
  merged: string;
}

/**
 * A model-free default brain: perceive the workspace once and report what it
 * sees. Real deployments pass a Mastra-backed decider (createMastraDecider) so
 * the agents reason and act with an LLM.
 */
export function perceiveAndReportDecider(): AgentDecider {
  return {
    async decide(context: BrainContext) {
      const observed = (context.observation.visibleText ?? []).join(' | ');
      return {
        type: 'done',
        result: { appState: context.observation.appState, observed },
      };
    },
  };
}

export async function orchestrateSwarm(options: OrchestrateSwarmOptions): Promise<SwarmResult> {
  const runtime = options.runtime ?? getAgentRuntime();
  const deciderFor = options.deciderFor ?? (() => perceiveAndReportDecider());
  const maxSteps = options.maxSteps ?? 8;
  const log = options.onProgress ?? (() => {});

  const bodies = await runtime.spawnAgents(
    options.subtasks.map((sub) => ({
      role: sub.role,
      startUrl: sub.startUrl,
      permissions:
        sub.permissions ??
        (sub.startUrl
          ? ['read_only', 'workspace_only', 'browser_safe']
          : ['read_only', 'workspace_only']),
    })),
  );
  log(`Spawned ${bodies.length} embodied agent(s)`);

  const results: SwarmAgentResult[] = await Promise.all(
    bodies.map(async (body, i) => {
      const sub = options.subtasks[i]!;
      runtime.assignTask(body.agentId, { description: sub.task });
      log(`[${sub.role}] working: ${sub.task}`);
      const loop = await runAgentLoop(body, {
        task: sub.task,
        decider: deciderFor(body, sub.task),
        maxSteps,
      });
      if (loop.status === 'done') {
        runtime.completeTask(body.agentId, loop.result);
      } else {
        runtime.failTask(body.agentId, loop.error ?? loop.status);
      }
      log(`[${sub.role}] ${loop.status}`);
      return {
        agentId: body.agentId,
        role: sub.role,
        task: sub.task,
        status: loop.status,
        result: loop.result,
        error: loop.error,
      };
    }),
  );

  if (!options.keepAlive) {
    await Promise.all(bodies.map((body) => runtime.stopAgent(body.agentId)));
  }

  return { results, merged: mergeResults(results) };
}

function mergeResults(results: SwarmAgentResult[]): string {
  return results
    .map((r) => {
      const body = r.error ? `Error: ${r.error}` : JSON.stringify(r.result);
      return `## ${r.role} — ${r.status}\nTask: ${r.task}\n${body}`;
    })
    .join('\n\n');
}

/** Cheap heuristic: does this request read like several parallel research targets? */
export function looksLikeParallelResearch(text: string): boolean {
  const lower = text.toLowerCase();
  const hasResearchVerb = /(research|compare|check|gather|scan|find|review)\b/.test(lower);
  const conjunctions = (lower.match(/,|\band\b|\bthen\b/g) ?? []).length;
  return hasResearchVerb && conjunctions >= 2;
}
