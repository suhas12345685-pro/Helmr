/**
 * Multi-Agent Embodied Operator Runtime — core types.
 *
 * Every agent Helmr spins up gets its own isolated "body": its own virtual eyes
 * (VisualPerceptionStream), virtual keyboard, virtual mouse, workspace, session,
 * memory, and a coordination channel. No agent ever touches the Operator's real
 * keyboard, mouse, or desktop cursor.
 */

import type { PermissionSet } from './permissions.js';

export type ISO = string;

// ─── Visual perception ──────────────────────────────────────────────────────

/**
 * A perceived UI element. This is human-like perception: roles, names, and
 * text — sourced from a browser accessibility tree / DOM / rendered frame —
 * not a pile of pixel coordinates from a blind screenshot.
 */
export interface UIElement {
  id?: string;
  /** Accessibility role: button, textbox, link, menu, heading, ... */
  role: string;
  /** Accessible name / label. */
  name?: string;
  text?: string;
  value?: string;
  focused?: boolean;
  disabled?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  attributes?: Record<string, string>;
}

export interface CursorState {
  x: number;
  y: number;
  pressed?: boolean;
}

/**
 * One structured observation of an agent's live workspace. Deliberately richer
 * than "the bytes of a screenshot": it carries understood UI state over time.
 */
export interface VisualObservation {
  agentId: string;
  workspaceId: string;
  timestamp: ISO;
  visibleText?: string[];
  uiElements?: UIElement[];
  focusedElement?: UIElement | null;
  cursor?: CursorState;
  appState?: string;
  /** What changed since the previous observation. */
  changeSummary?: string;
  /** Opaque reference to a raw frame/snapshot. NOT the product abstraction. */
  rawVisualRef?: string;
}

/**
 * The "eyes". A live perception stream over one isolated workspace. The loop is
 * observe -> understand -> decide -> act -> observe change, not screenshot/OCR.
 */
export interface VisualPerceptionStream {
  readonly agentId: string;
  readonly workspaceId: string;
  /** Current structured observation of the live workspace. */
  observe(): Promise<VisualObservation>;
  /** Subscribe to live visual changes over time. Returns an unsubscribe fn. */
  onChange(listener: (observation: VisualObservation) => void): () => void;
  /** Release perception resources. */
  close(): Promise<void>;
}

// ─── Virtual input ──────────────────────────────────────────────────────────

/** A keyboard bound to exactly one workspace. Never the Operator's real keys. */
export interface VirtualKeyboard {
  readonly agentId: string;
  readonly workspaceId: string;
  /** Focus a target before typing (selector or perceived element). */
  focus(target: string | UIElement): Promise<void>;
  type(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  pressShortcut(keys: string[]): Promise<void>;
  holdKey(key: string): Promise<void>;
  releaseKey(key: string): Promise<void>;
  /** Safe send: focus the target, then type. */
  sendText(target: string | UIElement, text: string): Promise<void>;
}

/** A mouse bound to exactly one workspace. Operates only inside that workspace. */
export interface VirtualMouse {
  readonly agentId: string;
  readonly workspaceId: string;
  move(x: number, y: number): Promise<void>;
  click(x?: number, y?: number): Promise<void>;
  doubleClick(x?: number, y?: number): Promise<void>;
  rightClick(x?: number, y?: number): Promise<void>;
  drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  hover(x: number, y: number): Promise<void>;
  position(): CursorState;
}

// ─── Workspaces ─────────────────────────────────────────────────────────────

export type WorkspaceKind =
  | 'mock'
  | 'browser-context'
  | 'browser-profile'
  | 'remote-browser'
  | 'container-desktop'
  | 'vm'
  | 'vnc'
  | 'app-automation';

export interface WorkspaceRequest {
  agentId: string;
  role: string;
  kind?: WorkspaceKind;
  startUrl?: string;
  permissions: PermissionSet;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceHandle {
  workspaceId: string;
  kind: WorkspaceKind;
  agentId: string;
  startUrl?: string;
  createdAt: ISO;
}

/**
 * A pluggable provider of isolated workspaces. Browser, container desktop, VM,
 * VNC, app-automation — all implement this same shape, so the runtime is
 * provider-agnostic.
 */
export interface WorkspaceProvider {
  readonly kind: WorkspaceKind;
  createWorkspace(request: WorkspaceRequest): Promise<WorkspaceHandle>;
  destroyWorkspace(workspaceId: string): Promise<void>;
  attachVision(workspaceId: string): Promise<VisualPerceptionStream>;
  attachKeyboard(workspaceId: string): Promise<VirtualKeyboard>;
  attachMouse(workspaceId: string): Promise<VirtualMouse>;
}

// ─── Coordination ───────────────────────────────────────────────────────────

export type AgentMessageChannel = 'direct' | 'broadcast' | 'orchestrator';
export type AgentMessageType =
  | 'status'
  | 'handoff'
  | 'question'
  | 'result'
  | 'error'
  | 'heartbeat';

export interface AgentMessage {
  fromAgentId: string;
  toAgentId?: string;
  channel: AgentMessageChannel;
  type: AgentMessageType;
  payload: unknown;
  timestamp: ISO;
}

/** A per-agent handle onto the coordination bus. */
export interface AgentChannel {
  readonly agentId: string;
  send(message: Omit<AgentMessage, 'fromAgentId' | 'timestamp'>): void;
  onMessage(listener: (message: AgentMessage) => void): () => void;
}

export interface CoordinationBus {
  publish(message: AgentMessage): void;
  /** Subscribe an agent; it receives direct messages to it + broadcasts. */
  subscribe(agentId: string, listener: (message: AgentMessage) => void): () => void;
  /** Subscribe the orchestrator; it receives everything routed to "orchestrator". */
  subscribeOrchestrator(listener: (message: AgentMessage) => void): () => void;
  channelFor(agentId: string): AgentChannel;
  history(): AgentMessage[];
}

// ─── Agent memory ───────────────────────────────────────────────────────────

export interface AgentMemoryEntry {
  timestamp: ISO;
  kind: string;
  detail: unknown;
}

export interface AgentMemoryLog {
  append(kind: string, detail: unknown): void;
  entries(): AgentMemoryEntry[];
}

// ─── Agent body ─────────────────────────────────────────────────────────────

export type AgentStatus =
  | 'spawning'
  | 'idle'
  | 'working'
  | 'paused'
  | 'blocked'
  | 'stopped'
  | 'error';

export type AgentTaskStatus =
  | 'none'
  | 'assigned'
  | 'in_progress'
  | 'awaiting_help'
  | 'done'
  | 'failed';

export interface AgentTaskState {
  taskId?: string;
  description?: string;
  status: AgentTaskStatus;
  startedAt?: ISO;
  finishedAt?: ISO;
  result?: unknown;
  error?: string;
}

/**
 * One embodied agent. It owns a workspace, eyes, hands, session, memory, and a
 * coordination channel. Its body is entirely separate from every other agent's
 * — and entirely separate from the Operator's real machine.
 */
export interface AgentBody {
  agentId: string;
  role: string;
  workspaceId: string;
  vision: VisualPerceptionStream;
  keyboard: VirtualKeyboard;
  mouse: VirtualMouse;
  browserSession: WorkspaceHandle;
  taskState: AgentTaskState;
  memory: AgentMemoryLog;
  communicationChannel: AgentChannel;
  permissions: PermissionSet;
  status: AgentStatus;
  createdAt: ISO;
  lastHeartbeatAt: ISO;
}
