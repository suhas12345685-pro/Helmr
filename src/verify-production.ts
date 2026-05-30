import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { printSelfTestResults, runSelfTest } from './self-test.js';

const DEFAULT_PRODUCTION_TOKEN = '0123456789abcdef0123456789abcdef';
const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:4000';
const DEFAULT_RATE_LIMIT = '120';
const DEFAULT_BODY_LIMIT = '1048576';

export type ProductionVerificationEnv = Record<string, string | undefined>;

export function buildProductionVerificationEnv(
  baseEnv: ProductionVerificationEnv = process.env,
  workspaceRoot = process.cwd(),
): ProductionVerificationEnv {
  const stateRoot = join(workspaceRoot, '.helmr-production-check');

  return {
    ...baseEnv,
    HELMR_PRODUCTION: 'true',
    HELMR_API_TOKEN: valueOrDefault(baseEnv.HELMR_API_TOKEN, DEFAULT_PRODUCTION_TOKEN),
    HELMR_ALLOWED_ORIGINS: valueOrDefault(baseEnv.HELMR_ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGIN),
    HELMR_RATE_LIMIT_PER_MINUTE: valueOrDefault(baseEnv.HELMR_RATE_LIMIT_PER_MINUTE, DEFAULT_RATE_LIMIT),
    HELMR_MAX_BODY_BYTES: valueOrDefault(baseEnv.HELMR_MAX_BODY_BYTES, DEFAULT_BODY_LIMIT),
    HELMR_DATA_DIR: valueOrDefault(baseEnv.HELMR_DATA_DIR, join(stateRoot, 'data')),
    HELMR_CONFIG_DIR: valueOrDefault(baseEnv.HELMR_CONFIG_DIR, join(stateRoot, 'config')),
  };
}

async function main(): Promise<void> {
  Object.assign(process.env, buildProductionVerificationEnv());
  const results = await runSelfTest();
  printSelfTestResults(results);
  process.exit(results.every((result) => result.passed) ? 0 : 1);
}

function valueOrDefault(value: string | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  main().catch((err) => {
    console.error('Fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
