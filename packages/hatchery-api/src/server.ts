import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { join } from 'node:path';

import { HelmrSQLiteStore, type HelmrStoreJob, type ChannelStateRecord } from '../../memory/src/sqlite-store.js';
import { ModelRouter } from '../../router/src/model-router.js';
import { DEFAULT_ROUTING, saveRoutingConfig, type ModelRoute, type TaskKind } from '../../router/src/routing-config.js';
import { ConfigFileManager } from '../../config/src/config-files.js';
import { SecretStore } from '../../config/src/secret-store.js';
import { PairingStore } from '../../channels/src/pairing.js';
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
  { name: 'perplexity', label: 'Perplexity', envKey: 'PERPLEXITY_API_KEY', description: 'Search-tuned models' },
  { name: 'ollama', label: 'Ollama', envKey: '', description: 'Local models' },
] as const;

const CHANNEL_CATALOG = [
  { name: 'webchat', label: 'WebChat', requiresPairing: false },
  { name: 'telegram', label: 'Telegram', requiresPairing: true },
  { name: 'discord', label: 'Discord', requiresPairing: true },
  { name: 'slack', label: 'Slack', requiresPairing: true },
  { name: 'whatsapp', label: 'WhatsApp', requiresPairing: true },
  { name: 'signal', label: 'Signal', requiresPairing: true },
  { name: 'teams', label: 'Microsoft Teams', requiresPairing: true },
  { name: 'google-chat', label: 'Google Chat', requiresPairing: true },
] as const;

type ChannelCatalogEntry = (typeof CHANNEL_CATALOG)[number];

function channelEntry(name: string): ChannelCatalogEntry | undefined {
  return CHANNEL_CATALOG.find((entry) => entry.name === name);
}

function redactSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

interface OnboardingState {
  complete: boolean;
  workspacePath?: string;
  deploymentProfile?: 'local' | 'wsl2' | 'vps' | 'container';
  completedAt?: string;
}

function defaultOnboardingState(): OnboardingState {
  return { complete: false };
}

const RESERVED_SECRET_KEYS = new Set([
  'botToken',
  'token',
  'apiToken',
  'appToken',
  'oauthToken',
  'serviceAccount',
  'webhookSecret',
  'apiKey',
  'sessionToken',
]);

function splitChannelPayload(body: Record<string, unknown>): {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
} {
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (RESERVED_SECRET_KEYS.has(key) && typeof value === 'string') {
      secrets[key] = value;
      continue;
    }
    config[key] = value;
  }
  return { config, secrets };
}

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

export interface CreateHatcheryAppDeps {
  store: HelmrSQLiteStore;
  router: ModelRouter;
  configManager: ConfigFileManager;
  dataDir: string;
  secretStore?: SecretStore;
  pairingStore?: PairingStore;
}

export function createHatcheryApp(
  storeOrDeps: HelmrSQLiteStore | CreateHatcheryAppDeps,
  routerArg?: ModelRouter,
  configManagerArg?: ConfigFileManager,
  dataDirArg?: string,
): Hono {
  const deps: CreateHatcheryAppDeps = storeOrDeps instanceof HelmrSQLiteStore
    ? { store: storeOrDeps, router: routerArg!, configManager: configManagerArg!, dataDir: dataDirArg! }
    : storeOrDeps;
  const { store, router, configManager, dataDir } = deps;
  const secretStore = deps.secretStore ?? new SecretStore(join(dataDir, 'secrets.json'));
  const pairingStore = deps.pairingStore ?? new PairingStore();
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
  app.get('/api/providers', async (c) => {
    const routes = router.allRoutes();
    const storedKeys = new Set(await secretStore.list());
    return c.json({
      providers: PROVIDERS.map((provider) => ({
        name: provider.name,
        label: provider.label,
        status: provider.name === 'ollama'
          || (provider.envKey && (process.env[provider.envKey] || storedKeys.has(provider.envKey)))
          ? 'connected'
          : 'not_configured',
        description: provider.description,
        envKey: provider.envKey || null,
        configured: provider.name === 'ollama' || (provider.envKey && storedKeys.has(provider.envKey)),
        models: [...new Set(routes.filter((r) => r.provider === provider.name).map((r) => r.model))],
      })),
    });
  });

  // POST /api/providers/:name/configure — persists credentials to the secret store (0600)
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
      await secretStore.set(provider.envKey, trimmed);
      process.env[provider.envKey] = trimmed;
    }
    const configured = provider.name === 'ollama'
      || Boolean(provider.envKey && process.env[provider.envKey]);
    return c.json({ name, configured });
  });

  // DELETE /api/providers/:name/configure — wipes a provider's stored credentials
  app.delete('/api/providers/:name/configure', async (c) => {
    const { name } = c.req.param();
    const provider = PROVIDERS.find((p) => p.name === name);
    if (!provider) return c.json({ error: 'unknown provider' }, 400);
    if (provider.envKey) {
      await secretStore.delete(provider.envKey);
      delete process.env[provider.envKey];
    }
    return c.json({ name, configured: false });
  });

  // POST /api/providers/:name/test — verifies a credential value without persisting it
  app.post('/api/providers/:name/test', async (c) => {
    const { name } = c.req.param();
    const provider = PROVIDERS.find((p) => p.name === name);
    if (!provider) return c.json({ error: 'unknown provider' }, 400);
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      // empty body means "test the currently stored key"
    }
    const candidate = ((body as { apiKey?: string }).apiKey ?? '').trim()
      || (provider.envKey ? (process.env[provider.envKey] ?? (await secretStore.get(provider.envKey)) ?? '') : '');
    if (provider.name === 'ollama') {
      return c.json({ name, ok: true, message: 'Ollama uses a local endpoint, no key required' });
    }
    if (!candidate) {
      return c.json({ name, ok: false, message: 'no credential supplied or stored' }, 400);
    }
    return c.json({
      name,
      ok: true,
      message: `credential present (${redactSecret(candidate)})`,
      redacted: redactSecret(candidate),
    });
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

  // GET /api/channels — merges the static catalog with persisted state
  app.get('/api/channels', async (c) => {
    const persisted = new Map((await store.listChannels()).map((row) => [row.name, row]));
    const channels = CHANNEL_CATALOG.map((entry) => {
      const row = persisted.get(entry.name);
      if (entry.name === 'webchat') {
        return {
          name: entry.name,
          label: entry.label,
          status: 'active',
          pairingState: 'paired',
          endpoint: `http://localhost:${HATCHERY_PORT}`,
          requiresPairing: false,
        };
      }
      return {
        name: entry.name,
        label: entry.label,
        status: row?.status ?? 'not_configured',
        pairingState: row?.pairingState ?? 'unpaired',
        requiresPairing: entry.requiresPairing,
        configured: Boolean(row?.config),
      };
    });
    return c.json({ channels });
  });

  // POST /api/channels/:name/configure — persists channel credentials (secrets stored separately)
  app.post('/api/channels/:name/configure', async (c) => {
    const { name } = c.req.param();
    const entry = channelEntry(name);
    if (!entry) return c.json({ error: 'unknown channel' }, 400);
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }

    const { config, secrets } = splitChannelPayload(body);

    if (secrets) {
      for (const [secretKey, secretValue] of Object.entries(secrets)) {
        if (typeof secretValue === 'string' && secretValue.trim()) {
          await secretStore.set(`CHANNEL_${name.toUpperCase()}_${secretKey.toUpperCase()}`, secretValue.trim());
        }
      }
    }

    const existing = await store.getChannel(name);
    const record: ChannelStateRecord = {
      name,
      status: entry.name === 'webchat' ? 'active' : 'configured',
      pairingState: entry.requiresPairing ? existing?.pairingState ?? 'unpaired' : 'paired',
      config: Object.keys(config).length ? config : existing?.config,
      adminId: existing?.adminId,
      pairedAt: existing?.pairedAt,
    };
    await store.upsertChannel(record);

    return c.json({
      name,
      status: record.status,
      pairingState: record.pairingState,
      requiresPairing: entry.requiresPairing,
    });
  });

  // POST /api/channels/:name/start-pairing — issues a single-use pairing code (10 min TTL)
  app.post('/api/channels/:name/start-pairing', async (c) => {
    const { name } = c.req.param();
    const entry = channelEntry(name);
    if (!entry) return c.json({ error: 'unknown channel' }, 400);
    if (!entry.requiresPairing) {
      return c.json({ error: 'channel does not require pairing' }, 400);
    }
    let body: { adminId?: string } = {};
    try {
      body = (await c.req.json()) as { adminId?: string };
    } catch {
      // adminId optional
    }
    const adminId = (body.adminId ?? '').trim();
    if (!adminId) {
      return c.json({ error: 'adminId is required to start pairing' }, 400);
    }

    const pair = pairingStore.create(adminId);
    const existing = await store.getChannel(name);
    await store.upsertChannel({
      name,
      status: existing?.status ?? 'configured',
      pairingState: 'pending',
      config: existing?.config,
      adminId,
    });

    return c.json({
      name,
      code: pair.code,
      expiresAt: pair.expiresAt,
      adminId,
      pairingState: 'pending',
    });
  });

  // POST /api/channels/:name/complete-pairing — consumes a code and marks the channel paired
  app.post('/api/channels/:name/complete-pairing', async (c) => {
    const { name } = c.req.param();
    const entry = channelEntry(name);
    if (!entry) return c.json({ error: 'unknown channel' }, 400);
    if (!entry.requiresPairing) {
      return c.json({ error: 'channel does not require pairing' }, 400);
    }
    let body: { code?: string } = {};
    try {
      body = (await c.req.json()) as { code?: string };
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const code = (body.code ?? '').trim().toUpperCase();
    if (!code) return c.json({ error: 'pairing code is required' }, 400);

    const adminId = pairingStore.consume(code);
    if (!adminId) {
      return c.json({ error: 'invalid, used, or expired pairing code' }, 400);
    }

    const existing = await store.getChannel(name);
    const record: ChannelStateRecord = {
      name,
      status: 'active',
      pairingState: 'paired',
      config: existing?.config,
      adminId,
      pairedAt: new Date().toISOString(),
    };
    await store.upsertChannel(record);
    return c.json({ name, pairingState: 'paired', adminId, pairedAt: record.pairedAt });
  });

  // GET /api/onboarding/state — Hatchery onboarding progress + readiness
  app.get('/api/onboarding/state', async (c) => {
    const state = (await store.getSystemState<OnboardingState>('onboarding')) ?? defaultOnboardingState();
    const storedKeys = new Set(await secretStore.list());
    const providerKeys = PROVIDERS.filter(
      (p) => p.envKey && (process.env[p.envKey] || storedKeys.has(p.envKey)),
    ).map((p) => p.name);
    return c.json({
      ...state,
      providersConfigured: providerKeys,
      hasAnyProvider: providerKeys.length > 0,
    });
  });

  // POST /api/onboarding/complete — marks onboarding done and persists workspace path
  app.post('/api/onboarding/complete', async (c) => {
    let body: Partial<OnboardingState> = {};
    try {
      body = (await c.req.json()) as Partial<OnboardingState>;
    } catch {
      // empty body permitted
    }
    const next: OnboardingState = {
      complete: true,
      workspacePath: typeof body.workspacePath === 'string' && body.workspacePath.trim()
        ? body.workspacePath.trim()
        : dataDir,
      deploymentProfile:
        body.deploymentProfile && ['local', 'wsl2', 'vps', 'container'].includes(body.deploymentProfile)
          ? body.deploymentProfile
          : 'local',
      completedAt: new Date().toISOString(),
    };
    await store.setSystemState('onboarding', next);
    return c.json(next);
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

  const secretStore = new SecretStore(join(dataDir, 'secrets.json'));
  await secretStore.load();
  await secretStore.applyToEnv();
  const pairingStore = new PairingStore();

  const app = createHatcheryApp({ store, router, configManager, dataDir, secretStore, pairingStore });
  const nodeServer = serve({ fetch: app.fetch, port });

  return {
    close: async () => {
      await new Promise<void>((resolve) => nodeServer.close(() => resolve()));
    },
  };
}
