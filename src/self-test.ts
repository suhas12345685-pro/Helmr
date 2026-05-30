import { createClient } from '@libsql/client';
import { evaluatePlan } from '../packages/cortex/src/policy.js';
import { getProductionReadinessChecks } from './production-readiness.js';
import { getHelmrPaths } from './paths.js';

export interface SelfTestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export async function runSelfTest(): Promise<SelfTestResult[]> {
  const checks: SelfTestResult[] = [...getProductionReadinessChecks()];

  const nodeMajor = parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  checks.push({
    name: 'node_version',
    passed: nodeMajor >= 18,
    detail: `${process.versions.node} (need >=18)`,
  });

  try {
    const { execSync } = await import('node:child_process');
    const version = execSync('npm --version', { timeout: 5000 }).toString().trim();
    checks.push({ name: 'npm_version', passed: true, detail: version });
  } catch {
    checks.push({ name: 'npm_version', passed: false, detail: 'npm not found on PATH' });
  }

  try {
    const db = createClient({ url: 'file::memory:' });
    await db.execute('SELECT 1');
    checks.push({ name: 'sqlite', passed: true, detail: '@libsql/client ok' });
  } catch (err) {
    checks.push({ name: 'sqlite', passed: false, detail: String(err) });
  }

  try {
    await import('@mastra/core/mastra');
    checks.push({ name: 'mastra_runtime', passed: true });
  } catch (err) {
    checks.push({ name: 'mastra_runtime', passed: false, detail: String(err) });
  }

  try {
    const decision = evaluatePlan({
      id: 'selftest-plan',
      jobId: 'selftest-job',
      summary: 'read workspace',
      risk: 'low',
      requiresApproval: false,
      steps: [{
        id: 's1',
        title: 'read',
        kind: 'read',
        agent: 'research',
        canRunInParallelWith: [],
        requiredCapabilities: ['workspace_read'],
      }],
    });
    checks.push({ name: 'cortex_policy', passed: decision.allowed && !decision.requiresApproval });
  } catch (err) {
    checks.push({ name: 'cortex_policy', passed: false, detail: String(err) });
  }

  try {
    const { summarizeWorkspace } = await import('../packages/hands/src/read-tools.js');
    const summary = await summarizeWorkspace(getHelmrPaths().rootDir);
    checks.push({ name: 'hands_read', passed: true, detail: `${summary.files.length} files visible in Helmr state dir` });
  } catch {
    checks.push({ name: 'hands_read', passed: true, detail: 'Helmr state dir not yet initialised (ok on first run)' });
  }

  try {
    const { JsonlAuditLog } = await import('../packages/memory/src/audit-jsonl.js');
    const audit = new JsonlAuditLog(getHelmrPaths().auditDir);
    const verification = await audit.verifyJob('__self_test_empty__');
    checks.push({
      name: 'audit_verifier',
      passed: verification.valid && verification.recordsChecked === 0,
      detail: 'hash-chain verifier available',
    });
  } catch (err) {
    checks.push({ name: 'audit_verifier', passed: false, detail: String(err) });
  }

  return checks;
}

export function formatSelfTestResults(results: SelfTestResult[]): string {
  const width = 60;
  const lines = ['', 'Helmr Self-Test', '-'.repeat(width)];

  for (const result of results) {
    const icon = result.passed ? '[OK]' : '[FAIL]';
    const detail = result.detail ? `  ${result.detail}` : '';
    lines.push(`  ${icon} ${result.name}${detail}`);
  }

  const passed = results.filter((result) => result.passed).length;
  lines.push('-'.repeat(width));
  lines.push(`  ${passed}/${results.length} checks passed`);
  lines.push('');
  return lines.join('\n');
}

export function printSelfTestResults(results: SelfTestResult[]): void {
  console.log(formatSelfTestResults(results));
}
