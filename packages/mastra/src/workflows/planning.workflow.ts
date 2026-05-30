import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { HelmrPlanSchema, type HelmrEvent, type HelmrPlan } from '../../../shared/src/index.js';
import { councilAgent } from '../agents/council.agent.js';

const planningInputSchema = z.object({
  event: z.object({
    id: z.string(),
    payload: z.object({ text: z.string() }),
    workspace: z.object({ id: z.string(), path: z.string() }),
    principal: z.object({
      id: z.string(),
      type: z.string(),
      trustLevel: z.string(),
    }),
  }),
  jobId: z.string(),
});

const planningOutputSchema = z.object({
  plan: HelmrPlanSchema,
  rawText: z.string(),
});

const createPlanStep = createStep({
  id: 'create_plan',
  description: 'Use the Council agent to produce a typed HelmrPlan for the given event.',
  inputSchema: planningInputSchema,
  outputSchema: planningOutputSchema,
  execute: async ({ inputData }) => {
    const { event, jobId } = inputData;

    const prompt = buildPlanningPrompt(event as HelmrEvent, jobId);

    const result = await councilAgent.generate(
      [{ role: 'user', content: prompt }],
      {
        structuredOutput: {
          schema: HelmrPlanSchema,
        },
      },
    );

    const plan = result.object as HelmrPlan;

    return {
      plan,
      rawText: result.text ?? '',
    };
  },
});

export const planningWorkflow = createWorkflow({
  id: 'planning',
  description: 'Runs the Council agent to decompose a HelmrEvent into a typed HelmrPlan.',
  inputSchema: planningInputSchema,
  outputSchema: planningOutputSchema,
});

planningWorkflow.then(createPlanStep).commit();

function buildPlanningPrompt(event: HelmrEvent, jobId: string): string {
  return `You are planning a job for Helmr.

Job ID: ${jobId}
Workspace path: ${event.workspace.path}
User request: ${event.payload.text}

Instructions:
1. First use the read_workspace tool to inspect the workspace file structure.
2. Read any relevant files needed to understand the context.
3. Then produce a structured plan as a JSON object matching the HelmrPlan schema.

The plan must have:
- id: "plan_${jobId}"
- jobId: "${jobId}"
- summary: one-sentence description of what will be done
- risk: "low" (for read-only work) | "medium" | "high"
- requiresApproval: false for read-only, true for any write/install
- steps: array of PlanStep objects

For a workspace summarization request, the plan should be read-only with a single step using workspace_read capability.

Produce the plan now.`;
}
