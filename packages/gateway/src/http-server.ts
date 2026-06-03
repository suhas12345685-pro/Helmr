import { Hono } from 'hono';
import { createAdaptorServer } from '@hono/node-server';
import { WebSocketServer, type WebSocket } from 'ws';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { normalizeApiEvent } from './normalize-event.js';
import { ChannelConfigStore } from '../../channels/src/channel-config.js';
import { HelmrSQLiteStore } from '../../memory/src/sqlite-store.js';
import { ModelRouter } from '../../router/src/model-router.js';
import { DEFAULT_ROUTING } from '../../router/src/routing-config.js';
import { evaluateApiAuth, safeTokenEquals } from '../../shared/src/http-auth.js';
import { makeErrorMessage, makeGatewayMessage, safeParseGatewayMessage, HELMR_PROTOCOL_VERSION } from '../../protocol/src/index.js';
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
  host?: string;
}

export interface GatewayAppOptions {
  dataDir?: string;
  gatewayPort?: number;
  bindHost?: string;
}

const GATEWAY_PORT = 3999;
const gatewayRateLimiter = createFixedWindowRateLimiter({
  limit: getRateLimitPerMinute(process.env['HELMR_RATE_LIMIT_PER_MINUTE']),
  windowMs: 60_000,
});

export function createGatewayApp(store: HelmrSQLiteStore, router: ModelRouter, options: GatewayAppOptions = {}): Hono {
  const app = new Hono();
  const channelConfig = options.dataDir
    ? new ChannelConfigStore(options.dataDir, {
        webchatEndpoint: `http://localhost:${options.gatewayPort ?? GATEWAY_PORT}`,
      })
    : null;

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
      nodeEnv: process.env['NODE_ENV'],
      helmrProduction: process.env['HELMR_PRODUCTION'],
      requireAuth: process.env['HELMR_REQUIRE_AUTH'],
      authMode: process.env['HELMR_AUTH_MODE'],
      bindHost: options.bindHost ?? process.env['HELMR_BIND_HOST'],
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

  // GET /api/channels — backed by the same persisted config Hatchery uses,
  // so the Gateway never reports a stale or contradictory channel list.
  app.get('/api/channels', async (c) => {
    if (!channelConfig) {
      return c.json({ channels: [] });
    }
    return c.json({ channels: await channelConfig.listChannels() });
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
  const host = options.host ?? process.env['HELMR_BIND_HOST'];
  const dataDir = options.dataDir ?? getHelmrPaths().dataDir;

  const store = new HelmrSQLiteStore(join(dataDir, 'helmr.db'));
  await store.init();

  const router = new ModelRouter(DEFAULT_ROUTING);
  const app = createGatewayApp(store, router, { dataDir, gatewayPort: port, bindHost: host });

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
    let authenticated = false;
    ws.send(JSON.stringify(makeGatewayMessage('HELLO', {
      server: 'Helmr Gateway',
      protocolVersion: HELMR_PROTOCOL_VERSION,
      capabilities: ['heartbeat', 'job-status', 'approval-events'],
    }, { correlationId: `corr_${randomUUID()}` })));

    ws.on('message', (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        ws.send(JSON.stringify(makeErrorMessage('invalid_json', 'WebSocket frame must be valid JSON.')));
        return;
      }

      const parsed = safeParseGatewayMessage(raw);
      if (!parsed.ok) {
        ws.send(JSON.stringify(makeErrorMessage('invalid_protocol', parsed.error)));
        return;
      }

      const message = parsed.message;
      if (message.type === 'AUTH') {
        const token = process.env['HELMR_API_TOKEN']?.trim();
        const supplied = String(message.payload['token'] ?? '');
        if (token && safeTokenEquals(supplied, token)) {
          authenticated = true;
          ws.send(JSON.stringify(makeGatewayMessage('RESPONSE', { authenticated: true }, { correlationId: message.id, requestId: message.requestId })));
        } else {
          ws.send(JSON.stringify(makeErrorMessage('unauthorized', 'Invalid Gateway token.', message.id)));
          ws.close(1008, 'unauthorized');
        }
        return;
      }

      if (message.type === 'HEARTBEAT') {
        ws.send(JSON.stringify(makeGatewayMessage('HEARTBEAT', { ok: true }, { correlationId: message.id, requestId: message.requestId })));
        return;
      }

      if (!authenticated && process.env['HELMR_API_TOKEN']) {
        ws.send(JSON.stringify(makeErrorMessage('unauthorized', 'Authenticate before using private Gateway streams.', message.id)));
        return;
      }

      if (message.type === 'REQUEST' && message.payload['jobId']) {
        ws.send(JSON.stringify(makeGatewayMessage('JOB_STATUS', { jobId: String(message.payload['jobId']), status: 'queued' }, { correlationId: message.id, requestId: message.requestId })));
        return;
      }

      ws.send(JSON.stringify(makeErrorMessage('invalid_protocol', `Unsupported message type for this Gateway path: ${message.type}`, message.id)));
    });

    ws.on('close', () => clients.delete(ws));
  });

  await new Promise<void>((resolve) => {
    if (host?.trim()) {
      httpServer.listen(port, host, resolve);
    } else {
      httpServer.listen(port, resolve);
    }
  });

  return {
    close: async () => {
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
