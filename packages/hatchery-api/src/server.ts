import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { HelmrSQLiteStore, type HelmrStoreJob } from '../../memory/src/sqlite-store.js';
import { ModelRouter } from '../../router/src/model-router.js';
import { DEFAULT_ROUTING, saveRoutingConfig, type ModelRoute, type TaskKind } from '../../router/src/routing-config.js';
import { ConfigFileManager } from '../../config/src/config-files.js';
import type { HelmrPlan } from '../../shared/src/index.js';
import { evaluateApiAuth } from '../../shared/src/http-auth.js';
import { evaluateContentLength, getMaxBodyBytes } from '../../shared/src/http-limits.js';
import { getAllowedOrigins, isOriginAllowed, securityHeaders } from '../../shared/src/http-security.js';
import { normalizeRequestId } from '../../shared/src/request-id.js';
import { createFixedWindowRateLimiter, getRateLimitPerMinute } from '../../shared/src/rate-limit.js';
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

function toUiJob(job: HelmrStoreJob, plan?: HelmrPlan | null) {
  return {
    id: job.id,
    status: uiStatus(job.status),
    planSummary: plan?.summary ?? job.payloadText ?? job.lastError ?? `${job.lane} job`,
    risk: plan?.risk ?? (job.lastError ? 'high' : 'low'),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    planSteps: plan?.steps.map((step) => step.title),
    result: job.lastError,
  };
}

function collectCapabilities(plan?: HelmrPlan | null): string {
  const capabilities = new Set(plan?.steps.flatMap((step) => step.requiredCapabilities) ?? []);
  return [...capabilities].join(', ') || 'approval';
}

export function createHatcheryApp(
  store: HelmrSQLiteStore,
  router: ModelRouter,
  configManager: ConfigFileManager,
  dataDir: string,
): Hono {
  const app = new Hono();

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

  // GET /api/jobs
  app.get('/api/jobs', async (c) => {
    const rawStatus = c.req.query('status') as import('../../shared/src/index.js').HelmrJob['status'] | undefined;
    const jobs = await store.listJobs({ status: rawStatus, limit: 100 });
    const withPlans = await Promise.all(
      jobs.map(async (job) => toUiJob(job, (await store.getPlan(job.id)) ?? null)),
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
    const plan = await store.getPlan(job.id);
    return c.json({ job: toUiJob(job, plan ?? null), plan: plan ?? null });
  });

  // GET /api/approvals
  app.get('/api/approvals', async (c) => {
    const pending = await store.getPendingApprovals();
    const approvals = await Promise.all(
      pending.map(async (approval) => {
        const job = await store.getJob(approval.jobId);
        const plan = await store.getPlan(approval.jobId);
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
      process.env[provider.envKey] = apiKey.trim();
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
  app.get('/api/channels', (c) => {
    return c.json({
      channels: [
        { name: 'webchat', label: 'WebChat', status: 'active', endpoint: `http://localhost:${HATCHERY_PORT}`, pairingState: 'paired' },
        { name: 'telegram', label: 'Telegram', status: 'not_configured', pairingState: 'unpaired' },
        { name: 'discord', label: 'Discord', status: 'not_configured', pairingState: 'unpaired' },
        { name: 'slack', label: 'Slack', status: 'not_configured', pairingState: 'unpaired' },
        { name: 'whatsapp', label: 'WhatsApp', status: 'not_configured', pairingState: 'unpaired' },
      ],
    });
  });

  // POST /api/channels/:name/configure
  app.post('/api/channels/:name/configure', async (c) => {
    const { name } = c.req.param();
    const known = new Set(['webchat', 'telegram', 'discord', 'slack', 'whatsapp']);
    if (!known.has(name)) return c.json({ error: 'unknown channel' }, 400);
    try {
      await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    return c.json({ name, status: name === 'webchat' ? 'active' : 'not_configured', pairingState: name === 'webchat' ? 'paired' : 'pending' });
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
  checks.push({ name: 'node_version', passed: nodeMajor >= 18, detail: process.versions.node });

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

  const app = createHatcheryApp(store, router, configManager, dataDir);
  const nodeServer = serve({ fetch: app.fetch, port });

  return {
    close: async () => {
      await new Promise<void>((resolve) => nodeServer.close(() => resolve()));
    },
  };
}
