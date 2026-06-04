export {
  SkillManifestSchema,
  parseSkillManifest,
  isSkillManifest,
  type SkillManifest,
} from './manifest.js';
export { SkillRegistry, matchSkills, filterSkillsByPermissions, type SkillRegistryEntry } from './registry.js';
export {
  scanSkill,
  signSkill,
  verifySkillSignature,
  evaluateSkillTrust,
  canonicalizeSkill,
  computeSkillChecksum,
  generateSkillKeypair,
  keyFingerprint,
  formatTrustReport,
  type ScanFinding,
  type ScanResult,
  type Severity,
  type SignatureVerdict,
  type SkillKeyPair,
  type TrustPolicy,
  type TrustDecision,
  type SkillTrustReport,
} from './skill-guard.js';

import { join } from 'node:path';

export const SKILLS_DIR_NAME = '.helmr/skills';

export function globalSkillsDir(dataDir: string): string {
  return join(dataDir, 'skills');
}
