export {
  SkillManifestSchema,
  parseSkillManifest,
  isSkillManifest,
  type SkillManifest,
} from './manifest.js';
export { SkillRegistry, matchSkills } from './registry.js';

/** Skill files live here, inside the workspace, under the one-writer lock. */
export const SKILLS_DIR_NAME = '.helmr/skills';
