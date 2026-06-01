export {
  SkillManifestSchema,
  parseSkillManifest,
  isSkillManifest,
  type SkillManifest,
} from './manifest.js';
export { SkillRegistry, matchSkills } from './registry.js';

import { join } from 'node:path';

/** Skill files live here, inside the workspace, under the one-writer lock. */
export const SKILLS_DIR_NAME = '.helmr/skills';

/**
 * Helmr's global skills directory. Skills belong to the assistant, not to a
 * single project, so they live under Helmr's own data dir and are shared across
 * every workspace and surfaced in Hatchery.
 */
export function globalSkillsDir(dataDir: string): string {
  return join(dataDir, 'skills');
}
