import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { codingAgent } from '../agents/coding.agent.js';

const reviewInputSchema = z.object({
  jobId: z.string(),
  workspacePath: z.string(),
  changedFiles: z.array(z.string()),
  context: z.string(),
});

const reviewOutputSchema = z.object({
  approved: z.boolean(),
  findings: z.array(z.object({
    severity: z.enum(['error', 'warning', 'info']),
    file: z.string(),
    message: z.string(),
  })),
  summary: z.string(),
});

const codeReviewStep = createStep({
  id: 'code_review',
  description: 'Review changed files for correctness, security, and style.',
  inputSchema: reviewInputSchema,
  outputSchema: reviewOutputSchema,
  execute: async ({ inputData }) => {
    const { readWorkspaceFile } = await import('../../../hands/src/read-tools.js');

    const fileContents: string[] = [];
    for (const f of inputData.changedFiles.slice(0, 5)) {
      try {
        const content = await readWorkspaceFile(inputData.workspacePath, f);
        fileContents.push(`=== ${f} ===\n${content.slice(0, 3000)}`);
      } catch {
        fileContents.push(`=== ${f} === (could not read)`);
      }
    }

    const prompt = `Review these changed files for job ${inputData.jobId}.
Context: ${inputData.context}

${fileContents.join('\n\n')}

Return a JSON object with:
- approved: boolean (true if no blocking errors)
- findings: array of { severity, file, message }
- summary: one-sentence overall assessment`;

    const result = await codingAgent.generate(
      [{ role: 'user', content: prompt }],
      { structuredOutput: { schema: reviewOutputSchema } },
    );

    return result.object as z.infer<typeof reviewOutputSchema>;
  },
});

export const reviewWorkflow = createWorkflow({
  id: 'review',
  description: 'Reviews changed files for correctness, security, and style.',
  inputSchema: reviewInputSchema,
  outputSchema: reviewOutputSchema,
});

reviewWorkflow.then(codeReviewStep).commit();
