import { Mastra } from '@mastra/core/mastra';

import { councilAgent } from './agents/council.agent.js';
import { codingAgent } from './agents/coding.agent.js';
import { researchAgent } from './agents/research.agent.js';
import { fastAgent } from './agents/fast.agent.js';
import { planningWorkflow } from './workflows/planning.workflow.js';
import { executionWorkflow } from './workflows/execution.workflow.js';
import { intakeWorkflow } from './workflows/intake.workflow.js';
import { reviewWorkflow } from './workflows/review.workflow.js';
import { deliveryWorkflow } from './workflows/delivery.workflow.js';

export { councilAgent, codingAgent, researchAgent, fastAgent };
export { planningWorkflow, executionWorkflow, intakeWorkflow, reviewWorkflow, deliveryWorkflow };
export { readWorkspaceTool, readWorkspaceFileTool } from './tools/read-workspace.tool.js';
export { shellReadTool, gitStatusTool, gitLogTool } from './tools/shell-read.tool.js';
export { requestReceiptTool } from './tools/request-receipt.tool.js';
export { createHelmrMemory, createInMemoryHelmrMemory } from './memory/mastra-memory.js';
export type { HelmrPlan, HelmrEvent, HelmrJob, ToolReceipt, ToolResult, Capability } from '../../shared/src/index.js';

export const mastra = new Mastra({
  agents: {
    council: councilAgent,
    coding: codingAgent,
    research: researchAgent,
    fast: fastAgent,
  },
  workflows: {
    planning: planningWorkflow,
    execution: executionWorkflow,
    intake: intakeWorkflow,
    review: reviewWorkflow,
    delivery: deliveryWorkflow,
  },
});
