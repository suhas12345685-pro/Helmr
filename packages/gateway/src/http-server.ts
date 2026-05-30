import { Hono } from 'hono';
import { createAdaptorServer } from '@hono/node-server';
import { WebSocketServer, type WebSocket } from 'ws';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { normalizeApiEvent } from './normalize-event.js';
import { HelmrSQLiteStore } from '../../memory/src/sqlite-store.js';
import { ModelRouter } from '../../router/src/model-router.js';
import { DEFAULT_ROUTING } from '../../router/src/routing-config.js';
import { evaluateApiAuth } from '../../shared/src/http-auth.js';
import {
  DEFAULT_HEADERS_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  evaluateContentLength,
  getHttpTimeoutMs,
  getMaxBodyBytes,
} from '../../shared/src/http-limits.js';
import { securityHeaders } from '../../shared/src/http-security.js';
import { normalizeRequestId } from '../../shared/src/request-id.js';
import { createFixedWindowRateLimiter, getRateLimitPerMinute } from '../../shared/src/rate-limit.js';
import { getHelmrPaths } from '../../../src/paths.js';

export interface GatewayServerOptions {
  port?: number;
  dataDir?: string;
}

const GATEWAY_PORT = 3999;
const gatewayRateLimiter = createFixedWindowRateLimiter({
  limit: getRateLimitPerMinute(process.env['HELMR_RATE_LIMIT_PER_MINUTE']),
  windowMs: 60_000,
});

export function createGatewayApp(store: HelmrSQLiteStore, router: ModelRouter): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.header('Content-Type', 'application/json');
    c.header('X-Request-Id', normalizeRequestId(c.req.header('x-request-id')));
    for (const [name, value] of Object.entries(securityHeaders)) {
      c.header(name, value);
    }
    const sizeDecision = evaluateContentLength(
      c.req.header('content-length'),
      getMaxBodyBytes(process.env['HELMR_MAX_BODY_BYTES']),
    );
    if (!sizeDecision.allowed) {
      return c.json({ error: sizeDecision.error }, sizeDecision.status);
    }
    const rateLimit = gatewayRateLimiter.check(c.req.header('x-forwarded-for') ?? 'local');
    c.header('X-RateLimit-Remaining', String(rateLimit.remaining));
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      return c.json({ error: 'rate limit exceeded' }, 429);
    }
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

  // POST /api/events — intake a new event and queue a job
  app.post('/api/events', async (c) => {
    let body: unknown;
    try {
      body = await readJsonBodyWithLimit(c.req.raw, getMaxBodyBytes(process.env['HELMR_MAX_BODY_BYTES']));
    } catch (err) {
      if (err instanceof BodyLimitError) {
        return c.json({ error: err.message }, 413);
      }
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    let event;
    try {
      event = normalizeApiEvent({ body: body as Parameters<typeof normalizeApiEvent>[0]['body'] });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'invalid event' }, 400);
    }

    const now = new Date().toISOString();
    const job = {
      id: `job_${randomUUID()}`,
      eventId: event.id,
      workspaceId: event.workspace.id,
      status: 'queued' as const,
      lane: 'interactive' as const,
      priority: 50,
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
      payloadText: event.payload.text,
      workspacePath: event.workspace.path,
    };

    await store.upsertJob(job);


    return c.json({ jobId: job.id, eventId: event.id, status: 'queued' }, 202);
  });

  // GET /api/jobs
  app.get('/api/jobs', async (c) => {
    const rawStatus = c.req.query('status') as import('../../shared/src/index.js').HelmrJob['status'] | undefined;
    const jobs = await store.listJobs({ status: rawStatus, limit: 50 });
    return c.json({ jobs });
  });

  // GET /api/jobs/:id
  app.get('/api/jobs/:id', async (c) => {
    const job = await store.getJob(c.req.param('id'));
    if (!job) return c.json({ error: 'not found' }, 404);
    return c.json({ job });
  });

  // GET /api/approvals
  app.get('/api/approvals', async (c) => {
    const approvals = await store.getPendingApprovals();
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


  // GET /api/providers
  app.get('/api/providers', (c) => {
    const routes = router.allRoutes();
    return c.json({
      providers: [
        {
          name: 'anthropic',
          configured: false,
          models: [...new Set(routes.filter((r) => r.provider === 'anthropic').map((r) => r.model))],
        },
      ],
    });
  });

  // POST /api/providers/:name/configure
  app.post('/api/providers/:name/configure', async (c) => {
    const { name } = c.req.param();
    if (name !== 'anthropic') {
      return c.json({ error: 'unknown provider' }, 400);
    }
    // API keys must be set via environment, not via HTTP — reject
    return c.json({ error: 'configure providers from Hatchery onboarding or your runtime environment' }, 400);
  });

  // GET /api/channels
  app.get('/api/channels', (c) => {
    return c.json({
      channels: [
        { id: 'webchat', kind: 'webchat', status: 'active' },
        { id: 'telegram', kind: 'telegram', status: 'not_configured' },
        { id: 'discord', kind: 'discord', status: 'not_configured' },
        { id: 'slack', kind: 'slack', status: 'not_configured' },
      ],
    });
  });

  // GET /api/self-test
  app.get('/api/self-test', async (c) => {
    const checks = await runSelfTestChecks();
    const allPassed = checks.every((ch) => ch.passed);
    return c.json({ passed: allPassed, checks }, allPassed ? 200 : 503);
  });

  // GET /health
  app.get('/health', (c) => c.json({ ok: true }));

  return app;
}


async function readJsonBodyWithLimit(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.body) {
    return {};
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        throw new BodyLimitError('request body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

class BodyLimitError extends Error {}

async function runSelfTestChecks(): Promise<Array<{ name: string; passed: boolean; detail?: string }>> {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];

  // Node version
  const nodeMajor = parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  checks.push({ name: 'node_version', passed: nodeMajor >= 18, detail: process.versions.node });

  // Mastra import
  try {
    await import('@mastra/core/mastra');
    checks.push({ name: 'mastra_import', passed: true });
  } catch (err) {
    checks.push({ name: 'mastra_import', passed: false, detail: String(err) });
  }

  // SQLite
  try {
    const { createClient } = await import('@libsql/client');
    const db = createClient({ url: 'file::memory:' });
    await db.execute('SELECT 1');
    checks.push({ name: 'sqlite', passed: true });
  } catch (err) {
    checks.push({ name: 'sqlite', passed: false, detail: String(err) });
  }

  return checks;
}

export async function startGatewayServer(options: GatewayServerOptions = {}): Promise<{ close: () => Promise<void> }> {
  const port = options.port ?? GATEWAY_PORT;
  const dataDir = options.dataDir ?? getHelmrPaths().dataDir;

  const store = new HelmrSQLiteStore(join(dataDir, 'helmr.db'));
  await store.init();

  const router = new ModelRouter(DEFAULT_ROUTING);
  const app = createGatewayApp(store, router);

  // Use createAdaptorServer so we can attach WebSocket to the same http.Server
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const httpServer = createAdaptorServer({ fetch: app.fetch }) as any;
  httpServer.headersTimeout = getHttpTimeoutMs(
    process.env['HELMR_HEADERS_TIMEOUT_MS'],
    DEFAULT_HEADERS_TIMEOUT_MS,
  );
  httpServer.requestTimeout = getHttpTimeoutMs(
    process.env['HELMR_REQUEST_TIMEOUT_MS'],
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
  httpServer.keepAliveTimeout = Math.min(httpServer.requestTimeout, 5_000);

  const wss = new WebSocketServer({ server: httpServer });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'connected', message: 'Helmr WebChat ready' }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; text?: string };
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));

  return {
    close: async () => {
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
