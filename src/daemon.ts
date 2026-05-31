import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink, access } from 'node:fs/promises';

import { startGatewayServer } from '../packages/gateway/src/http-server.js';
import { startHatcheryServer } from '../packages/hatchery-api/src/server.js';
import { HelmrSQLiteStore } from '../packages/memory/src/sqlite-store.js';
import { DreamJournal, synthesizeDream } from '../packages/memory/src/dream.js';
import {
  ChannelSupervisor,
  ChannelConfigStore,
  buildConfiguredAdapters,
  createChannelHealingProbe,
  createChannelRemediation,
} from '../packages/channels/src/index.js';
import {
  SelfHealingAgent,
  createJobHealingProbe,
  createJobRemediation,
  createReplanProbe,
  createReplanRemediation,
} from '../packages/scheduler/src/index.js';
import type { HelmrEvent } from '../packages/shared/src/index.js';
import { getHelmrPaths } from './paths.js';
import { loadPersistedSecrets } from './secrets.js';

const HEAL_INTERVAL_MS = 15_000;
const DREAM_IDLE_TICKS = 5; // ~10s idle at the 2s worker tick
const DREAM_THROTTLE_MS = 60_000;

export interface DaemonOptions {
  dataDir?: string;
  configDir?: string;
  gatewayPort?: number;
  hatcheryPort?: number;
}

export type DaemonService = 'gateway' | 'hatchery';
export type DaemonTarget = DaemonService | 'all';

export interface DaemonPidRecord {
  pid: number;
  gatewayPort?: number;
  hatcheryPort?: number;
}

const helmrDir = getHelmrPaths().rootDir;
const getPidFile = (service: string) => join(helmrDir, `${service}.pid`);
const getLogFile = (service: string) => join(helmrDir, `${service}.log`);

export function getDaemonPidServices(service: DaemonTarget): DaemonService[] {
  return service === 'all' ? ['gateway', 'hatchery'] : [service];
}

export function parsePidRecord(raw: string): DaemonPidRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Partial<DaemonPidRecord>;
    return typeof parsed.pid === 'number' ? { ...parsed, pid: parsed.pid } : null;
  }

  const pid = Number.parseInt(trimmed, 10);
  return Number.isNaN(pid) ? null : { pid };
}

export function renderServiceUrl(service: DaemonService, record: DaemonPidRecord): string {
  if (service === 'gateway') {
    return `  Gateway  http://localhost:${record.gatewayPort ?? 3999}`;
  }
  return `  Hatchery http://localhost:${record.hatcheryPort ?? 4000}`;
}

export async function startDaemon(
  options: DaemonOptions = {},
  service: DaemonTarget = 'all',
): Promise<void> {
  await mkdir(helmrDir, { recursive: true });

  // Restore provider keys persisted via Hatchery onboarding before agents run.
  const restoredSecrets = await loadPersistedSecrets();

  const logFile = getLogFile(service);
  const pidServices = getDaemonPidServices(service);

  for (const pidService of pidServices) {
    const existing = await readPidRecord(pidService);
    if (existing !== null) {
      try {
        process.kill(existing.pid, 0);
        console.log(`${pidService} daemon already running (pid ${existing.pid})`);
        return;
      } catch {
        await removePid(pidService);
      }
    }
  }

  const paths = getHelmrPaths();
  const dataDir = options.dataDir ?? paths.dataDir;
  const configDir = options.configDir ?? paths.configDir;
  const gatewayPort = options.gatewayPort ?? 3999;
  const hatcheryPort = options.hatcheryPort ?? 4000;

  const log = (msg: string): void => {
    const line = `${new Date().toISOString()} [${service}] ${msg}\n`;
    process.stdout.write(line);
    writeFile(logFile, line, { flag: 'a' }).catch(() => undefined);
  };

  log(`Starting ${service} daemon (pid ${process.pid})`);
  if (restoredSecrets.length > 0) {
    log(`Restored ${restoredSecrets.length} persisted provider key(s): ${restoredSecrets.join(', ')}`);
  }

  for (const pidService of pidServices) {
    await writePid(pidService, { pid: process.pid, gatewayPort, hatcheryPort });
  }

  let gateway: { close: () => Promise<void> } | null = null;
  let hatchery: { close: () => Promise<void> } | null = null;
  let workerInterval: NodeJS.Timeout | null = null;
  let healInterval: NodeJS.Timeout | null = null;
  let channels: ChannelSupervisor | null = null;
  let dreamLoop: ((queuedCount: number, runningCount: number) => Promise<void>) | null = null;

  const shutdown = async (): Promise<void> => {
    log('Shutting down...');
    if (workerInterval) clearInterval(workerInterval);
    if (healInterval) clearInterval(healInterval);
    await channels?.stop().catch(() => undefined);
    await gateway?.close().catch(() => undefined);
    await hatchery?.close().catch(() => undefined);
    for (const pidService of pidServices) {
      await removePid(pidService);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  try {
    if (service === 'all' || service === 'gateway') {
      gateway = await startGatewayServer({ port: gatewayPort, dataDir });
      log(`Gateway listening on :${gatewayPort}`);

      const storeForWorker = new HelmrSQLiteStore(join(dataDir, 'helmr.db'));
      await storeForWorker.init();

      workerInterval = setInterval(async () => {
        try {
          const queuedJobs = await storeForWorker.listJobs({ status: 'queued', limit: 1 });
          const targetJob = queuedJobs[0];
          if (targetJob && targetJob.payloadText && targetJob.workspacePath) {
            log(`[Worker] Found queued job ${targetJob.id}. Running...`);
            const { runJob } = await import('./runtime.js');
            runJob({
              text: targetJob.payloadText,
              workspacePath: targetJob.workspacePath,
              jobId: targetJob.id,
              onProgress: (msg) => log(`[Worker][${targetJob.id}] ${msg}`),
            }).then((res) => {
              log(`[Worker][${targetJob.id}] Completed with status: ${res.status}`);
            }).catch((err) => {
              log(`[Worker][${targetJob.id}] Execution failed: ${err instanceof Error ? err.message : String(err)}`);
            });
          }

          // Drive idle-time dreaming when the queue is drained.
          if (dreamLoop) {
            const runningJobs = await storeForWorker.listJobs({ status: 'running', limit: 1 });
            await dreamLoop(queuedJobs.length, runningJobs.length);
          }
        } catch (err) {
          log(`[Worker] Polling error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }, 2000);

      log('Gateway and background job worker ready');

      const enqueueChannelEvent = async (event: HelmrEvent): Promise<void> => {
        const now = new Date().toISOString();
        await storeForWorker.upsertJob({
          id: `job_${randomUUID()}`,
          eventId: event.id,
          workspaceId: event.workspace.id,
          status: 'queued',
          lane: 'interactive',
          priority: 50,
          attempts: 0,
          maxAttempts: 3,
          createdAt: now,
          updatedAt: now,
          payloadText: event.payload.text,
          workspacePath: event.workspace.path,
        });
        log(`[Channels] Queued job from ${event.principal.id}`);
      };

      channels = new ChannelSupervisor({
        enqueue: enqueueChannelEvent,
        loadAdapters: async (emit) => {
          const configStore = new ChannelConfigStore(dataDir, {
            webchatEndpoint: `http://localhost:${gatewayPort}`,
          });
          const views = await configStore.listChannels();
          return buildConfiguredAdapters({ views, env: process.env, emit, log });
        },
        log: (msg) => log(`[Channels] ${msg}`),
      });

      const startedChannels = await channels.start();
      const running = startedChannels.filter((c) => c.started).map((c) => c.kind);
      log(running.length > 0
        ? `Channels live: ${running.join(', ')}`
        : 'No paired channels configured (use Hatchery onboarding to add some)');

      // --- Self-healing agent (MAPE-K closed loop, fully autonomous) ---
      const channelSource = channels;
      const healer = new SelfHealingAgent({
        probes: [
          createJobHealingProbe({ store: storeForWorker }),
          createReplanProbe({ store: storeForWorker }),
          createChannelHealingProbe(channelSource),
        ],
        remediations: [
          createJobRemediation({ store: storeForWorker }),
          createReplanRemediation({ store: storeForWorker }),
          createChannelRemediation(channelSource),
        ],
        log: (msg) => log(`[SelfHeal] ${msg}`),
      });

      const runHealCycle = async (): Promise<number> => {
        try {
          const report = await healer.runCycle();
          if (report.detected > 0) {
            log(`[SelfHeal] detected ${report.detected}, healed ${report.healed}, escalated ${report.escalated}`);
          }
          return report.detected;
        } catch (err) {
          log(`[SelfHeal] cycle error: ${err instanceof Error ? err.message : String(err)}`);
          return 0;
        }
      };

      healInterval = setInterval(() => { void runHealCycle(); }, HEAL_INTERVAL_MS);
      log('Self-healing agent active');

      // --- Dreaming: idle-time reflection that proposes heals ---
      const dreamJournal = new DreamJournal(dataDir);
      let idleTicks = 0;
      let lastDreamAt = 0;

      const maybeDream = async (): Promise<void> => {
        const recent = await storeForWorker.listJobs({ limit: 20 });
        const dream = synthesizeDream({
          recentJobs: recent.map((j) => ({
            id: j.id,
            status: j.status,
            payloadText: j.payloadText,
            lastError: j.lastError,
            updatedAt: j.updatedAt,
          })),
        });
        await dreamJournal.record(dream);
        log(`[Dream] ${dream.reflection}`);
        for (const suggestion of dream.suggestions) log(`[Dream] suggestion: ${suggestion}`);
        // Dreams propose heals: if the reflection saw failures, wake the healer.
        if (recent.some((j) => j.status === 'failed')) {
          log('[Dream] failures recalled — invoking self-healing');
          await runHealCycle();
        }
      };

      dreamLoop = async (queuedCount: number, runningCount: number): Promise<void> => {
        if (queuedCount > 0 || runningCount > 0) { idleTicks = 0; return; }
        idleTicks += 1;
        if (idleTicks < DREAM_IDLE_TICKS) return;
        if (Date.now() - lastDreamAt < DREAM_THROTTLE_MS) return;
        lastDreamAt = Date.now();
        await maybeDream();
      };
    }

    if (service === 'all' || service === 'hatchery') {
      hatchery = await startHatcheryServer({ port: hatcheryPort, dataDir, configDir });
      log(`Hatchery API listening on :${hatcheryPort}`);
    }

    log(`${service} service ready`);
  } catch (err) {
    log(`Startup failed: ${err instanceof Error ? err.message : String(err)}`);
    if (workerInterval) clearInterval(workerInterval);
    for (const pidService of pidServices) {
      await removePid(pidService);
    }
    process.exit(1);
  }
}

export async function stopDaemon(service: DaemonTarget = 'all'): Promise<void> {
  for (const pidService of getDaemonPidServices(service)) {
    const record = await readPidRecord(pidService);
    if (record === null) {
      console.log(`No ${pidService} daemon running`);
      continue;
    }
    try {
      process.kill(record.pid, 'SIGTERM');
      console.log(`Sent SIGTERM to ${pidService} daemon (pid ${record.pid})`);
    } catch {
      console.log(`${pidService} daemon process ${record.pid} not found - removing stale PID`);
      await removePid(pidService);
    }
  }
}

export async function daemonStatus(service: DaemonTarget = 'all'): Promise<void> {
  for (const pidService of getDaemonPidServices(service)) {
    const record = await readPidRecord(pidService);
    if (record === null) {
      console.log(`${pidService} daemon: stopped`);
      continue;
    }
    try {
      process.kill(record.pid, 0);
      console.log(`${pidService} daemon: running (pid ${record.pid})`);
      console.log(renderServiceUrl(pidService, record));
    } catch {
      console.log(`${pidService} daemon: stale PID ${record.pid} (process not found)`);
      await removePid(pidService);
    }
  }
}

async function writePid(service: string, record: DaemonPidRecord): Promise<void> {
  await writeFile(getPidFile(service), JSON.stringify(record), 'utf8');
}

async function readPidRecord(service: string): Promise<DaemonPidRecord | null> {
  try {
    const pidFile = getPidFile(service);
    await access(pidFile);
    const raw = await readFile(pidFile, 'utf8');
    return parsePidRecord(raw);
  } catch {
    return null;
  }
}

async function removePid(service: string): Promise<void> {
  await unlink(getPidFile(service)).catch(() => undefined);
}
