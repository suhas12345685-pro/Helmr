import { randomUUID } from 'node:crypto';

import type { HelmrPlan } from '../../shared/src/index.js';
export { councilAgent } from '../../mastra/src/agents/council.agent.js';
export { planningWorkflow } from '../../mastra/src/workflows/planning.workflow.js';

export interface CouncilPlanRequest {
  jobId: string;
  request: string;
}

export function createReadOnlyCouncilPlan(input: CouncilPlanRequest): HelmrPlan {
  return {
    id: `plan_${input.jobId || randomUUID()}`,
    jobId: input.jobId,
    summary: `Read-only inspection plan for: ${input.request}`,
    risk: 'low',
    requiresApproval: false,
    steps: [
      {
        id: 'inspect_workspace',
        title: 'Inspect workspace tree and package metadata',
        kind: 'read',
        agent: 'council',
        canRunInParallelWith: [],
        requiredCapabilities: ['workspace_read'],
      },
    ],
  };
}
