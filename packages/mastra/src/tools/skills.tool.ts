import { createTool } from '@mastra/core/tools';
import { join } from 'node:path';
import { z } from 'zod';

import { SkillRegistry, matchSkills, SKILLS_DIR_NAME } from '../../../skills/src/index.js';

export const listSkillsTool = createTool({
  id: 'list_skills',
  description:
    "List the skills Helmr has available in this workspace. Skills are auto-discovered, so this reflects anything created so far. Optionally pass text to rank skills whose triggers match it.",
  inputSchema: z.object({
    workspacePath: z.string().describe('Absolute path to the workspace root'),
    text: z.string().optional().describe('Optional text to match skill triggers against'),
  }),
  execute: async (input) => {
    const registry = new SkillRegistry(join(input.workspacePath, SKILLS_DIR_NAME));
    const skills = await registry.list();
    return {
      skills,
      matched: input.text ? matchSkills(skills, input.text) : [],
    };
  },
});
