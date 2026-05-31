import type { BrowserAction } from './actions.js';

export interface BrowserActionResult {
  kind: BrowserAction['kind'];
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * A browser driver executes validated actions. Helmr ships a stub driver and
 * leaves real automation (e.g. Playwright) as an optional dependency that can
 * be slotted in behind this interface without touching the receipt flow.
 */
export interface BrowserDriver {
  readonly name: string;
  isAvailable(): boolean | Promise<boolean>;
  execute(action: BrowserAction): Promise<BrowserActionResult>;
  close(): Promise<void>;
}

/**
 * Default driver used when no real automation backend is installed. It reports
 * itself unavailable so callers know browser automation is not wired up, and
 * refuses to execute rather than silently pretending to drive a page.
 */
export class NullBrowserDriver implements BrowserDriver {
  readonly name = 'null';

  isAvailable(): boolean {
    return false;
  }

  async execute(action: BrowserAction): Promise<BrowserActionResult> {
    return {
      kind: action.kind,
      ok: false,
      error: 'no browser driver installed; install an automation backend (e.g. playwright)',
    };
  }

  async close(): Promise<void> {
    /* nothing to close */
  }
}

/**
 * In-memory driver for tests and dry runs. It validates that actions reach the
 * driver in order and returns deterministic, side-effect-free results.
 */
export class StubBrowserDriver implements BrowserDriver {
  readonly name = 'stub';
  readonly history: BrowserAction[] = [];
  private currentUrl: string | null = null;

  isAvailable(): boolean {
    return true;
  }

  async execute(action: BrowserAction): Promise<BrowserActionResult> {
    this.history.push(action);
    switch (action.kind) {
      case 'navigate':
        this.currentUrl = action.url;
        return { kind: action.kind, ok: true, data: { url: action.url } };
      case 'extractText':
        return { kind: action.kind, ok: true, data: { text: '', url: this.currentUrl } };
      case 'screenshot':
        return { kind: action.kind, ok: true, data: { path: action.path ?? 'screenshot.png' } };
      default:
        return { kind: action.kind, ok: true, data: { url: this.currentUrl } };
    }
  }

  async close(): Promise<void> {
    this.currentUrl = null;
  }
}
