import type { BrowserContextHandle, BrowserDriver } from './browser-workspace-provider.js';
import type { UIElement } from './types.js';

/**
 * A real BrowserDriver backed by Playwright.
 *
 * Playwright is imported lazily so this package compiles and installs WITHOUT
 * Playwright present — it is an optional peer. Install it (`npm i playwright`
 * and `npx playwright install chromium`) to drive real pages; until then the
 * driver throws a clear, actionable error.
 *
 * Each agent gets its own browser CONTEXT (isolated cookies/storage/page) — never
 * the Operator's real browser, never a shared window. Perception is sourced from
 * the accessibility tree + DOM text, exposed as a VisualPerceptionStream, not as
 * screenshot/OCR.
 */
export interface PlaywrightDriverOptions {
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
}

// Minimal structural typings so we don't depend on @types/playwright at build.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyBrowser = any;

export class PlaywrightBrowserDriver implements BrowserDriver {
  private browserPromise: Promise<AnyBrowser> | undefined;

  constructor(private readonly options: PlaywrightDriverOptions = {}) {}

  private async launch(): Promise<AnyBrowser> {
    if (this.browserPromise) return this.browserPromise;
    this.browserPromise = (async () => {
      let playwright: any;
      try {
        // Computed specifier so the optional peer isn't resolved at build time.
        const moduleName = 'playwright';
        playwright = await import(moduleName);
      } catch {
        throw new Error(
          'Playwright is not installed. Run `npm i playwright` and `npx playwright install chromium` to use PlaywrightBrowserDriver.',
        );
      }
      const kind = this.options.browser ?? 'chromium';
      const engine = playwright[kind];
      return engine.launch({ headless: this.options.headless ?? true });
    })();
    return this.browserPromise;
  }

  async newContext({ startUrl }: { startUrl?: string }): Promise<BrowserContextHandle> {
    const browser = await this.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    if (startUrl) await page.goto(startUrl);

    const handle: BrowserContextHandle = {
      id: `pw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      async goto(url: string) {
        await page.goto(url);
      },
      async snapshot() {
        const url: string = page.url();
        // Accessibility tree first — structured perception, not pixels.
        const ax = await page.accessibility.snapshot().catch(() => null);
        const uiElements = ax ? flattenAxTree(ax) : [];
        const visibleText: string[] = await page
          .evaluate(() => {
            const text = (globalThis as any).document?.body?.innerText ?? '';
            return String(text)
              .split('\n')
              .map((s: string) => s.trim())
              .filter(Boolean)
              .slice(0, 200);
          })
          .catch(() => [] as string[]);
        return { url, appState: url, visibleText, uiElements, focusedElement: null };
      },
      onChange(listener: () => void) {
        const handler = () => listener();
        page.on('framenavigated', handler);
        page.on('domcontentloaded', handler);
        return () => {
          page.off('framenavigated', handler);
          page.off('domcontentloaded', handler);
        };
      },
      async focus(selectorOrId: string) {
        await page.focus(selectorOrId).catch(() => undefined);
      },
      async type(text: string) {
        await page.keyboard.type(text);
      },
      async press(key: string) {
        await page.keyboard.press(key);
      },
      async shortcut(keys: string[]) {
        await page.keyboard.press(keys.join('+'));
      },
      async mouseMove(x: number, y: number) {
        await page.mouse.move(x, y);
      },
      async mouseClick(button: 'left' | 'right', clickCount: number, x?: number, y?: number) {
        if (x !== undefined && y !== undefined) await page.mouse.move(x, y);
        await page.mouse.down({ button, clickCount });
        await page.mouse.up({ button, clickCount });
      },
      async mouseDrag(from: { x: number; y: number }, to: { x: number; y: number }) {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y);
        await page.mouse.up();
      },
      async scroll(dx: number, dy: number) {
        await page.mouse.wheel(dx, dy);
      },
      async close() {
        await context.close();
      },
    };
    return handle;
  }

  async close(): Promise<void> {
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close().catch(() => undefined);
      this.browserPromise = undefined;
    }
  }
}

interface AxNode {
  role?: string;
  name?: string;
  value?: string;
  children?: AxNode[];
}

function flattenAxTree(node: AxNode, out: UIElement[] = []): UIElement[] {
  if (node.role && node.role !== 'WebArea' && (node.name || node.value)) {
    out.push({ role: node.role, name: node.name, value: node.value });
  }
  for (const child of node.children ?? []) flattenAxTree(child, out);
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
