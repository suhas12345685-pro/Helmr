import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { HelmrPlan, PlanStep, SwarmTask } from '../packages/shared/src/index.js';
import type { HelmrSQLiteStore } from '../packages/memory/src/sqlite-store.js';
import { councilAgent } from '../packages/mastra/src/agents/council.agent.js';
import { researchAgent } from '../packages/mastra/src/agents/research.agent.js';
import { shouldUseLocalAgentFallback } from './local-agent.js';

const MAX_SUBTASKS = 5;
const DEFAULT_CONCURRENCY = 4;

/** Words that signal a broad, information-gathering ("research") intent. */
const RESEARCH_SIGNAL =
  /\b(research|investigate|compare|comparison|survey|analy[sz]e|explore|gather|deep[- ]?dive|landscape|overview of|state of|pros and cons|trade[- ]?offs?|alternatives?|options?|evaluate|assess)\b/i;

/** Words that signal a code-writing intent — these should NOT fan out to a read-only swarm. */
const CODING_SIGNAL =
  /\b(implement|fix|refactor|rename|delete|write (?:the )?code|create (?:a |the )?(?:file|function|class|component|module)|add (?:a |the )?(?:function|class|test|endpoint|method)|patch|migrate|install|deploy|commit)\b/i;

export function looksLikeCodingRequest(text: string): boolean {
  return CODING_SIGNAL.test(text);
}

/**
 * Decide whether a request is a wide, parallelizable research task that benefits
 * from fanning out into a swarm. True when the request reads like research AND
 * decomposes into two or more independent subtasks, or when it is an explicit
 * enumeration/list of things to look into.
 */
export function looksLikeParallelResearch(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || looksLikeCodingRequest(trimmed)) return false;

  const explicit = extractExplicitItems(trimmed);
  if (explicit.length >= 2) return true;

  return RESEARCH_SIGNAL.test(trimmed) && decomposeRequest(trimmed).length >= 2;
}

/**
 * Break a request into independent subtasks. Prefers explicit structure
 * (bullet/numbered lines, semicolons, comma/"and" enumerations); otherwise, for
 * a broad research question, fans out into standard complementary angles. Falls
 * back to the request itself when it cannot be meaningfully split.
 */
export function decomposeRequest(text: string, maxTasks = MAX_SUBTASKS): string[] {
  const trimmed = text.trim();

  const explicit = extractExplicitItems(trimmed);
  if (explicit.length >= 2) {
    return dedupe(explicit).slice(0, maxTasks);
  }

  if (RESEARCH_SIGNAL.test(trimmed)) {
    return [
      `Overview and key facts about: ${trimmed}`,
      `Comparisons, alternatives, and trade-offs relevant to: ${trimmed}`,
      `Practical recommendations and concrete next steps for: ${trimmed}`,
    ];
  }

  return [trimmed];
}

const SubtaskDecompositionSchema = z.object({
  subtasks: z.array(z.string().min(1)).min(1).max(MAX_SUBTASKS),
});

/**
 * Resolve the subtasks for a request. When a model provider is configured, ask
 * the council to decompose the request into independent, parallelizable research
 * subtasks; fall back to the deterministic heuristic on any error, an empty/thin
 * result, or when running locally without a provider.
 */
export async function resolveSubtasks(request: string, maxTasks = MAX_SUBTASKS): Promise<string[]> {
  const heuristic = decomposeRequest(request, maxTasks);
  if (shouldUseLocalAgentFallback()) return heuristic;

  try {
    const llm = await llmDecompose(request, maxTasks);
    const cleaned = dedupe(llm.map((item) => item.trim()).filter(Boolean)).slice(0, maxTasks);
    // Only trust the LLM when it produced a genuine fan-out; otherwise keep the
    // heuristic so a single vague subtask never replaces a useful decomposition.
    return cleaned.length >= 2 ? cleaned : heuristic;
  } catch {
    return heuristic;
  }
}

async function llmDecompose(request: string, maxTasks: number): Promise<string[]> {
  const prompt = `Break the following request into independent research subtasks that can run in parallel.

Request: "${request}"

Rules:
- Produce between 2 and ${maxTasks} subtasks (fewer is fine if the request is narrow).
- Each subtask must be a self-contained instruction that a research worker can act on alone.
- Subtasks must not depend on each other's output and must not overlap.
- Do not include synthesis or "combine the results" as a subtask.`;

  const result = await councilAgent.generate([{ role: 'user', content: prompt }], {
    structuredOutput: { schema: SubtaskDecompositionSchema },
  });

  const parsed = result.object as { subtasks?: unknown } | undefined;
  return Array.isArray(parsed?.subtasks)
    ? parsed.subtasks.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Build a low-risk, read-only plan that mirrors the swarm subtasks for the Hatchery view. */
export function createSwarmPlan(jobId: string, request: string, subtasks: string[]): HelmrPlan {
  const steps: PlanStep[] = subtasks.map((subtask, index) => ({
    id: `swarm_task_${index + 1}`,
    title: truncate(subtask, 120),
    kind: 'read',
    agent: 'research',
    canRunInParallelWith: subtasks
      .map((_, otherIndex) => `swarm_task_${otherIndex + 1}`)
      .filter((id) => id !== `swarm_task_${index + 1}`),
    requiredCapabilities: ['workspace_read'],
  }));

  return {
    id: `plan_${jobId}`,
    jobId,
    summary: `Research swarm: fan out into ${subtasks.length} parallel subtasks and synthesize.`,
    risk: 'low',
    requiresApproval: false,
    steps,
  };
}

export interface OrchestrateSwarmOptions {
  jobId: string;
  workspacePath: string;
  store: HelmrSQLiteStore;
  /** Concurrency limit for parallel subtasks. */
  concurrency?: number;
  log?: (message: string) => void;
  /** Kill-switch hook: when it returns true, remaining subtasks are skipped. */
  shouldHalt?: () => boolean | Promise<boolean>;
}

export interface SwarmRunResult {
  swarmId: string;
  answer: string;
  taskCount: number;
  succeeded: number;
  failed: number;
}

/**
 * Execute a persisted swarm: run each subtask concurrently (research agent when a
 * model is configured, deterministic local synthesis otherwise), persist every
 * task transition to SQLite, then synthesize a single answer. State lives in the
 * store, so a separate Hatchery process observes progress as it happens.
 */
export async function orchestrateSwarm(options: OrchestrateSwarmOptions): Promise<SwarmRunResult> {
  const { jobId, workspacePath, store } = options;
  const log = (msg: string): void => options.log?.(msg);

  const swarm = await store.getSwarmByJob(jobId);
  if (!swarm) {
    throw new Error(`no swarm registered for job ${jobId}`);
  }

  const subtasks = swarm.subtasks;
  log(`Swarm fanning out into ${subtasks.length} parallel subtask(s)...`);
  await store.updateSwarmStatus(swarm.id, 'running');

  const now = new Date().toISOString();
  const tasks: SwarmTask[] = subtasks.map((subtask, index) => ({
    id: `${swarm.id}_t${index + 1}`,
    swarmId: swarm.id,
    title: truncate(subtask, 120),
    prompt: subtask,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  }));
  for (const task of tasks) {
    await store.saveSwarmTask(task);
  }

  const useLocal = shouldUseLocalAgentFallback();
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  let succeeded = 0;
  let failed = 0;

  const runTask = async (task: SwarmTask): Promise<void> => {
    if (options.shouldHalt && (await options.shouldHalt())) {
      await store.updateSwarmTask(task.id, { status: 'failed', error: 'halted by kill-switch' });
      task.error = 'halted by kill-switch';
      task.status = 'failed';
      failed += 1;
      log(`Swarm task skipped (kill-switch engaged): ${task.title}`);
      return;
    }
    log(`Swarm task running: ${task.title}`);
    await store.updateSwarmTask(task.id, { status: 'running' });
    try {
      const output = useLocal
        ? synthesizeLocalSwarmTask(task.prompt, swarm.request, workspacePath)
        : await runResearchSubtask(task.prompt, swarm.request, workspacePath);
      await store.updateSwarmTask(task.id, { status: 'succeeded', output });
      task.output = output;
      task.status = 'succeeded';
      succeeded += 1;
      log(`Swarm task succeeded: ${task.title}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.updateSwarmTask(task.id, { status: 'failed', error: message });
      task.error = message;
      task.status = 'failed';
      failed += 1;
      log(`Swarm task failed: ${task.title} — ${message}`);
    }
  };

  await runPool(tasks, concurrency, runTask);

  log('Synthesizing swarm results...');
  const answer = useLocal
    ? synthesizeLocalSwarmAnswer(swarm.request, tasks)
    : await synthesizeSwarmAnswer(swarm.request, tasks);

  await store.updateSwarmStatus(swarm.id, failed > 0 && succeeded === 0 ? 'failed' : 'succeeded', answer);

  return { swarmId: swarm.id, answer, taskCount: tasks.length, succeeded, failed };
}

async function runResearchSubtask(prompt: string, request: string, workspacePath: string): Promise<string> {
  const fullPrompt = `You are one worker in a research swarm answering a larger request.

Overall request: "${request}"
Workspace path: ${workspacePath}

Your focused subtask: ${prompt}

Investigate this subtask using the tools available to you and return a concise, well-organized findings report for just this subtask. Do not attempt the other subtasks.`;

  const result = await researchAgent.generate([{ role: 'user', content: fullPrompt }]);
  return result.text ?? '';
}

async function synthesizeSwarmAnswer(request: string, tasks: SwarmTask[]): Promise<string> {
  const sections = tasks
    .map((task) => `### ${task.title}\nStatus: ${task.status}\n${task.output ?? task.error ?? '(no output)'}`)
    .join('\n\n');

  const prompt = `You coordinated a research swarm for this request:
"${request}"

Here are the findings from each parallel subtask:

${sections}

Synthesize these into a single coherent, well-structured answer to the original request. Note any subtasks that failed and what is still unknown.`;

  try {
    const result = await researchAgent.generate([{ role: 'user', content: prompt }]);
    return result.text ?? synthesizeLocalSwarmAnswer(request, tasks);
  } catch {
    return synthesizeLocalSwarmAnswer(request, tasks);
  }
}

function synthesizeLocalSwarmTask(prompt: string, request: string, workspacePath: string): string {
  return [
    `Subtask: ${prompt}`,
    `Part of request: ${request}`,
    `Workspace: ${workspacePath}`,
    '',
    'No model provider is configured, so this subtask was recorded but not researched.',
    'Configure a provider key (e.g. ANTHROPIC_API_KEY) to enable live swarm research.',
  ].join('\n');
}

function synthesizeLocalSwarmAnswer(request: string, tasks: SwarmTask[]): string {
  const succeeded = tasks.filter((t) => t.status === 'succeeded');
  const failed = tasks.filter((t) => t.status === 'failed');

  const lines = [
    '# Research Swarm Results',
    '',
    `Request: ${request}`,
    `Subtasks: ${tasks.length} (${succeeded.length} completed, ${failed.length} failed)`,
    '',
    '## Subtasks',
    '',
  ];

  for (const task of tasks) {
    lines.push(`### ${task.title}`);
    lines.push(`Status: ${task.status}`);
    lines.push(task.output ?? task.error ?? '(no output)');
    lines.push('');
  }

  lines.push('## Synthesis');
  lines.push('');
  lines.push(
    'These subtasks ran in parallel and their state is persisted for the Hatchery view. ' +
      'Configure a model provider to turn the recorded subtasks into live, synthesized research.',
  );

  return lines.join('\n');
}

// --- helpers ---

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

function extractExplicitItems(text: string): string[] {
  // 1. Multi-line bullet / numbered lists. Drop lead-in header lines ("research:").
  const lineItems = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''))
    .filter((line) => !/:\s*$/.test(line.trim()))
    .map((line) => cleanItem(line))
    .filter(Boolean);
  if (lineItems.length >= 2) return lineItems;

  // 2. Semicolon-separated clauses.
  const semiItems = text
    .split(/;\s*/)
    .map((part) => cleanItem(part))
    .filter(Boolean);
  if (semiItems.length >= 2) return semiItems;

  // 3. Comma / "and" / "or" / "vs" enumerations — only when the parts look
  //    like short list items rather than prose.
  if (/,|\bvs\.?\b|\bversus\b/i.test(text)) {
    const enumerated = text
      .replace(/\s+(?:and|or)\s+/gi, ', ')
      .replace(/\s+vs\.?\s+|\s+versus\s+/gi, ', ')
      .split(/\s*,\s*/)
      .map((part) => cleanItem(part))
      .filter(Boolean);
    if (enumerated.length >= 2 && enumerated.every((item) => item.split(/\s+/).length <= 8)) {
      return enumerated;
    }
  }

  return [];
}

function cleanItem(item: string): string {
  return item
    .trim()
    .replace(/^(?:please|can you|could you|i want to|i'd like to|help me|let's)\s+/i, '')
    .replace(/^(?:research|investigate|compare|analy[sz]e|explore|look into|find out about)\s+/i, '')
    .replace(/[.?!:]+$/, '')
    .trim();
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
