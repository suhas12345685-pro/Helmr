import type { UIElement } from '../../embodiment/src/types.js';

/**
 * Browser automation as a gated, audited tool (Phase 0 of the autonomy roadmap).
 *
 * This is the Playwright-backed *perception* path — the fallback for sites that
 * do not expose WebMCP. It opens an isolated browser context (never the
 * Operator's real browser), navigates, and returns a structured DOM/accessibility
 * view the agent can reason over. Playwright is an optional peer: if it is not
 * installed, the driver throws an actionable install error, which the executor
 * surfaces as a failed result.
 *
 * Per the roadmap, WebMCP (`navigator.modelContext`) is the preferred action
 * surface on agent-ready pages, exposing structured tools that flow through the
 * same receipt + outward-action gate. That discovery step plugs in here once the
 * browser driver exposes a page-evaluation hook.
 */
export interface BrowserActionInput {
  url: string;
  goal?: string;
  readonly?: boolean;
}

export interface BrowserActionResult {
  url: string;
  goal?: string;
  visibleText: string[];
  uiElements: UIElement[];
}

export interface BrowserActionOptions {
  headless?: boolean;
}

export async function runBrowserAction(
  input: BrowserActionInput,
  options: BrowserActionOptions = {},
): Promise<BrowserActionResult> {
  if (!input.url || typeof input.url !== 'string') {
    throw new Error('browser_automation requires a url');
  }

  const { PlaywrightBrowserDriver } = await import('../../embodiment/src/playwright-driver.js');
  const driver = new PlaywrightBrowserDriver({ headless: options.headless ?? true });
  const context = await driver.newContext({ startUrl: input.url });
  try {
    const snapshot = await context.snapshot();
    return {
      url: snapshot.url,
      goal: input.goal,
      visibleText: snapshot.visibleText,
      uiElements: snapshot.uiElements,
    };
  } finally {
    await context.close().catch(() => undefined);
    await driver.close().catch(() => undefined);
  }
}
