import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { HelmrSQLiteStore, type HelmrStoreJob } from '../../memory/src/sqlite-store.js';
import { KillSwitch, GLOBAL_SCOPE } from '../../scheduler/src/kill-switch.js';
import { ModelRouter } from '../../router/src/model-router.js';
import { DEFAULT_ROUTING, saveRoutingConfig, type ModelRoute, type TaskKind } from '../../router/src/routing-config.js';
import { ConfigFileManager } from '../../config/src/config-files.js';
import { SecretStore } from '../../config/src/secret-store.js';
import type { HelmrPlan } from '../../shared/src/index.js';
import { evaluateApiAuth } from '../../shared/src/http-auth.js';
import { evaluateContentLength, getMaxBodyBytes } from '../../shared/src/http-limits.js';
import { getAllowedOrigins, isOriginAllowed, securityHeaders } from '../../shared/src/http-security.js';
import { normalizeRequestId } from '../../shared/src/request-id.js';
import { createFixedWindowRateLimiter, getRateLimitPerMinute } from '../../shared/src/rate-limit.js';
import { ChannelConfigStore, isKnownChannelName } from '../../channels/src/channel-config.js';
import { DreamJournal } from '../../memory/src/dream.js';
import { SkillRegistry, parseSkillManifest, globalSkillsDir } from '../../skills/src/index.js';
import type { SerializedAgentBody, TaskLedgerEntry } from '../../embodiment/src/index.js';
import { getHelmrPaths } from '../../../src/paths.js';

export interface HatcheryServerOptions {
  port?: number;
  dataDir?: string;
  configDir?: string;
}

const HATCHERY_PORT = 4000;
const hatcheryRateLimiter = createFixedWindowRateLimiter({
  limit: getRateLimitPerMinute(process.env['HELMR_RATE_LIMIT_PER_MINUTE']),
  windowMs: 60_000,
});
const PROVIDERS = [
  { name: 'anthropic', label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', description: 'Claude models' },
  { name: 'openai', label: 'OpenAI', envKey: 'OPENAI_API_KEY', description: 'GPT models' },
  { name: 'google', label: 'Google Gemini', envKey: 'GOOGLE_GENERATIVE_AI_API_KEY', description: 'Gemini models' },
  { name: 'groq', label: 'Groq', envKey: 'GROQ_API_KEY', description: 'Fast hosted open models' },
  { name: 'xai', label: 'xAI', envKey: 'XAI_API_KEY', description: 'Grok models' },
  { name: 'ollama', label: 'Ollama', envKey: '', description: 'Local models' },
] as const;

function uiStatus(status: HelmrStoreJob['status']): 'queued' | 'running' | 'succeeded' | 'failed' {
  if (status === 'running' || status === 'planning') return 'running';
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'queued';
}

async function toUiJob(store: HelmrSQLiteStore, job: HelmrStoreJob, planPromise?: Promise<HelmrPlan | null | undefined> | HelmrPlan | null | undefined) {
  // ⚡ Bolt: Fetch tool receipts and resolve plan concurrently to reduce latency
  const [plan, toolReceipts] = await Promise.all([
    planPromise,
    toUiToolReceipts(store, job.id)
  ]);

  return {
    id: job.id,
    status: uiStatus(job.status),
    planSummary: plan?.summary ?? job.payloadText ?? job.lastError ?? `${job.lane} job`,
    risk: plan?.risk ?? (job.lastError ? 'high' : 'low'),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    planSteps: plan?.steps.map((step) => step.title),
    result: job.finalResult ?? job.lastError,
    toolReceipts,
  };
}

async function toUiToolReceipts(store: HelmrSQLiteStore, jobId: string) {
  const receipts = await store.listReceiptsForJob(jobId);
  const withResults = await Promise.all(
    receipts.map(async (receipt) => {
      const result = await store.getResultForReceipt(receipt.id);
      return {
        tool: receipt.tool,
        input: JSON.stringify(receipt.input),
        output: result?.status === 'succeeded'
          ? stringifyUiValue(result.output)
          : result?.error ?? receipt.approval,
        timestamp: receipt.createdAt,
      };
    }),
  );
  return withResults;
}

function stringifyUiValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function collectCapabilities(plan?: HelmrPlan | null): string {
  const capabilities = new Set(plan?.steps.flatMap((step) => step.requiredCapabilities) ?? []);
  return [...capabilities].join(', ') || 'approval';
}

/**
 * A read-only view of the live multi-agent runtime for the Hatchery agents page.
 * Structural so any MultiAgentRuntime satisfies it without a hard import.
 */
export interface AgentsView {
  snapshot(): SerializedAgentBody[];
  ledger: { all(): TaskLedgerEntry[] };
}

export function createHatcheryApp(
  store: HelmrSQLiteStore,
  router: ModelRouter,
  configManager: ConfigFileManager,
  dataDir: string,
  agents?: AgentsView,
): Hono {
  const app = new Hono();
  const channelConfig = new ChannelConfigStore(dataDir, { webchatEndpoint: `http://localhost:${HATCHERY_PORT}` });
  const dreamJournal = new DreamJournal(dataDir);
  const secrets = new SecretStore(configManager.dir);
  // Emergency-stop substrate: the kill-switch shares the durable store so a halt
  // engaged here, from the CLI, or by the daemon is the same flag everywhere.
  const killSwitch = new KillSwitch({ store });
  // Skills are read fresh from disk on each request, so the API always reflects
  // the latest self-taught abilities. The long-running server (startHatcheryServer)
  // additionally watches the directory to hot-reload in-process consumers.
  const skills = new SkillRegistry(globalSkillsDir(dataDir));

  app.use('*', async (c, next) => {
    c.header('X-Request-Id', normalizeRequestId(c.req.header('x-request-id')));
    for (const [name, value] of Object.entries(securityHeaders)) {
      c.header(name, value);
    }
    const origin = c.req.header('origin');
    const allowedOrigins = getAllowedOrigins(process.env['HELMR_ALLOWED_ORIGINS']);
    if (!isOriginAllowed(origin, allowedOrigins)) {
      return c.json({ error: 'origin not allowed' }, 403);
    }
    const sizeDecision = evaluateContentLength(
      c.req.header('content-length'),
      getMaxBodyBytes(process.env['HELMR_MAX_BODY_BYTES']),
    );
    if (!sizeDecision.allowed) {
      return c.json({ error: sizeDecision.error }, sizeDecision.status);
    }
    const rateLimit = hatcheryRateLimiter.check(c.req.header('x-forwarded-for') ?? 'local');
    c.header('X-RateLimit-Remaining', String(rateLimit.remaining));
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      return c.json({ error: 'rate limit exceeded' }, 429);
    }
    c.header('Access-Control-Allow-Origin', origin ?? allowedOrigins[0] ?? 'http://localhost:4000');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (c.req.method === 'OPTIONS') return c.text('', 200);
    const decision = evaluateApiAuth({
      configuredToken: process.env['HELMR_API_TOKEN'],
      authorizationHeader: c.req.header('authorization'),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      nodeEnv: process.env['NODE_ENV'],
      helmrProduction: process.env['HELMR_PRODUCTION'],
      requireAuth: process.env['HELMR_REQUIRE_AUTH'],
      // Hatchery is the first-run onboarding control plane; default to the local dev
      // override so a token-less localhost install can reach onboarding/status endpoints.
      // Production, public-bind, and require-auth deployments still fail closed because
      // those conditions take precedence over the authMode=none override.
      authMode: process.env['HELMR_AUTH_MODE'] ?? 'none',
      bindHost: process.env['HELMR_BIND_HOST'],
    });
    if (!decision.allowed) {
      return c.json({ error: decision.error }, decision.status);
    }
    await next();
  });

  // GET /api/status
  app.get('/api/status', async (c) => {
    const jobs = await store.listJobs({ limit: 1 });
    return c.json({
      healthy: true,
      ok: true,
      uptime: process.uptime(),
      version: '0.1.0',
      dataDir,
      jobCount: jobs.length,
    });
  });

  // GET /api/kill-switch — current halt state for the emergency-stop control.
  app.get('/api/kill-switch', async (c) => {
    const engaged = await killSwitch.listHalted();
    return c.json({
      halted: engaged.some((f) => f.scope === GLOBAL_SCOPE),
      scopes: engaged,
    });
  });

  // POST /api/kill-switch/halt — engage the emergency stop (global or per-agent).
  app.post('/api/kill-switch/halt', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const scope = typeof body?.scope === 'string' && body.scope ? body.scope : GLOBAL_SCOPE;
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;
    await killSwitch.halt(scope, reason);
    return c.json({ halted: true, scope, reason });
  });

  // POST /api/kill-switch/resume — clear the emergency stop.
  app.post('/api/kill-switch/resume', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const scope = typeof body?.scope === 'string' && body.scope ? body.scope : GLOBAL_SCOPE;
    await killSwitch.resume(scope);
    return c.json({ halted: false, scope });
  });

  // GET /api/jobs
  app.get('/api/jobs', async (c) => {
    const rawStatus = c.req.query('status') as import('../../shared/src/index.js').HelmrJob['status'] | undefined;
    const jobs = await store.listJobs({ status: rawStatus, limit: 100 });
    const withPlans = await Promise.all(
      jobs.map(async (job) => toUiJob(store, job, store.getPlan(job.id))),
    );
    return c.json({ jobs: withPlans });
  });

  // GET /api/jobs/stats
  app.get('/api/jobs/stats', async (c) => {
    const jobs = await store.listJobs({ limit: 1000 });
    const stats = {
      total: jobs.length,
      running: 0,
      queued: 0,
      succeeded: 0,
      failed: 0,
    };
    for (const job of jobs) {
      stats[uiStatus(job.status)] += 1;
    }
    return c.json(stats);
  });

  // GET /api/jobs/:id
  app.get('/api/jobs/:id', async (c) => {
    const job = await store.getJob(c.req.param('id'));
    if (!job) return c.json({ error: 'not found' }, 404);
    // ⚡ Bolt: Pass plan promise directly to toUiJob for concurrent fetching
    const planPromise = store.getPlan(job.id);
    const uiJob = await toUiJob(store, job, planPromise);
    return c.json({ job: uiJob, plan: await planPromise ?? null });
  });

  // GET /api/swarms — research swarms, newest first
  app.get('/api/swarms', async (c) => {
    const limit = Number(c.req.query('limit') ?? '50');
    const swarms = await store.listSwarms(Number.isFinite(limit) ? limit : 50);
    const withCounts = await Promise.all(
      swarms.map(async (swarm) => {
        const tasks = await store.listSwarmTasks(swarm.id);
        return {
          id: swarm.id,
          jobId: swarm.jobId,
          request: swarm.request,
          status: swarm.status,
          taskCount: tasks.length,
          succeeded: tasks.filter((t) => t.status === 'succeeded').length,
          failed: tasks.filter((t) => t.status === 'failed').length,
          createdAt: swarm.createdAt,
          updatedAt: swarm.updatedAt,
        };
      }),
    );
    return c.json({ swarms: withCounts });
  });

  // GET /api/swarms/:id — a single swarm with its parallel subtasks
  app.get('/api/swarms/:id', async (c) => {
    const swarm = await store.getSwarm(c.req.param('id'));
    if (!swarm) return c.json({ error: 'not found' }, 404);
    const tasks = await store.listSwarmTasks(swarm.id);
    return c.json({ swarm, tasks });
  });

  // GET /api/dreams — idle-time reflections, newest first
  app.get('/api/dreams', async (c) => {
    const limit = Number(c.req.query('limit') ?? '20');
    const dreams = await dreamJournal.list(Number.isFinite(limit) ? limit : 20);
    return c.json({ dreams });
  });

  // GET /api/approvals
  app.get('/api/approvals', async (c) => {
    const pending = await store.getPendingApprovals();
    const approvals = await Promise.all(
      pending.map(async (approval) => {
        // ⚡ Bolt: Fetch job and plan concurrently
        const [job, plan] = await Promise.all([
          store.getJob(approval.jobId),
          store.getPlan(approval.jobId)
        ]);
        return {
          id: approval.id,
          jobId: approval.jobId,
          planSummary: plan?.summary ?? job?.payloadText ?? `${approval.kind} approval required`,
          capabilityRequired: collectCapabilities(plan),
          riskLevel: plan?.risk ?? 'medium',
          createdAt: approval.createdAt,
        };
      }),
    );
    return c.json({ approvals });
  });

  // POST /api/approvals/:id/approve
  app.post('/api/approvals/:id/approve', async (c) => {
    const { id } = c.req.param();
    await store.decideApproval(id, 'approved');
    const apprv = await store.getApproval(id);
    if (apprv) {
      await store.updateJobStatus(apprv.jobId, 'queued');
    }
    return c.json({ id, decision: 'approved' });
  });

  // POST /api/approvals/:id/deny
  app.post('/api/approvals/:id/deny', async (c) => {
    const { id } = c.req.param();
    await store.decideApproval(id, 'denied');
    const apprv = await store.getApproval(id);
    if (apprv) {
      await store.updateJobStatus(apprv.jobId, 'failed', 'plan denied by user');
    }
    return c.json({ id, decision: 'denied' });
  });


  // GET /api/providers — list configured model providers
  app.get('/api/providers', (c) => {
    const routes = router.allRoutes();
    return c.json({
      providers: PROVIDERS.map((provider) => ({
        name: provider.name,
        label: provider.label,
        status: provider.name === 'ollama' || (provider.envKey && process.env[provider.envKey])
          ? 'connected'
          : 'not_configured',
        description: provider.description,
        models: [...new Set(routes.filter((r) => r.provider === provider.name).map((r) => r.model))],
      })),
    });
  });

  // POST /api/providers/:name/configure
  app.post('/api/providers/:name/configure', async (c) => {
    const { name } = c.req.param();
    const provider = PROVIDERS.find((p) => p.name === name);
    if (!provider) return c.json({ error: 'unknown provider' }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const { apiKey } = body as { apiKey?: string };
    if (provider.envKey && typeof apiKey === 'string' && apiKey.trim()) {
      const trimmed = apiKey.trim();
      // Apply to the live process immediately and persist it durably so the
      // key survives a daemon restart (loaded back at startup).
      process.env[provider.envKey] = trimmed;
      await secrets.set(provider.envKey, trimmed);
    }
    return c.json({ name, configured: provider.name === 'ollama' || Boolean(provider.envKey && process.env[provider.envKey]) });
  });

  // GET /api/routing
  app.get('/api/routing', (c) => {
    return c.json({ routes: router.allRoutes(), config: router.getConfig() });
  });

  // PUT /api/routing/:task
  app.put('/api/routing/:task', async (c) => {
    const task = c.req.param('task') as TaskKind;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const { provider, model } = body as { provider?: string; model?: string };
    if (!provider || !model) {
      return c.json({ error: 'provider and model required' }, 400);
    }
    const route: ModelRoute = { provider, model };
    router.updateRoute(task, route);
    const configPath = join(dataDir, 'routing.json');
    await saveRoutingConfig(configPath, router.getConfig());
    return c.json({ task, route });
  });

  // GET /api/channels
  app.get('/api/channels', async (c) => {
    return c.json({ channels: await channelConfig.listChannels() });
  });

  // POST /api/channels/:name/configure
  app.post('/api/channels/:name/configure', async (c) => {
    const { name } = c.req.param();
    if (!isKnownChannelName(name)) return c.json({ error: 'unknown channel' }, 400);
    try {
      await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    return c.json(await channelConfig.configureChannel(name));
  });

  // POST /api/channels/:name/pairing/verify
  app.post('/api/channels/:name/pairing/verify', async (c) => {
    const { name } = c.req.param();
    if (!isKnownChannelName(name)) return c.json({ error: 'unknown channel' }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const { code } = body as { code?: string };
    if (typeof code !== 'string' || !code.trim()) {
      return c.json({ error: 'pairing code required' }, 400);
    }

    const result = await channelConfig.verifyPairingCode(name, code);
    return c.json(result, result.paired ? 200 : 400);
  });

  // GET /api/settings
  app.get('/api/settings', (c) => {
    return c.json({
      workspacePath: dataDir,
      modelRoutes: router.allRoutes().map((route) => ({
        taskType: route.task,
        provider: route.provider,
        model: route.model,
      })),
      daemonStatus: 'running',
    });
  });

  // POST /api/daemon/restart
  app.post('/api/daemon/restart', (c) => {
    return c.json({ restart: 'not_supported_in_process', message: 'Restart Helmr from the CLI to reload the daemon.' }, 202);
  });

  // GET /api/config/:file
  app.get('/api/config/:file', async (c) => {
    const file = c.req.param('file') as Parameters<typeof configManager.read>[0];
    try {
      const content = await configManager.read(file);
      return c.json({ file, content });
    } catch {
      return c.json({ error: 'not found' }, 404);
    }
  });

  // PUT /api/config/:file
  app.put('/api/config/:file', async (c) => {
    const file = c.req.param('file') as Parameters<typeof configManager.write>[0];
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const { content } = body as { content?: string };
    if (typeof content !== 'string') {
      return c.json({ error: 'content string required' }, 400);
    }
    await configManager.write(file, content);
    return c.json({ file, saved: true });
  });

  // GET /api/skills — list Helmr's auto-discovered skills
  app.get('/api/skills', async (c) => {
    return c.json({ skills: await skills.list() });
  });

  // POST /api/skills — owner creates or updates a skill directly from Hatchery
  app.post('/api/skills', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    let manifest;
    try {
      manifest = parseSkillManifest(body);
    } catch (err) {
      return c.json({ error: `invalid skill manifest: ${(err as Error).message}` }, 400);
    }
    return c.json({ skill: await skills.write(manifest) });
  });

  // POST /api/skills/:id/enabled — toggle a skill on or off
  app.post('/api/skills/:id/enabled', async (c) => {
    const { id } = c.req.param();
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const { enabled } = body as { enabled?: boolean };
    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'enabled boolean required' }, 400);
    }
    const updated = await skills.setEnabled(id, enabled);
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ skill: updated });
  });

  // DELETE /api/skills/:id — remove a skill
  app.delete('/api/skills/:id', async (c) => {
    const removed = await skills.remove(c.req.param('id'));
    if (!removed) return c.json({ error: 'not found' }, 404);
    return c.json({ removed: true });
  });

  // GET /api/agents — live embodied agents and their bodies/status
  app.get('/api/agents', (c) => {
    return c.json({ agents: agents?.snapshot() ?? [] });
  });

  // GET /api/tasks — the task ledger (what every agent is doing)
  app.get('/api/tasks', (c) => {
    return c.json({ tasks: agents?.ledger.all() ?? [] });
  });

  // GET /api/self-test
  app.get('/api/self-test', async (c) => {
    const checks = await runSelfTest();
    const passed = checks.every((ch) => ch.passed);
    return c.json({ passed, checks }, passed ? 200 : 503);
  });

  // GET /health
  app.get('/health', (c) => c.json({ ok: true }));

  return app;
}

async function runSelfTest(): Promise<Array<{ name: string; passed: boolean; detail?: string }>> {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];

  const nodeMajor = parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  checks.push({ name: 'node_version', passed: nodeMajor >= 22, detail: process.versions.node });

  try {
    await import('@mastra/core/mastra');
    checks.push({ name: 'mastra_runtime', passed: true });
  } catch (err) {
    checks.push({ name: 'mastra_runtime', passed: false, detail: String(err) });
  }

  try {
    const { createClient } = await import('@libsql/client');
    const db = createClient({ url: 'file::memory:' });
    await db.execute('SELECT 1');
    checks.push({ name: 'sqlite', passed: true });
  } catch (err) {
    checks.push({ name: 'sqlite', passed: false, detail: String(err) });
  }

  try {
    const { evaluatePlan } = await import('../../cortex/src/policy.js');
    const result = evaluatePlan({
      id: 'test', jobId: 'test', summary: 'test', risk: 'low',
      requiresApproval: false,
      steps: [{ id: 's1', title: 'read', kind: 'read', agent: 'research', canRunInParallelWith: [], requiredCapabilities: ['workspace_read'] }],
    });
    checks.push({ name: 'cortex_policy', passed: result !== undefined });
  } catch (err) {
    checks.push({ name: 'cortex_policy', passed: false, detail: String(err) });
  }

  return checks;
}

export async function startHatcheryServer(options: HatcheryServerOptions = {}): Promise<{ close: () => Promise<void> }> {
  const port = options.port ?? HATCHERY_PORT;
  const paths = getHelmrPaths();
  const dataDir = options.dataDir ?? paths.dataDir;
  const configDir = options.configDir ?? paths.configDir;

  const store = new HelmrSQLiteStore(join(dataDir, 'helmr.db'));
  await store.init();

  const routingPath = join(dataDir, 'routing.json');
  const router = await ModelRouter.fromFile(routingPath).catch(() => new ModelRouter(DEFAULT_ROUTING));

  const configManager = new ConfigFileManager(configDir);
  await configManager.init();

  // Restore persisted provider keys into the environment before serving.
  await new SecretStore(configDir).loadInto(process.env);

  // Share the process-wide embodied-agent runtime so the Agents page reflects
  // whatever the orchestrator spawns in this process.
  const { getAgentRuntime } = await import('../../../src/agent-runtime.js');
  const app = createHatcheryApp(store, router, configManager, dataDir, getAgentRuntime());
  const nodeServer = serve({ fetch: app.fetch, port });

  // Hot-reload: keep a live snapshot of skills so newly created ones are picked
  // up the instant they land, with no restart.
  const stopSkillWatch = new SkillRegistry(globalSkillsDir(dataDir)).watch();

  return {
    close: async () => {
      stopSkillWatch();
      await new Promise<void>((resolve) => nodeServer.close(() => resolve()));
    },
  };
}
