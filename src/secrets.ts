import { SecretStore } from '../packages/config/src/secret-store.js';
import { getHelmrPaths } from './paths.js';

/**
 * Load durably-stored provider keys into the current process environment.
 *
 * Called at every entrypoint (daemon, standalone Hatchery server, and the
 * `helmr ask` CLI path) before any agent runs, so keys configured once via
 * Hatchery onboarding take effect after a restart. Environment-provided
 * values always win, so container/systemd-injected secrets are never
 * clobbered by the on-disk store.
 *
 * Returns the keys that were applied from the store (never throws on a
 * missing/unreadable store — secret loading must not block startup).
 */
export async function loadPersistedSecrets(): Promise<string[]> {
  try {
    const store = new SecretStore(getHelmrPaths().configDir);
    return await store.loadInto(process.env);
  } catch {
    return [];
  }
}
