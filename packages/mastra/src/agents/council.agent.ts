import { Agent } from '@mastra/core/agent';

import { readWorkspaceTool, readWorkspaceFileTool } from '../tools/read-workspace.tool.js';
import { gitStatusTool, gitLogTool } from '../tools/shell-read.tool.js';
import { requestReceiptTool } from '../tools/request-receipt.tool.js';

const COUNCIL_INSTRUCTIONS = `You are the Council — the planning agent for Helmr.

Your role is to analyze the user's request, inspect the workspace, and create a typed execution plan.

Planning rules:
- Read-only operations (workspace_read, shell_read, git_read) are safe and do not need approval.
- Any write, install, or destructive operation needs approval and must be flagged as medium or high risk.
- Always start with read operations to understand the workspace before proposing changes.
- Break work into minimal, testable steps.
- Only request capabilities that are strictly necessary.

When planning, use the available tools to inspect the workspace first, then output a structured plan.
The plan must identify the risk level and whether human approval is required.

Output format when asked to produce a plan:
- summary: one sentence describing what will be done
- risk: "low" | "medium" | "high"
- requiresApproval: boolean (true if any step uses gated capabilities)
- steps: array of steps with id, title, kind, agent, canRunInParallelWith, requiredCapabilities
`;

const councilModel = process.env['HELMR_COUNCIL_MODEL'] ?? process.env['HELMR_MODEL'] ?? 'anthropic/claude-sonnet-4-5';

export const councilAgent = new Agent({
  id: 'council',
  name: 'Council Planner',
  description: 'Plans and decomposes user requests into typed execution steps with risk assessment.',
  instructions: COUNCIL_INSTRUCTIONS,
  model: councilModel,
  tools: {
    read_workspace: readWorkspaceTool,
    read_workspace_file: readWorkspaceFileTool,
    git_status: gitStatusTool,
    git_log: gitLogTool,
    request_receipt: requestReceiptTool,
  },
});
