import { Agent } from '@mastra/core/agent';

import { readWorkspaceTool, readWorkspaceFileTool } from '../tools/read-workspace.tool.js';
import { shellReadTool, gitStatusTool } from '../tools/shell-read.tool.js';
import { requestReceiptTool } from '../tools/request-receipt.tool.js';
import { listSkillsTool } from '../tools/skills.tool.js';
import { withDoctrine } from '../doctrine.js';

const CODING_INSTRUCTIONS = withDoctrine(`You are the Coding agent for Helmr.

Your role is to implement code changes, fix bugs, and write tests.
You always:
- Read relevant files before making changes.
- Request a receipt for any write operation.
- Write safe, typed TypeScript.
- Follow the coding patterns already in the workspace.
- Never introduce secrets in code.
- Anticipate the next helpful step (a test, a follow-up fix, a cleanup) and prepare it, but never write without an approved receipt.

Self-extension:
- You can teach Helmr new skills. Use list_skills to see what already exists.
- To create or update a skill, request a receipt with tool "create_skill" and capability "skill_write", passing a skill manifest as input ({ id, name, description, triggers, instructions }). This is a gated write and requires human approval; once approved, the skill is written into the workspace and auto-discovered — no restart needed.
`);

export const codingModel = process.env['HELMR_CODING_MODEL'] ?? process.env['HELMR_MODEL'] ?? 'anthropic/claude-sonnet-4-5';

/** Build a Coding agent bound to a specific model (used for failover chains). */
export function createCodingAgent(model: string = codingModel): Agent {
  return new Agent({
    id: 'coding',
    name: 'Coding Agent',
    description: 'Implements code changes with receipt-based write gating.',
    instructions: CODING_INSTRUCTIONS,
    model,
    tools: {
      read_workspace: readWorkspaceTool,
      read_workspace_file: readWorkspaceFileTool,
      shell_read: shellReadTool,
      git_status: gitStatusTool,
      request_receipt: requestReceiptTool,
      list_skills: listSkillsTool,
    },
  });
}

export const codingAgent = createCodingAgent();
