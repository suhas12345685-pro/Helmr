import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { HelmrEventSchema } from '../../../shared/src/index.js';

const intakeInputSchema = z.object({
  rawText: z.string(),
  workspacePath: z.string(),
  source: z.enum(['cli', 'webhook', 'chat', 'cron', 'heartbeat', 'api']).default('cli'),
  principalId: z.string().default('local-owner'),
});

const intakeOutputSchema = z.object({
  event: HelmrEventSchema,
  jobId: z.string(),
});

const normalizeEventStep = createStep({
  id: 'normalize_event',
  description: 'Normalize raw input into a typed HelmrEvent.',
  inputSchema: intakeInputSchema,
  outputSchema: intakeOutputSchema,
  execute: async ({ inputData }) => {
    const { randomUUID } = await import('node:crypto');
    const { normalizeCliEvent } = await import('../../../gateway/src/normalize-event.js');

    const event = normalizeCliEvent({
      text: inputData.rawText,
      workspacePath: inputData.workspacePath,
      principalId: inputData.principalId,
    });

    const jobId = `job_${randomUUID()}`;

    return { event, jobId };
  },
});

export const intakeWorkflow = createWorkflow({
  id: 'intake',
  description: 'Normalizes raw input into a typed HelmrEvent and assigns a job ID.',
  inputSchema: intakeInputSchema,
  outputSchema: intakeOutputSchema,
});

intakeWorkflow.then(normalizeEventStep).commit();
