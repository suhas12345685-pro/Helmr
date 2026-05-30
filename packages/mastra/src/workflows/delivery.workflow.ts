import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { fastAgent } from '../agents/fast.agent.js';

const deliveryInputSchema = z.object({
  jobId: z.string(),
  rawResult: z.string(),
  requestText: z.string(),
  workspacePath: z.string(),
});

const deliveryOutputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  fullResult: z.string(),
  nextSteps: z.array(z.string()),
});

const synthesizeStep = createStep({
  id: 'synthesize_delivery',
  description: 'Synthesize raw agent output into a clean, structured delivery for the user.',
  inputSchema: deliveryInputSchema,
  outputSchema: deliveryOutputSchema,
  execute: async ({ inputData }) => {
    const prompt = `Synthesize this job result into a clean delivery.

Original request: "${inputData.requestText}"
Job ID: ${inputData.jobId}

Raw result:
${inputData.rawResult.slice(0, 4000)}

Return a JSON object with:
- title: short title for this result (under 60 chars)
- summary: 2-3 sentence summary of what was done and what was found
- fullResult: the polished full result (clean markdown, well formatted)
- nextSteps: array of 2-4 concrete next action items`;

    const result = await fastAgent.generate(
      [{ role: 'user', content: prompt }],
      { structuredOutput: { schema: deliveryOutputSchema } },
    );

    return result.object as z.infer<typeof deliveryOutputSchema>;
  },
});

export const deliveryWorkflow = createWorkflow({
  id: 'delivery',
  description: 'Synthesizes raw agent output into a polished delivery with title, summary, and next steps.',
  inputSchema: deliveryInputSchema,
  outputSchema: deliveryOutputSchema,
});

deliveryWorkflow.then(synthesizeStep).commit();
