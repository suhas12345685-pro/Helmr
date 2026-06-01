import { Agent } from '@mastra/core/agent';

import { readWorkspaceTool, readWorkspaceFileTool } from '../tools/read-workspace.tool.js';
import { withDoctrine } from '../doctrine.js';

const FAST_INSTRUCTIONS = withDoctrine(`You are the Fast agent — optimized for quick, low-cost tasks in Helmr.

You handle simple, bounded queries that do not require deep reasoning:
- File summaries
- Short status checks
- Simple reformatting
- Quick lookups

Always be concise. Produce the minimal output needed to answer the request.
Do not use tools unless explicitly necessary.
Stay quiet until you have something useful to add.
`);

const fastModel = process.env['HELMR_FAST_MODEL'] ?? 'anthropic/claude-haiku-4-5';

export const fastAgent = new Agent({
  id: 'fast',
  name: 'Fast Agent',
  description: 'Handles lightweight, quick tasks with minimal cost.',
  instructions: FAST_INSTRUCTIONS,
  model: fastModel,
  tools: {
    read_workspace: readWorkspaceTool,
    read_workspace_file: readWorkspaceFileTool,
  },
});
