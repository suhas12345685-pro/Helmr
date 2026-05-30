import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { HelmrPlanSchema } from '../../../shared/src/index.js';
import { evaluatePlan } from '../../../cortex/src/policy.js';
import { summarizeWorkspace } from '../../../hands/src/read-tools.js';
import { researchAgent } from '../agents/research.agent.js';

const executionInputSchema = z.object({
  plan: HelmrPlanSchema,
  workspacePath: z.string(),
  originalRequest: z.string(),
});

const executionOutputSchema = z.object({
  result: z.string(),
  approved: z.boolean(),
  deniedReasons: z.array(z.string()),
});

const policyCheckStep = createStep({
  id: 'policy_check',
  description: 'Evaluate the plan through the Cortex policy engine.',
  inputSchema: executionInputSchema,
  outputSchema: z.object({
    plan: HelmrPlanSchema,
    workspacePath: z.string(),
    originalRequest: z.string(),
    allowed: z.boolean(),
    requiresApproval: z.boolean(),
    reasons: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    const decision = evaluatePlan(inputData.plan);
    return {
      ...inputData,
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      reasons: decision.reasons,
    };
  },
});

const executeReadStepsStep = createStep({
  id: 'execute_read_steps',
  description: 'Execute approved read-only steps using the Research agent.',
  inputSchema: z.object({
    plan: HelmrPlanSchema,
    workspacePath: z.string(),
    originalRequest: z.string(),
    allowed: z.boolean(),
    requiresApproval: z.boolean(),
    reasons: z.array(z.string()),
  }),
  outputSchema: executionOutputSchema,
  execute: async ({ inputData }) => {
    if (inputData.requiresApproval) {
      return {
        result: '',
        approved: false,
        deniedReasons: inputData.reasons,
      };
    }

    const summary = await summarizeWorkspace(inputData.workspacePath);

    const prompt = `The user asked: "${inputData.originalRequest}"

Workspace root: ${inputData.workspacePath}
Files in workspace (${summary.files.length} total):
${summary.files.slice(0, 50).join('\n')}
${summary.files.length > 50 ? `... and ${summary.files.length - 50} more files` : ''}

Plan summary: ${inputData.plan.summary}

Please analyze the workspace and provide a thorough answer to the user's request.
Include: what the project is, its current state, key files and their purposes, and concrete next development steps.`;

    const result = await researchAgent.generate([{ role: 'user', content: prompt }]);

    return {
      result: result.text ?? '',
      approved: true,
      deniedReasons: [],
    };
  },
});

export const executionWorkflow = createWorkflow({
  id: 'execution',
  description: 'Evaluates a plan through Cortex and executes approved read-only steps.',
  inputSchema: executionInputSchema,
  outputSchema: executionOutputSchema,
});

executionWorkflow.then(policyCheckStep).then(executeReadStepsStep).commit();
