import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';

import { getHelmrPaths } from './paths.js';
import { loadBudgetLimits } from '../packages/governor/src/index.js';

/**
 * `helmr doctor` — a single-shot health and posture report.
 *
 * It answers "is this deployment safe and operational right now?" by checking
 * the control plane (DB), the safety substrate (budget headroom, kill-switch,
 * standing policy, pending checkpoints), and evidence integrity (audit chains).
 * Each check yields ok/warn/fail; the process exits non-zero if anything fails.
 */

export type CheckLevel = 'ok' | 'warn' | 'fail';
export interface CheckResult {
  name: string;
  level: CheckLevel;
  detail: string;
}

const ICON: Record<CheckLevel, string> = { ok: '✓', warn: '!', fail: '✗' };

export async function collectChecks(): Promise<CheckResult[]> {
  const paths = getHelmrPaths();
  const checks: CheckResult[] = [];

  // ── Environment ───────────────────────────────────────────────────
  checks.push({ name: 'node', level: 'ok', detail: `Node ${process.versions.node}` });
  for (const [label, dir] of [['data', paths.dataDir], ['config', paths.configDir], ['audit', paths.auditDir]] as const) {
    const exists = await access(dir).then(() => true).catch(() => false);
    checks.push({ name: `dir:${label}`, level: exists ? 'ok' : 'warn', detail: `${dir}${exists ? '' : ' (missing — created on first use)'}` });
  }

  // ── Control plane (SQLite) ────────────────────────────────────────
  try {
    const { HelmrSQLiteStore } = await import('../packages/memory/src/sqlite-store.js');
    const store = new HelmrSQLiteStore(join(paths.dataDir, 'helmr.db'));
    await store.init();
    try {
      const recent = await store.listJobs({ limit: 100 });
      const byStatus = recent.reduce<Record<string, number>>((acc, j) => {
        acc[j.status] = (acc[j.status] ?? 0) + 1;
        return acc;
      }, {});
      const stuck = (byStatus['paused_budget'] ?? 0) + (byStatus['paused_killswitch'] ?? 0) + (byStatus['awaiting_approval'] ?? 0);
      checks.push({
        name: 'database',
        level: 'ok',
        detail: `reachable — ${recent.length} recent job(s): ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
      });
      if (stuck > 0) {
        checks.push({ name: 'jobs:waiting', level: 'warn', detail: `${stuck} job(s) paused or awaiting approval` });
      }
    } finally {
      store.close();
    }
  } catch (err) {
    checks.push({ name: 'database', level: 'fail', detail: `unreachable: ${(err as Error).message}` });
  }

  // ── Budget headroom ───────────────────────────────────────────────
  try {
    const limits = loadBudgetLimits();
    const today = new Date().toISOString().slice(0, 10);
    let spentToday = 0;
    try {
      const raw = await readFile(join(paths.dataDir, 'budget-spend.json'), 'utf8');
      spentToday = (JSON.parse(raw) as Record<string, number>)[today] ?? 0;
    } catch {
      // No spend recorded yet.
    }
    const cap = limits.usdPerDay;
    let level: CheckLevel = 'ok';
    if (cap !== undefined) {
      if (spentToday >= cap) level = 'fail';
      else if (spentToday >= cap * 0.8) level = 'warn';
    }
    const capLabel = cap === undefined ? 'unlimited' : `$${cap.toFixed(2)}`;
    checks.push({ name: 'budget', level, detail: `today $${spentToday.toFixed(4)} / ${capLabel} per-day; per-job ${limits.usdPerJob === undefined ? 'unlimited' : `$${limits.usdPerJob.toFixed(2)}`}` });
  } catch (err) {
    checks.push({ name: 'budget', level: 'warn', detail: `could not read budget: ${(err as Error).message}` });
  }

  // ── Kill-switch ───────────────────────────────────────────────────
  try {
    const { KillSwitch } = await import('../packages/scheduler/src/kill-switch.js');
    const { HelmrSQLiteStore } = await import('../packages/memory/src/sqlite-store.js');
    const store = new HelmrSQLiteStore(join(paths.dataDir, 'helmr.db'));
    await store.init();
    try {
      const engaged = await new KillSwitch({ store }).listHalted();
      checks.push({
        name: 'kill-switch',
        level: engaged.length === 0 ? 'ok' : 'warn',
        detail: engaged.length === 0 ? 'clear' : `ENGAGED: ${engaged.map((e) => e.scope).join(', ')}`,
      });
    } finally {
      store.close();
    }
  } catch (err) {
    checks.push({ name: 'kill-switch', level: 'warn', detail: `could not read: ${(err as Error).message}` });
  }

  // ── Standing policy ───────────────────────────────────────────────
  try {
    const { StandingPolicyStore } = await import('../packages/config/src/standing-policy.js');
    const policy = await new StandingPolicyStore(paths.configDir).load();
    const ruleCount = Object.keys(policy.rules).length;
    checks.push({
      name: 'outward-policy',
      level: 'ok',
      detail: ruleCount === 0 ? 'fail-safe (every outward action gated)' : `${ruleCount} standing rule(s): ${Object.keys(policy.rules).join(', ')}`,
    });
  } catch (err) {
    checks.push({ name: 'outward-policy', level: 'warn', detail: `could not read: ${(err as Error).message}` });
  }

  // ── Pending checkpoints ───────────────────────────────────────────
  try {
    const ckptRoot = join(paths.dataDir, 'checkpoints');
    const jobs = await readdir(ckptRoot, { withFileTypes: true }).catch(() => []);
    let recoverable = 0;
    for (const entry of jobs) {
      if (!entry.isDirectory()) continue;
      const hasLatest = await access(join(ckptRoot, entry.name, 'latest.json')).then(() => true).catch(() => false);
      if (hasLatest) recoverable += 1;
    }
    checks.push({
      name: 'checkpoints',
      level: 'ok',
      detail: recoverable === 0 ? 'none pending' : `${recoverable} job(s) with a recoverable checkpoint (helmr rollback <jobId>)`,
    });
  } catch (err) {
    checks.push({ name: 'checkpoints', level: 'warn', detail: `could not scan: ${(err as Error).message}` });
  }

  // ── Audit chain integrity (recent jobs) ───────────────────────────
  try {
    const { JsonlAuditLog } = await import('../packages/memory/src/audit-jsonl.js');
    const audit = new JsonlAuditLog(paths.auditDir);
    const files = await readdir(paths.auditDir).catch(() => []);
    const jobIds = files.filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -'.jsonl'.length)).slice(0, 25);
    let checked = 0;
    let bad: string | undefined;
    for (const jobId of jobIds) {
      const v = await audit.verifyJob(jobId);
      checked += 1;
      if (!v.valid) { bad = `${jobId}: ${v.failureReason}`; break; }
    }
    checks.push({
      name: 'audit-chain',
      level: bad ? 'fail' : 'ok',
      detail: bad ? `tamper detected — ${bad}` : `${checked} recent job chain(s) verified`,
    });
  } catch (err) {
    checks.push({ name: 'audit-chain', level: 'warn', detail: `could not verify: ${(err as Error).message}` });
  }

  return checks;
}

export function formatReport(checks: CheckResult[]): string {
  const lines = checks.map((c) => `  ${ICON[c.level]} ${c.name.padEnd(16)} ${c.detail}`);
  const fails = checks.filter((c) => c.level === 'fail').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  const summary = fails > 0 ? `UNHEALTHY — ${fails} failure(s), ${warns} warning(s)` : warns > 0 ? `OK with ${warns} warning(s)` : 'HEALTHY';
  return ['Helmr doctor', '─'.repeat(40), ...lines, '─'.repeat(40), summary].join('\n');
}

/** Run the full report and return a process exit code (0 healthy, 1 on any fail). */
export async function runDoctor(): Promise<number> {
  const checks = await collectChecks();
  console.log(formatReport(checks));
  return checks.some((c) => c.level === 'fail') ? 1 : 0;
}
