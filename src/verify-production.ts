import { pathToFileURL } from 'node:url';

export type DeploymentVerificationEnv = Record<string, string | undefined>;

export interface DeploymentVerificationResult { passed: boolean; failures: string[] }

export function verifyDeploymentEnv(env: DeploymentVerificationEnv = process.env): DeploymentVerificationResult {
  const failures: string[] = [];
  for (const key of ['HELMR_API_TOKEN', 'HELMR_ALLOWED_ORIGINS', 'HELMR_DATA_DIR', 'HELMR_CONFIG_DIR', 'HELMR_BACKUP_DIR']) {
    if (!env[key]?.trim()) failures.push(`${key} is required for real deployment verification.`);
  }
  // HELMR_AUDIT_DIR is the variable the runtime path resolver honors; accept either it
  // or the legacy HELMR_AUDIT_LOG so a deployment that sets the effective one passes.
  if (!env.HELMR_AUDIT_DIR?.trim() && !env.HELMR_AUDIT_LOG?.trim()) {
    failures.push('HELMR_AUDIT_DIR (or HELMR_AUDIT_LOG) is required for real deployment verification.');
  }
  if (env.HELMR_API_TOKEN && env.HELMR_API_TOKEN.length < 32) failures.push('HELMR_API_TOKEN must be at least 32 characters.');
  const origins = (env.HELMR_ALLOWED_ORIGINS ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  if (origins.some((origin) => origin.includes('*'))) {
    failures.push('HELMR_ALLOWED_ORIGINS cannot contain wildcard origins for deployment verification.');
  }
  if (env.HELMR_PRODUCTION !== 'true' && env.NODE_ENV !== 'production') failures.push('Set HELMR_PRODUCTION=true or NODE_ENV=production for deployment verification.');
  return { passed: failures.length === 0, failures };
}

async function main(): Promise<void> {
  const result = verifyDeploymentEnv();
  if (!result.passed) {
    console.error('Deployment verification failed:');
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('Deployment verification passed explicit secret/origin/state checks.');
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  main().catch((err) => {
    console.error('Fatal Verification Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
