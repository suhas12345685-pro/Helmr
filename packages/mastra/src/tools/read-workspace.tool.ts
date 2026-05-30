import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { summarizeWorkspace, readWorkspaceFile } from '../../../hands/src/read-tools.js';

export const readWorkspaceTool = createTool({
  id: 'read_workspace',
  description: 'List all files in a workspace directory, excluding node_modules, dist, and .git.',
  inputSchema: z.object({
    workspacePath: z.string().describe('Absolute path to the workspace root'),
    limit: z.number().int().min(1).max(500).optional().describe('Max files to return (default 200)'),
  }),
  execute: async (input) => {
    return summarizeWorkspace(input.workspacePath, input.limit ?? 200);
  },
});

export const readWorkspaceFileTool = createTool({
  id: 'read_workspace_file',
  description: 'Read the contents of a single file inside the workspace. Rejects paths outside the workspace root.',
  inputSchema: z.object({
    workspacePath: z.string().describe('Absolute path to the workspace root'),
    filePath: z.string().describe('Path to the file, relative to the workspace root'),
  }),
  execute: async (input) => {
    const content = await readWorkspaceFile(input.workspacePath, input.filePath);
    return { filePath: input.filePath, content };
  },
});
