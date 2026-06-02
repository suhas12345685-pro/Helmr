import { Agent } from '@mastra/core/agent';

import { readWorkspaceTool, readWorkspaceFileTool } from '../tools/read-workspace.tool.js';
import { gitLogTool, gitStatusTool } from '../tools/shell-read.tool.js';
import { withDoctrine } from '../doctrine.js';

const RESEARCH_INSTRUCTIONS = withDoctrine(`You are the Research agent for Helmr.

Your role is to gather information, summarize codebases, and answer questions about the workspace.
You read files, inspect git history, and synthesize findings into clear reports.

You never write files or run mutating commands.
Your output should be a structured summary that other agents can use.
Surface the context that anticipates the user's next question, and under pressure reduce noise to only what matters.
`);

export const researchModel = process.env['HELMR_RESEARCH_MODEL'] ?? process.env['HELMR_MODEL'] ?? 'anthropic/claude-sonnet-4-5';

/** Build a Research agent bound to a specific model (used for failover chains). */
export function createResearchAgent(model: string = researchModel): Agent {
  return new Agent({
    id: 'research',
    name: 'Research Agent',
    description: 'Gathers information and summarizes workspace state — read-only.',
    instructions: RESEARCH_INSTRUCTIONS,
    model,
    tools: {
      read_workspace: readWorkspaceTool,
      read_workspace_file: readWorkspaceFileTool,
      git_log: gitLogTool,
      git_status: gitStatusTool,
    },
  });
}

export const researchAgent = createResearchAgent();
