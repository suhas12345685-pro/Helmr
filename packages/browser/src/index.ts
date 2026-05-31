import type { ToolReceipt } from '../../shared/src/index.js';

export interface BrowserAutomationRequest {
  url: string;
  goal: string;
  readonly?: boolean;
}

export function createBrowserReceipt(input: {
  id: string;
  jobId: string;
  stepId: string;
  request: BrowserAutomationRequest;
  approved?: boolean;
}): ToolReceipt {
  return {
    id: input.id,
    jobId: input.jobId,
    stepId: input.stepId,
    tool: 'browser_automation',
    capability: 'browser',
    input: input.request,
    risk: input.request.readonly === false ? 'medium' : 'low',
    approval: input.approved ? 'approved' : 'required',
    createdAt: new Date().toISOString(),
  };
}
