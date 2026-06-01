import {
  MultiAgentRuntime,
  MockWorkspaceProvider,
  BrowserWorkspaceProvider,
  PlaywrightBrowserDriver,
  type WorkspaceProvider,
} from '../packages/embodiment/src/index.js';

/**
 * The process-wide shared embodied-agent runtime.
 *
 * The orchestrator spawns agents into it; the Hatchery server reads from it.
 * Both reach the SAME instance through getAgentRuntime(), so the Agents page
 * reflects whatever the orchestrator is doing — in-process.
 *
 * Provider selection (HELMR_WORKSPACE_PROVIDER):
 *   - "browser" -> isolated Playwright browser context per agent (needs
 *     `npm i playwright`; imported lazily, so absence never breaks the build).
 *   - anything else (default) -> the in-memory mock provider.
 */
export function createWorkspaceProvider(
  env: Record<string, string | undefined> = process.env,
): WorkspaceProvider {
  const choice = env['HELMR_WORKSPACE_PROVIDER']?.trim().toLowerCase();
  if (choice === 'browser') {
    return new BrowserWorkspaceProvider(
      new PlaywrightBrowserDriver({ headless: env['HELMR_BROWSER_HEADLESS'] !== 'false' }),
    );
  }
  return new MockWorkspaceProvider();
}

let shared: MultiAgentRuntime | undefined;

export function getAgentRuntime(): MultiAgentRuntime {
  if (!shared) {
    shared = new MultiAgentRuntime(createWorkspaceProvider(), { mode: 'swarm' });
  }
  return shared;
}

/** Test helper: drop the singleton so the next getAgentRuntime() rebuilds it. */
export function resetAgentRuntime(): void {
  shared = undefined;
}
