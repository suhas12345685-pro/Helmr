import type { HelmrEvent } from '../../shared/src/index.js';
import type { ChannelAdapter, ChannelInfo, EventEmitter } from './types.js';

export interface ChannelSupervisorDeps {
  /** Persist an inbound channel event as a queued job for the worker. */
  enqueue: (event: HelmrEvent) => Promise<void>;
  /** Build the adapters that should run, wiring each to the shared emitter. */
  loadAdapters: (emit: EventEmitter) => Promise<ChannelAdapter[]>;
  log?: (message: string) => void;
}

export interface SupervisedChannel {
  kind: string;
  name: string;
  started: boolean;
  reason?: string;
}

/**
 * Owns the lifecycle of every paired channel adapter. It funnels each
 * adapter's inbound events into the job queue and only starts adapters that
 * pairing has already activated, so an unpaired channel can never enqueue
 * jobs (architecture section 16.12).
 */
export class ChannelSupervisor {
  private adapters: ChannelAdapter[] = [];
  private started = false;
  private readonly results: SupervisedChannel[] = [];

  constructor(private readonly deps: ChannelSupervisorDeps) {}

  async start(): Promise<SupervisedChannel[]> {
    if (this.started) return this.results;
    this.started = true;

    const emit: EventEmitter = (event) => this.deps.enqueue(event);
    this.adapters = await this.deps.loadAdapters(emit);

    for (const adapter of this.adapters) {
      if (adapter.getStatus() !== 'active') {
        this.record(adapter, false, `skipped: ${adapter.getStatus()}`);
        this.log(`channel ${adapter.kind} not started (${adapter.getStatus()})`);
        continue;
      }
      try {
        await adapter.start();
        this.record(adapter, true);
        this.log(`channel ${adapter.kind} started`);
      } catch (err) {
        this.record(adapter, false, err instanceof Error ? err.message : String(err));
        this.log(`channel ${adapter.kind} failed to start: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return this.results;
  }

  async stop(): Promise<void> {
    for (const adapter of this.adapters) {
      try {
        await adapter.stop();
      } catch (err) {
        this.log(`channel ${adapter.kind} failed to stop cleanly: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.adapters = [];
    this.results.length = 0;
    this.started = false;
  }

  getRunning(): ChannelInfo[] {
    return this.adapters
      .filter((adapter) => adapter.getStatus() === 'active')
      .map((adapter) => adapter.getInfo());
  }

  private record(adapter: ChannelAdapter, started: boolean, reason?: string): void {
    this.results.push({ kind: adapter.kind, name: adapter.name, started, reason });
  }

  private log(message: string): void {
    this.deps.log?.(message);
  }
}
