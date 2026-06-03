export {
  SkillManifestSchema,
  parseSkillManifest,
  isSkillManifest,
  type SkillManifest,
} from './manifest.js';
export { SkillRegistry, matchSkills, filterSkillsByPermissions, type SkillRegistryEntry } from './registry.js';

import { join } from 'node:path';

export const SKILLS_DIR_NAME = '.helmr/skills';

export function globalSkillsDir(dataDir: string): string {
  return join(dataDir, 'skills');
}
