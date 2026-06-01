import type { ISO } from './types.js';

/**
 * A central, append-only record of what every agent is doing. This is the spine
 * of trust, debugging, replay, and safety: nothing an agent does should be a
 * surprise after the fact.
 */

export type TaskLedgerStatus =
  | 'created'
  | 'assigned'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'failed';

export interface TaskLedgerAction {
  timestamp: ISO;
  action: string;
  detail?: unknown;
}

export interface TaskLedgerEntry {
  taskId: string;
  description: string;
  assignedAgentId?: string;
  workspaceId?: string;
  status: TaskLedgerStatus;
  actions: TaskLedgerAction[];
  observations: TaskLedgerAction[];
  errors: TaskLedgerAction[];
  result?: unknown;
  createdAt: ISO;
  updatedAt: ISO;
}

export class TaskLedger {
  private readonly entries = new Map<string, TaskLedgerEntry>();

  createTask(taskId: string, description: string): TaskLedgerEntry {
    const now = new Date().toISOString();
    const entry: TaskLedgerEntry = {
      taskId,
      description,
      status: 'created',
      actions: [],
      observations: [],
      errors: [],
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(taskId, entry);
    return entry;
  }

  assign(taskId: string, agentId: string, workspaceId: string): void {
    const entry = this.require(taskId);
    entry.assignedAgentId = agentId;
    entry.workspaceId = workspaceId;
    entry.status = 'assigned';
    this.touch(entry);
  }

  setStatus(taskId: string, status: TaskLedgerStatus): void {
    const entry = this.require(taskId);
    entry.status = status;
    this.touch(entry);
  }

  recordAction(taskId: string, action: string, detail?: unknown): void {
    const entry = this.require(taskId);
    entry.actions.push({ timestamp: new Date().toISOString(), action, detail });
    if (entry.status === 'assigned') entry.status = 'in_progress';
    this.touch(entry);
  }

  recordObservation(taskId: string, summary: string, detail?: unknown): void {
    const entry = this.require(taskId);
    entry.observations.push({ timestamp: new Date().toISOString(), action: summary, detail });
    this.touch(entry);
  }

  recordError(taskId: string, error: string, detail?: unknown): void {
    const entry = this.require(taskId);
    entry.errors.push({ timestamp: new Date().toISOString(), action: error, detail });
    this.touch(entry);
  }

  complete(taskId: string, result: unknown): void {
    const entry = this.require(taskId);
    entry.result = result;
    entry.status = 'done';
    this.touch(entry);
  }

  fail(taskId: string, error: string): void {
    const entry = this.require(taskId);
    entry.errors.push({ timestamp: new Date().toISOString(), action: error });
    entry.status = 'failed';
    this.touch(entry);
  }

  get(taskId: string): TaskLedgerEntry | undefined {
    return this.entries.get(taskId);
  }

  all(): TaskLedgerEntry[] {
    return [...this.entries.values()];
  }

  private require(taskId: string): TaskLedgerEntry {
    const entry = this.entries.get(taskId);
    if (!entry) throw new Error(`task ${taskId} not found in ledger`);
    return entry;
  }

  private touch(entry: TaskLedgerEntry): void {
    entry.updatedAt = new Date().toISOString();
  }
}
