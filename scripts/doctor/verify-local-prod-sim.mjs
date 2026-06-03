import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSelfTest, printSelfTestResults } from '../../dist/src/self-test.js';

// The production readiness gate requires explicitly isolated state directories. Seed
// throwaway temp dirs when the operator has not exported HELMR_DATA_DIR / HELMR_CONFIG_DIR
// so `verify:local-prod-sim` produces a faithful production simulation in a plain shell.
const simRoot = mkdtempSync(join(tmpdir(), 'helmr-prod-sim-'));
const dataDir = process.env.HELMR_DATA_DIR || join(simRoot, 'data');
const configDir = process.env.HELMR_CONFIG_DIR || join(simRoot, 'config');
mkdirSync(dataDir, { recursive: true });
mkdirSync(configDir, { recursive: true });

Object.assign(process.env, {
  HELMR_PRODUCTION: 'true',
  HELMR_API_TOKEN: process.env.HELMR_API_TOKEN || 'local-simulation-token-000000000000',
  HELMR_ALLOWED_ORIGINS: process.env.HELMR_ALLOWED_ORIGINS || 'http://localhost:4000',
  HELMR_DATA_DIR: dataDir,
  HELMR_CONFIG_DIR: configDir,
  HELMR_AUTH_MODE: undefined,
});
const results = await runSelfTest();
printSelfTestResults(results);
process.exit(results.every((result) => result.passed) ? 0 : 1);
