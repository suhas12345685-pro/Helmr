import { z } from 'zod';

import type { AgentAction, AgentDecider, BrainContext } from '../../../embodiment/src/index.js';
import { buildSoulContext } from '../../../../src/soul.js';

/**
 * A Mastra/LLM-backed decider for the embodied agent loop.
 *
 * It turns a live VisualObservation + the task + recent history into the next
 * AgentAction, using a Mastra agent with structured output. The embodiment loop
 * stays model-agnostic; this is the bridge that plugs an LLM brain into a body.
 *
 * The agent is accepted structurally (DecidingAgent) so it can be a real Mastra
 * Agent or a fake in tests — no hard dependency on a live model here.
 */

export const AgentActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('observe') }),
  z.object({ type: z.literal('focus'), target: z.string() }),
  z.object({ type: z.literal('type'), target: z.string().optional(), text: z.string() }),
  z.object({ type: z.literal('press'), key: z.string() }),
  z.object({ type: z.literal('shortcut'), keys: z.array(z.string()) }),
  z.object({ type: z.literal('click'), x: z.number().optional(), y: z.number().optional() }),
  z.object({ type: z.literal('scroll'), dx: z.number(), dy: z.number() }),
  z.object({ type: z.literal('hover'), x: z.number(), y: z.number() }),
  z.object({ type: z.literal('wait'), ms: z.number().optional() }),
  z.object({ type: z.literal('done'), result: z.unknown() }),
  z.object({ type: z.literal('fail'), error: z.string() }),
]);

export interface DecidingAgent {
  generate(
    messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>,
    options?: { structuredOutput?: { schema: unknown } },
  ): Promise<{ object?: unknown }>;
}

export interface MastraDeciderOptions {
  /** Include soul.md in the decision prompt. Default true. */
  includeSoul?: boolean;
}

export function createMastraDecider(
  agent: DecidingAgent,
  options: MastraDeciderOptions = {},
): AgentDecider {
  const includeSoul = options.includeSoul ?? true;
  return {
    async decide(context: BrainContext): Promise<AgentAction> {
      const prompt = buildDecisionPrompt(context, includeSoul);
      const result = await agent.generate([{ role: 'user', content: prompt }], {
        structuredOutput: { schema: AgentActionSchema },
      });
      const parsed = AgentActionSchema.safeParse(result.object);
      if (!parsed.success) {
        return { type: 'fail', error: `brain returned an invalid action: ${parsed.error.message}` };
      }
      return parsed.data as AgentAction;
    },
  };
}

export function buildDecisionPrompt(context: BrainContext, includeSoul: boolean): string {
  const soul = includeSoul ? buildSoulContext() : '';
  const obs = context.observation;
  const elements = (obs.uiElements ?? [])
    .slice(0, 40)
    .map((el) => `- ${el.role}${el.name ? ` "${el.name}"` : ''}${el.value ? ` = ${JSON.stringify(el.value)}` : ''}${el.focused ? ' [focused]' : ''}`)
    .join('\n');
  const recent = context.history.slice(-5).map((a) => `- ${a.type}`).join('\n') || '- (none yet)';

  return `${soul}You are an embodied Helmr agent ("${context.role}") operating your own isolated workspace.
Decide the single next action to make progress on the task. You see your workspace as structured UI, not pixels.

Task: ${context.task}
Step: ${context.step}
App state: ${obs.appState ?? 'unknown'}
${obs.changeSummary ? `Last change: ${obs.changeSummary}\n` : ''}Focused element: ${obs.focusedElement ? `${obs.focusedElement.role} "${obs.focusedElement.name ?? ''}"` : 'none'}

Visible UI elements:
${elements || '- (none)'}

Recent actions:
${recent}

Respond with ONE action object. Use "done" with a result when the task is complete,
or "fail" with an error if you are blocked. Act only inside your own workspace.`;
}
