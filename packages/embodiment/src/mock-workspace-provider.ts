import { randomUUID } from 'node:crypto';

import {
  assertPermission,
  permissionSet,
  type PermissionSet,
} from './permissions.js';
import type {
  CursorState,
  UIElement,
  VirtualKeyboard,
  VirtualMouse,
  VisualObservation,
  VisualPerceptionStream,
  WorkspaceHandle,
  WorkspaceProvider,
  WorkspaceRequest,
} from './types.js';

/**
 * Per-workspace simulated state. Each workspace is fully isolated: its own
 * "screen" (UI elements + visible text), its own cursor, its own typed buffer.
 * Two agents never share one of these.
 */
interface MockWorkspaceState {
  workspaceId: string;
  agentId: string;
  permissions: PermissionSet;
  appState: string;
  uiElements: UIElement[];
  cursor: CursorState;
  /** Text typed into the focused field, keyed by element id. */
  values: Map<string, string>;
  focusedElementId?: string;
  changeListeners: Set<(o: VisualObservation) => void>;
  lastChangeSummary?: string;
}

/**
 * A working, in-memory WorkspaceProvider. It proves the embodiment model end to
 * end — isolated workspaces, independent eyes/keyboard/mouse, permission
 * enforcement — without any real browser or desktop. Swap it for a browser or
 * container provider later via the same WorkspaceProvider interface.
 */
export class MockWorkspaceProvider implements WorkspaceProvider {
  readonly kind = 'mock' as const;
  private readonly workspaces = new Map<string, MockWorkspaceState>();

  async createWorkspace(request: WorkspaceRequest): Promise<WorkspaceHandle> {
    const workspaceId = `ws_${randomUUID()}`;
    this.workspaces.set(workspaceId, {
      workspaceId,
      agentId: request.agentId,
      permissions: request.permissions,
      appState: request.startUrl ? `loaded:${request.startUrl}` : 'blank',
      uiElements: [
        { id: 'root', role: 'document', name: request.startUrl ?? 'blank' },
      ],
      cursor: { x: 0, y: 0 },
      values: new Map(),
      changeListeners: new Set(),
    });
    return {
      workspaceId,
      kind: 'mock',
      agentId: request.agentId,
      startUrl: request.startUrl,
      createdAt: new Date().toISOString(),
    };
  }

  async destroyWorkspace(workspaceId: string): Promise<void> {
    const state = this.workspaces.get(workspaceId);
    state?.changeListeners.clear();
    this.workspaces.delete(workspaceId);
  }

  async attachVision(workspaceId: string): Promise<VisualPerceptionStream> {
    return new MockVisualPerceptionStream(this.require(workspaceId));
  }

  async attachKeyboard(workspaceId: string): Promise<VirtualKeyboard> {
    return new MockVirtualKeyboard(this.require(workspaceId));
  }

  async attachMouse(workspaceId: string): Promise<VirtualMouse> {
    return new MockVirtualMouse(this.require(workspaceId));
  }

  /** Test/seed helper: place UI elements into a workspace's simulated screen. */
  seedUI(workspaceId: string, elements: UIElement[], appState?: string): void {
    const state = this.require(workspaceId);
    state.uiElements = elements;
    if (appState) state.appState = appState;
    notify(state, 'seeded UI');
  }

  private require(workspaceId: string): MockWorkspaceState {
    const state = this.workspaces.get(workspaceId);
    if (!state) throw new Error(`workspace ${workspaceId} does not exist`);
    return state;
  }
}

function snapshot(state: MockWorkspaceState): VisualObservation {
  const focused = state.uiElements.find((el) => el.id === state.focusedElementId) ?? null;
  return {
    agentId: state.agentId,
    workspaceId: state.workspaceId,
    timestamp: new Date().toISOString(),
    visibleText: state.uiElements.map((el) => el.text ?? el.name ?? '').filter(Boolean),
    uiElements: state.uiElements.map((el) => ({
      ...el,
      value: el.id ? state.values.get(el.id) ?? el.value : el.value,
      focused: el.id === state.focusedElementId,
    })),
    focusedElement: focused,
    cursor: { ...state.cursor },
    appState: state.appState,
    changeSummary: state.lastChangeSummary,
  };
}

function notify(state: MockWorkspaceState, changeSummary: string): void {
  state.lastChangeSummary = changeSummary;
  const observation = snapshot(state);
  for (const listener of state.changeListeners) listener(observation);
}

class MockVisualPerceptionStream implements VisualPerceptionStream {
  readonly agentId: string;
  readonly workspaceId: string;
  constructor(private readonly state: MockWorkspaceState) {
    this.agentId = state.agentId;
    this.workspaceId = state.workspaceId;
  }

  async observe(): Promise<VisualObservation> {
    return snapshot(this.state);
  }

  onChange(listener: (o: VisualObservation) => void): () => void {
    this.state.changeListeners.add(listener);
    return () => this.state.changeListeners.delete(listener);
  }

  async close(): Promise<void> {
    /* nothing to release for the mock */
  }
}

class MockVirtualKeyboard implements VirtualKeyboard {
  readonly agentId: string;
  readonly workspaceId: string;
  constructor(private readonly state: MockWorkspaceState) {
    this.agentId = state.agentId;
    this.workspaceId = state.workspaceId;
  }

  private guard(action: string): void {
    assertPermission(this.state.permissions, 'workspace_only', action);
  }

  async focus(target: string | UIElement): Promise<void> {
    this.guard('keyboard.focus');
    this.state.focusedElementId = typeof target === 'string' ? target : target.id;
    notify(this.state, `focus ${this.state.focusedElementId ?? '(none)'}`);
  }

  async type(text: string): Promise<void> {
    this.guard('keyboard.type');
    const id = this.state.focusedElementId;
    if (id) {
      this.state.values.set(id, (this.state.values.get(id) ?? '') + text);
    }
    notify(this.state, `type "${text}"`);
  }

  async pressKey(key: string): Promise<void> {
    this.guard('keyboard.pressKey');
    notify(this.state, `key ${key}`);
  }

  async pressShortcut(keys: string[]): Promise<void> {
    this.guard('keyboard.pressShortcut');
    notify(this.state, `shortcut ${keys.join('+')}`);
  }

  async holdKey(key: string): Promise<void> {
    this.guard('keyboard.holdKey');
    notify(this.state, `hold ${key}`);
  }

  async releaseKey(key: string): Promise<void> {
    this.guard('keyboard.releaseKey');
    notify(this.state, `release ${key}`);
  }

  async sendText(target: string | UIElement, text: string): Promise<void> {
    await this.focus(target);
    await this.type(text);
  }
}

class MockVirtualMouse implements VirtualMouse {
  readonly agentId: string;
  readonly workspaceId: string;
  constructor(private readonly state: MockWorkspaceState) {
    this.agentId = state.agentId;
    this.workspaceId = state.workspaceId;
  }

  private guard(action: string): void {
    assertPermission(this.state.permissions, 'workspace_only', action);
  }

  async move(x: number, y: number): Promise<void> {
    this.guard('mouse.move');
    this.state.cursor = { x, y, pressed: false };
    notify(this.state, `move ${x},${y}`);
  }

  async click(x?: number, y?: number): Promise<void> {
    this.guard('mouse.click');
    if (x !== undefined && y !== undefined) this.state.cursor = { x, y };
    notify(this.state, `click ${this.state.cursor.x},${this.state.cursor.y}`);
  }

  async doubleClick(x?: number, y?: number): Promise<void> {
    this.guard('mouse.doubleClick');
    if (x !== undefined && y !== undefined) this.state.cursor = { x, y };
    notify(this.state, `dblclick ${this.state.cursor.x},${this.state.cursor.y}`);
  }

  async rightClick(x?: number, y?: number): Promise<void> {
    this.guard('mouse.rightClick');
    if (x !== undefined && y !== undefined) this.state.cursor = { x, y };
    notify(this.state, `rightclick ${this.state.cursor.x},${this.state.cursor.y}`);
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    this.guard('mouse.drag');
    this.state.cursor = { ...to };
    notify(this.state, `drag ${from.x},${from.y}->${to.x},${to.y}`);
  }

  async scroll(dx: number, dy: number): Promise<void> {
    this.guard('mouse.scroll');
    notify(this.state, `scroll ${dx},${dy}`);
  }

  async hover(x: number, y: number): Promise<void> {
    this.guard('mouse.hover');
    this.state.cursor = { x, y };
    notify(this.state, `hover ${x},${y}`);
  }

  position(): CursorState {
    return { ...this.state.cursor };
  }
}

/** Convenience: a provider seeded with conservative default permissions. */
export function mockWorkspaceRequest(
  agentId: string,
  role: string,
  overrides: Partial<WorkspaceRequest> = {},
): WorkspaceRequest {
  return {
    agentId,
    role,
    kind: 'mock',
    permissions: overrides.permissions ?? permissionSet(),
    ...overrides,
  };
}
