import { runSelfTest, printSelfTestResults } from '../../dist/src/self-test.js';
Object.assign(process.env, {
  HELMR_PRODUCTION: 'true',
  HELMR_API_TOKEN: process.env.HELMR_API_TOKEN || 'local-simulation-token-000000000000',
  HELMR_ALLOWED_ORIGINS: process.env.HELMR_ALLOWED_ORIGINS || 'http://localhost:4000',
  HELMR_AUTH_MODE: undefined,
});
const results = await runSelfTest();
printSelfTestResults(results);
process.exit(results.every((result) => result.passed) ? 0 : 1);
