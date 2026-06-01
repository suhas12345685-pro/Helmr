import { createTool } from '@mastra/core/tools';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

import { CapabilitySchema, isApprovalGatedCapability, type ToolReceipt } from '../../../shared/src/index.js';
import { hasStandingApproval, getSkillAutonomy } from '../../../cortex/src/policy.js';
import { HelmrSQLiteStore } from '../../../memory/src/sqlite-store.js';
import { getHelmrPaths } from '../../../../src/paths.js';

export const requestReceiptTool = createTool({
  id: 'request_receipt',
  description:
    'Create a structured tool receipt for a requested operation. The receipt must be validated by the Cortex before execution. Use this when you need to propose a tool execution.',
  inputSchema: z.object({
    jobId: z.string().describe('The job this receipt belongs to'),
    stepId: z.string().describe('The plan step that is requesting the tool'),
    tool: z.string().describe('The tool name being requested'),
    capability: CapabilitySchema.describe('The capability required for this tool call'),
    input: z.unknown().describe('The input data for the tool call'),
    risk: z.enum(['low', 'medium', 'high']).describe('Risk level of this operation'),
  }),
  execute: async (input): Promise<ToolReceipt> => {
    const store = new HelmrSQLiteStore(join(getHelmrPaths().dataDir, 'helmr.db'));
    await store.init();

    const job = await store.getJob(input.jobId);
    if (!job) {
      throw new Error(`Job ${input.jobId} not found`);
    }
    const workspacePath = job.workspacePath ?? process.cwd();

    const isGated = isApprovalGatedCapability(input.capability);

    if (!isGated) {
      const receipt: ToolReceipt = {
        id: `receipt_${randomUUID()}`,
        jobId: input.jobId,
        stepId: input.stepId,
        tool: input.tool,
        capability: input.capability,
        input: input.input,
        risk: input.risk,
        approval: 'not_required',
        createdAt: new Date().toISOString(),
      };
      await store.saveReceipt(receipt);

      const { executeReceipt } = await import('../../../hands/src/executor.js');
      const result = await executeReceipt(receipt, workspacePath);
      await store.saveResult(result);
      if (result.status === 'failed') {
        throw new Error(result.error ?? 'Execution failed');
      }
      return receipt;
    }

    const existingReceipt = await store.getReceiptByStep(input.jobId, input.stepId);
    if (existingReceipt) {
      const approval = await store.getApprovalForReceipt(input.jobId, existingReceipt.id);
      if (approval?.decision === 'approved' || existingReceipt.approval === 'approved') {
        const receipt = {
          ...existingReceipt,
          approval: 'approved' as const,
        };
        await store.saveReceipt(receipt);

        // Check if there is already a successful result for this receipt
        const existingResult = await store.getResultForReceipt(existingReceipt.id);
        if (existingResult && existingResult.status === 'succeeded') {
          return receipt;
        }

        const { executeReceipt } = await import('../../../hands/src/executor.js');
        const result = await executeReceipt(receipt, workspacePath);
        await store.saveResult(result);
        if (result.status === 'failed') {
          throw new Error(result.error ?? 'Execution failed');
        }
        return receipt;
      } else if (approval?.decision === 'denied' || existingReceipt.approval === 'denied') {
        throw new Error('Receipt denied by owner');
      } else {
        throw new Error('Awaiting human approval');
      }
    }

    // Trust-calibrated autonomy: the owner has standing approval for low-risk
    // self-extension, so a skill write runs immediately instead of pausing.
    if (
      hasStandingApproval(
        { capability: input.capability, risk: input.risk },
        { trustLevel: 'owner', autonomy: getSkillAutonomy() },
      )
    ) {
      const receipt: ToolReceipt = {
        id: `receipt_${randomUUID()}`,
        jobId: input.jobId,
        stepId: input.stepId,
        tool: input.tool,
        capability: input.capability,
        input: input.input,
        risk: input.risk,
        approval: 'approved',
        createdAt: new Date().toISOString(),
      };
      await store.saveReceipt(receipt);

      const { executeReceipt } = await import('../../../hands/src/executor.js');
      const result = await executeReceipt(receipt, workspacePath);
      await store.saveResult(result);
      if (result.status === 'failed') {
        throw new Error(result.error ?? 'Execution failed');
      }
      return receipt;
    }

    const receipt: ToolReceipt = {
      id: `receipt_${randomUUID()}`,
      jobId: input.jobId,
      stepId: input.stepId,
      tool: input.tool,
      capability: input.capability,
      input: input.input,
      risk: input.risk,
      approval: 'required',
      createdAt: new Date().toISOString(),
    };
    await store.saveReceipt(receipt);
    await store.createApproval(receipt.id, input.jobId, 'receipt', receipt.id);

    throw new Error('Awaiting human approval');
  },
});
