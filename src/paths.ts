import { join } from 'node:path';
import { homedir } from 'node:os';

export interface HelmrPaths {
  rootDir: string;
  dataDir: string;
  configDir: string;
  auditDir: string;
}

export type HelmrPathEnv = Record<string, string | undefined>;

export function getHelmrPaths(
  env: HelmrPathEnv = process.env,
  homeDir = homedir(),
): HelmrPaths {
  const rootDir = join(homeDir, '.helmr');
  const dataDir = env.HELMR_DATA_DIR?.trim() || join(rootDir, 'data');
  const configDir = env.HELMR_CONFIG_DIR?.trim() || join(rootDir, 'config');
  const auditDir = env.HELMR_AUDIT_DIR?.trim() || join(dataDir, 'audit');

  return { rootDir, dataDir, configDir, auditDir };
}
