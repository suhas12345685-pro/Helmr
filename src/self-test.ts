import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { evaluatePlan } from '../packages/cortex/src/policy.js';
import { getProductionReadinessChecks } from './production-readiness.js';
import { getHelmrPaths } from './paths.js';

export interface SelfTestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export type SelfTestEnv = Record<string, string | undefined>;

export async function runSelfTest(env: SelfTestEnv = process.env): Promise<SelfTestResult[]> {
  const checks: SelfTestResult[] = [...getProductionReadinessChecks(env)];

  const nodeMajor = parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  checks.push({
    name: 'node_version',
    passed: nodeMajor >= 18,
    detail: `${process.versions.node} (need >=18)`,
  });

  try {
    const version = execSync('npm --version', { timeout: 5000 }).toString().trim();
    checks.push({ name: 'npm_version', passed: true, detail: version });
  } catch {
    checks.push({ name: 'npm_version', passed: false, detail: 'npm not found on PATH' });
  }

  try {
    const version = execSync('git --version', { timeout: 5000 }).toString().trim();
    checks.push({ name: 'git_version', passed: true, detail: version });
  } catch {
    checks.push({ name: 'git_version', passed: false, detail: 'git not found on PATH' });
  }

  const helmrPaths = getHelmrPaths(env);
  checks.push(await checkWritableDirectory('data_dir_writable', helmrPaths.dataDir));
  checks.push(await checkWritableDirectory('config_dir_writable', helmrPaths.configDir));
  checks.push(await checkWritableDirectory('audit_dir_writable', helmrPaths.auditDir));

  const urlHints = getServiceUrlHints(env);
  checks.push({ name: 'gateway_url_hint', passed: true, detail: urlHints.gateway });
  checks.push({ name: 'hatchery_url_hint', passed: true, detail: urlHints.hatchery });

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
    const summary = await summarizeWorkspace(helmrPaths.rootDir);
    checks.push({ name: 'hands_read', passed: true, detail: `${summary.files.length} files visible in Helmr state dir` });
  } catch {
    checks.push({ name: 'hands_read', passed: true, detail: 'Helmr state dir not yet initialised (ok on first run)' });
  }

  try {
    const { JsonlAuditLog } = await import('../packages/memory/src/audit-jsonl.js');
    const audit = new JsonlAuditLog(helmrPaths.auditDir);
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

export function getServiceUrlHints(env: SelfTestEnv = process.env): { gateway: string; hatchery: string } {
  const gateway = env.HELMR_GATEWAY_URL?.trim() || `http://localhost:${env.HELMR_GATEWAY_PORT?.trim() || '3999'}`;
  const hatchery = env.HELMR_HATCHERY_URL?.trim() || `http://localhost:${env.HELMR_HATCHERY_PORT?.trim() || '4000'}`;
  return { gateway, hatchery };
}

async function checkWritableDirectory(name: string, dir: string): Promise<SelfTestResult> {
  const probePath = join(dir, `.helmr-self-test-${randomUUID()}.tmp`);

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probePath, 'helmr self-test write probe\n', { flag: 'wx' });
    await unlink(probePath);
    return { name, passed: true, detail: dir };
  } catch (err) {
    try {
      await unlink(probePath);
    } catch {
      // Best-effort cleanup only. The failed write check below carries the actionable detail.
    }

    return {
      name,
      passed: false,
      detail: `${dir} is not writable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
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
