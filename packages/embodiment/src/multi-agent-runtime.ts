import { randomUUID } from 'node:crypto';

import { InMemoryCoordinationBus } from './coordination-bus.js';
import { TaskLedger } from './task-ledger.js';
import { DEFAULT_PERMISSION_ZONES, permissionSet, type PermissionSet, type PermissionZone } from './permissions.js';
import type {
  AgentBody,
  AgentMemoryEntry,
  AgentMemoryLog,
  CoordinationBus,
  WorkspaceKind,
  WorkspaceProvider,
} from './types.js';

export type RuntimeMode = 'independent' | 'swarm';

export interface SpawnSpec {
  role: string;
  permissions?: PermissionZone[];
  workspaceKind?: WorkspaceKind;
  startUrl?: string;
  agentId?: string;
}

export interface AssignTaskSpec {
  taskId?: string;
  description: string;
}

export interface MultiAgentRuntimeOptions {
  mode?: RuntimeMode;
  bus?: CoordinationBus;
  ledger?: TaskLedger;
  /** Heartbeat staleness (ms) after which an agent is considered unhealthy. */
  heartbeatTimeoutMs?: number;
}

class InMemoryAgentMemory implements AgentMemoryLog {
  private readonly log: AgentMemoryEntry[] = [];
  append(kind: string, detail: unknown): void {
    this.log.push({ timestamp: new Date().toISOString(), kind, detail });
  }
  entries(): AgentMemoryEntry[] {
    return [...this.log];
  }
}

/**
 * Spins up and supervises many embodied agents. Each agent gets its own
 * workspace + eyes + keyboard + mouse from the provider, its own memory, and a
 * coordination channel on the shared bus. Agents can run independently in
 * parallel, or coordinate as a swarm — the orchestrator merges their results.
 *
 * Critically: no agent uses the Operator's real input devices. Every body is
 * isolated, and bodies are never shared between agents.
 */
export class MultiAgentRuntime {
  readonly mode: RuntimeMode;
  readonly bus: CoordinationBus;
  readonly ledger: TaskLedger;
  private readonly heartbeatTimeoutMs: number;
  private readonly bodies = new Map<string, AgentBody>();

  constructor(
    private readonly provider: WorkspaceProvider,
    options: MultiAgentRuntimeOptions = {},
  ) {
    this.mode = options.mode ?? 'independent';
    this.bus = options.bus ?? new InMemoryCoordinationBus();
    this.ledger = options.ledger ?? new TaskLedger();
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 30_000;
  }

  async spawnAgent(spec: SpawnSpec): Promise<AgentBody> {
    const agentId = spec.agentId ?? `agent_${randomUUID()}`;
    const permissions: PermissionSet = permissionSet(spec.permissions ?? DEFAULT_PERMISSION_ZONES);

    const handle = await this.provider.createWorkspace({
      agentId,
      role: spec.role,
      kind: spec.workspaceKind ?? this.provider.kind,
      startUrl: spec.startUrl,
      permissions,
    });

    const [vision, keyboard, mouse] = await Promise.all([
      this.provider.attachVision(handle.workspaceId),
      this.provider.attachKeyboard(handle.workspaceId),
      this.provider.attachMouse(handle.workspaceId),
    ]);

    const now = new Date().toISOString();
    const body: AgentBody = {
      agentId,
      role: spec.role,
      workspaceId: handle.workspaceId,
      vision,
      keyboard,
      mouse,
      browserSession: handle,
      taskState: { status: 'none' },
      memory: new InMemoryAgentMemory(),
      communicationChannel: this.bus.channelFor(agentId),
      permissions,
      status: 'idle',
      createdAt: now,
      lastHeartbeatAt: now,
    };
    body.memory.append('spawn', { role: spec.role, workspaceId: handle.workspaceId });
    this.bodies.set(agentId, body);
    return body;
  }

  async spawnAgents(specs: SpawnSpec[]): Promise<AgentBody[]> {
    return Promise.all(specs.map((spec) => this.spawnAgent(spec)));
  }

  get(agentId: string): AgentBody | undefined {
    return this.bodies.get(agentId);
  }

  list(): AgentBody[] {
    return [...this.bodies.values()];
  }

  status(agentId: string): AgentBody['status'] | undefined {
    return this.bodies.get(agentId)?.status;
  }

  assignTask(agentId: string, task: AssignTaskSpec): AgentBody {
    const body = this.require(agentId);
    const taskId = task.taskId ?? `task_${randomUUID()}`;
    if (!this.ledger.get(taskId)) this.ledger.createTask(taskId, task.description);
    this.ledger.assign(taskId, agentId, body.workspaceId);
    body.taskState = {
      taskId,
      description: task.description,
      status: 'assigned',
      startedAt: new Date().toISOString(),
    };
    body.status = 'working';
    body.memory.append('assign_task', { taskId, description: task.description });
    this.heartbeat(agentId);
    return body;
  }

  completeTask(agentId: string, result: unknown): AgentBody {
    const body = this.require(agentId);
    if (body.taskState.taskId) this.ledger.complete(body.taskState.taskId, result);
    body.taskState = {
      ...body.taskState,
      status: 'done',
      result,
      finishedAt: new Date().toISOString(),
    };
    body.status = 'idle';
    body.memory.append('complete_task', { result });
    return body;
  }

  pauseAgent(agentId: string): void {
    const body = this.require(agentId);
    if (body.status !== 'stopped') body.status = 'paused';
    body.memory.append('pause', {});
  }

  resumeAgent(agentId: string): void {
    const body = this.require(agentId);
    if (body.status === 'paused') {
      body.status = body.taskState.status === 'assigned' || body.taskState.status === 'in_progress'
        ? 'working'
        : 'idle';
      this.heartbeat(agentId);
      body.memory.append('resume', {});
    }
  }

  async stopAgent(agentId: string): Promise<void> {
    const body = this.bodies.get(agentId);
    if (!body) return;
    body.status = 'stopped';
    body.memory.append('stop', {});
    await body.vision.close().catch(() => undefined);
    await this.provider.destroyWorkspace(body.workspaceId).catch(() => undefined);
    this.bodies.delete(agentId);
  }

  heartbeat(agentId: string): void {
    const body = this.bodies.get(agentId);
    if (body) body.lastHeartbeatAt = new Date().toISOString();
  }

  /** Stop every agent whose heartbeat is older than the timeout. Returns ids. */
  async killUnhealthy(now: number = Date.now()): Promise<string[]> {
    const killed: string[] = [];
    for (const body of this.list()) {
      const age = now - new Date(body.lastHeartbeatAt).getTime();
      if (age > this.heartbeatTimeoutMs) {
        killed.push(body.agentId);
        await this.stopAgent(body.agentId);
      }
    }
    return killed;
  }

  /** Collect results from agents that finished their task. */
  collectResults(): Array<{ agentId: string; role: string; result: unknown }> {
    return this.list()
      .filter((body) => body.taskState.status === 'done')
      .map((body) => ({ agentId: body.agentId, role: body.role, result: body.taskState.result }));
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.list().map((body) => this.stopAgent(body.agentId)));
  }

  private require(agentId: string): AgentBody {
    const body = this.bodies.get(agentId);
    if (!body) throw new Error(`agent ${agentId} not found`);
    return body;
  }
}
