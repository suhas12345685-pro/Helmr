import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { SkillRegistry, matchSkills, globalSkillsDir } from '../../../skills/src/index.js';
import { getHelmrPaths } from '../../../../src/paths.js';

export const listSkillsTool = createTool({
  id: 'list_skills',
  description:
    "List the skills Helmr has available. Skills are auto-discovered, so this reflects anything created so far. Optionally pass text to rank skills whose triggers match it.",
  inputSchema: z.object({
    text: z.string().optional().describe('Optional text to match skill triggers against'),
  }),
  execute: async (input) => {
    const registry = new SkillRegistry(globalSkillsDir(getHelmrPaths().dataDir));
    const skills = await registry.list();
    return {
      skills,
      matched: input.text ? matchSkills(skills, input.text) : [],
    };
  },
});
