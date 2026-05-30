import { Mastra } from '@mastra/core/mastra';
import {
  councilAgent,
  codingAgent,
  researchAgent,
  fastAgent,
  planningWorkflow,
  executionWorkflow,
  intakeWorkflow,
  reviewWorkflow,
  deliveryWorkflow,
} from '../../packages/mastra/src/index.js';

export * from '../../packages/mastra/src/index.js';

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
