import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { runShellRead, runGitStatus, runGitLog } from '../../../hands/src/shell-tools.js';

export const shellReadTool = createTool({
  id: 'shell_read',
  description: 'Run a read-only shell command inside the workspace. Only non-mutating commands are allowed.',
  inputSchema: z.object({
    workspacePath: z.string().describe('Absolute path to the workspace root'),
    command: z.string().describe('Shell command to run (read-only operations only)'),
  }),
  execute: async (input) => {
    return runShellRead(input.workspacePath, input.command);
  },
});

export const gitStatusTool = createTool({
  id: 'git_status',
  description: 'Get git status of the workspace.',
  inputSchema: z.object({
    workspacePath: z.string().describe('Absolute path to the workspace root'),
  }),
  execute: async (input) => {
    return runGitStatus(input.workspacePath);
  },
});

export const gitLogTool = createTool({
  id: 'git_log',
  description: 'Get recent git commit history for the workspace.',
  inputSchema: z.object({
    workspacePath: z.string().describe('Absolute path to the workspace root'),
    maxCount: z.number().int().min(1).max(50).optional().describe('Number of commits to return (default 10)'),
  }),
  execute: async (input) => {
    return runGitLog(input.workspacePath, input.maxCount ?? 10);
  },
});
