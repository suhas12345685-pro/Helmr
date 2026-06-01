import { randomUUID } from 'node:crypto';

import { assertPermission, type PermissionSet } from './permissions.js';
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
 * The browser workspace path.
 *
 * This provider gives each agent its own isolated browser context (its own
 * cookies, storage, and page) — never the Operator's real browser, never a
 * shared window. Perception comes from the DOM/accessibility tree and frame
 * updates, exposed as a VisualPerceptionStream — NOT screenshot-and-OCR.
 *
 * To avoid bundling a heavy automation dependency, the provider is driver-
 * injected: plug in Playwright, Puppeteer, or a CDP/remote-browser driver that
 * satisfies BrowserDriver. The embodiment runtime stays provider-agnostic.
 */
export interface BrowserContextHandle {
  readonly id: string;
  goto(url: string): Promise<void>;
  /** DOM/accessibility-derived structured view of the page. */
  snapshot(): Promise<{
    url: string;
    appState?: string;
    visibleText: string[];
    uiElements: UIElement[];
    focusedElement?: UIElement | null;
    cursor?: CursorState;
  }>;
  /** Subscribe to DOM/frame change events if the driver supports it. */
  onChange?(listener: () => void): () => void;
  focus(selectorOrId: string): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
  shortcut(keys: string[]): Promise<void>;
  mouseMove(x: number, y: number): Promise<void>;
  mouseClick(button: 'left' | 'right', clickCount: number, x?: number, y?: number): Promise<void>;
  mouseDrag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserDriver {
  /** Create a fresh isolated browser context (own profile/cookies/storage). */
  newContext(options: { startUrl?: string }): Promise<BrowserContextHandle>;
}

interface BrowserWorkspaceState {
  agentId: string;
  permissions: PermissionSet;
  handle: BrowserContextHandle;
  cursor: CursorState;
}

export class BrowserWorkspaceProvider implements WorkspaceProvider {
  readonly kind = 'browser-context' as const;
  private readonly workspaces = new Map<string, BrowserWorkspaceState>();

  constructor(private readonly driver: BrowserDriver) {}

  async createWorkspace(request: WorkspaceRequest): Promise<WorkspaceHandle> {
    const workspaceId = `ws_${randomUUID()}`;
    const handle = await this.driver.newContext({ startUrl: request.startUrl });
    if (request.startUrl) {
      assertPermission(request.permissions, 'browser_safe', 'browser.navigate');
      await handle.goto(request.startUrl);
    }
    this.workspaces.set(workspaceId, {
      agentId: request.agentId,
      permissions: request.permissions,
      handle,
      cursor: { x: 0, y: 0 },
    });
    return {
      workspaceId,
      kind: 'browser-context',
      agentId: request.agentId,
      startUrl: request.startUrl,
      createdAt: new Date().toISOString(),
    };
  }

  async destroyWorkspace(workspaceId: string): Promise<void> {
    const state = this.workspaces.get(workspaceId);
    if (state) {
      await state.handle.close();
      this.workspaces.delete(workspaceId);
    }
  }

  async attachVision(workspaceId: string): Promise<VisualPerceptionStream> {
    const state = this.require(workspaceId);
    return new BrowserVisualPerceptionStream(workspaceId, state.agentId, state.handle);
  }

  async attachKeyboard(workspaceId: string): Promise<VirtualKeyboard> {
    const state = this.require(workspaceId);
    return new BrowserVirtualKeyboard(workspaceId, state);
  }

  async attachMouse(workspaceId: string): Promise<VirtualMouse> {
    const state = this.require(workspaceId);
    return new BrowserVirtualMouse(workspaceId, state);
  }

  private require(workspaceId: string): BrowserWorkspaceState {
    const state = this.workspaces.get(workspaceId);
    if (!state) throw new Error(`browser workspace ${workspaceId} does not exist`);
    return state;
  }
}

class BrowserVisualPerceptionStream implements VisualPerceptionStream {
  constructor(
    readonly workspaceId: string,
    readonly agentId: string,
    private readonly handle: BrowserContextHandle,
  ) {}

  async observe(): Promise<VisualObservation> {
    const snap = await this.handle.snapshot();
    return {
      agentId: this.agentId,
      workspaceId: this.workspaceId,
      timestamp: new Date().toISOString(),
      visibleText: snap.visibleText,
      uiElements: snap.uiElements,
      focusedElement: snap.focusedElement ?? null,
      cursor: snap.cursor,
      appState: snap.appState ?? snap.url,
      rawVisualRef: `browser:${this.workspaceId}`,
    };
  }

  onChange(listener: (o: VisualObservation) => void): () => void {
    if (!this.handle.onChange) return () => {};
    return this.handle.onChange(() => {
      void this.observe().then(listener);
    });
  }

  async close(): Promise<void> {
    /* the workspace owns the handle lifecycle */
  }
}

class BrowserVirtualKeyboard implements VirtualKeyboard {
  readonly agentId: string;
  readonly workspaceId: string;
  constructor(workspaceId: string, private readonly state: BrowserWorkspaceState) {
    this.workspaceId = workspaceId;
    this.agentId = state.agentId;
  }
  private guard(action: string): void {
    assertPermission(this.state.permissions, 'workspace_only', action);
  }
  async focus(target: string | UIElement): Promise<void> {
    this.guard('keyboard.focus');
    await this.state.handle.focus(typeof target === 'string' ? target : target.id ?? '');
  }
  async type(text: string): Promise<void> {
    this.guard('keyboard.type');
    await this.state.handle.type(text);
  }
  async pressKey(key: string): Promise<void> {
    this.guard('keyboard.pressKey');
    await this.state.handle.press(key);
  }
  async pressShortcut(keys: string[]): Promise<void> {
    this.guard('keyboard.pressShortcut');
    await this.state.handle.shortcut(keys);
  }
  async holdKey(key: string): Promise<void> {
    this.guard('keyboard.holdKey');
    await this.state.handle.press(key);
  }
  async releaseKey(key: string): Promise<void> {
    this.guard('keyboard.releaseKey');
    await this.state.handle.press(key);
  }
  async sendText(target: string | UIElement, text: string): Promise<void> {
    await this.focus(target);
    await this.type(text);
  }
}

class BrowserVirtualMouse implements VirtualMouse {
  readonly agentId: string;
  readonly workspaceId: string;
  constructor(workspaceId: string, private readonly state: BrowserWorkspaceState) {
    this.workspaceId = workspaceId;
    this.agentId = state.agentId;
  }
  private guard(action: string): void {
    assertPermission(this.state.permissions, 'workspace_only', action);
  }
  async move(x: number, y: number): Promise<void> {
    this.guard('mouse.move');
    this.state.cursor = { x, y };
    await this.state.handle.mouseMove(x, y);
  }
  async click(x?: number, y?: number): Promise<void> {
    this.guard('mouse.click');
    if (x !== undefined && y !== undefined) this.state.cursor = { x, y };
    await this.state.handle.mouseClick('left', 1, x, y);
  }
  async doubleClick(x?: number, y?: number): Promise<void> {
    this.guard('mouse.doubleClick');
    if (x !== undefined && y !== undefined) this.state.cursor = { x, y };
    await this.state.handle.mouseClick('left', 2, x, y);
  }
  async rightClick(x?: number, y?: number): Promise<void> {
    this.guard('mouse.rightClick');
    if (x !== undefined && y !== undefined) this.state.cursor = { x, y };
    await this.state.handle.mouseClick('right', 1, x, y);
  }
  async drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    this.guard('mouse.drag');
    this.state.cursor = { ...to };
    await this.state.handle.mouseDrag(from, to);
  }
  async scroll(dx: number, dy: number): Promise<void> {
    this.guard('mouse.scroll');
    await this.state.handle.scroll(dx, dy);
  }
  async hover(x: number, y: number): Promise<void> {
    this.guard('mouse.hover');
    this.state.cursor = { x, y };
    await this.state.handle.mouseMove(x, y);
  }
  position(): CursorState {
    return { ...this.state.cursor };
  }
}
