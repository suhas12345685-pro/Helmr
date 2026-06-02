import type { Capability } from '../../shared/src/index.js';

/**
 * Scoped, minimal credentials for tool subprocesses.
 *
 * By default a spawned tool inherits the daemon's entire `process.env` — which
 * includes provider API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, …) that a
 * `git commit` or `npm install` has no business seeing. The broker inverts that:
 * a subprocess starts from a minimal base env (just enough to run) and is granted
 * only the secrets the receipt's capabilities actually require — a repo-scoped
 * git token for `git_write`, not the whole keychain.
 *
 * Grants record names only, never values, so they are safe to audit.
 *
 * Encryption-at-rest / OS keyring is a later phase; this phase narrows exposure.
 */

/**
 * Environment keys every subprocess needs just to run. These are operational,
 * not secret (PATH, locale, temp dirs), and are always passed through.
 */
const BASE_ENV_KEYS: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'PWD',
  'TERM',
  // Windows essentials (harmless no-ops elsewhere).
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'NUMBER_OF_PROCESSORS',
  // Node/npm operational config that tools legitimately consult.
  'NODE_PATH',
  'NPM_CONFIG_CACHE',
  'NPM_CONFIG_PREFIX',
];

/**
 * The secret/credential env keys each capability is allowed to receive. A
 * capability not listed here gets only the base env — no secrets at all.
 */
const CAPABILITY_ENV_GRANTS: Partial<Record<Capability, readonly string[]>> = {
  git_read: ['GIT_ASKPASS', 'GIT_SSH_COMMAND', 'SSH_AUTH_SOCK', 'GIT_CONFIG_GLOBAL'],
  git_write: [
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'GIT_TOKEN',
    'GIT_ASKPASS',
    'GIT_SSH_COMMAND',
    'SSH_AUTH_SOCK',
    'GIT_CONFIG_GLOBAL',
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_COMMITTER_NAME',
    'GIT_COMMITTER_EMAIL',
  ],
  package_install: [
    'NPM_TOKEN',
    'NODE_AUTH_TOKEN',
    'NPM_CONFIG_REGISTRY',
    'npm_config_registry',
    'NPM_CONFIG_USERCONFIG',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ],
  network: ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'],
  shell_write: ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'],
};

export interface CredentialGrant {
  /** The scoped env to hand to the subprocess (base + granted secrets). */
  env: Record<string, string>;
  /** Names (never values) of the secret keys granted, for auditing. */
  grantedKeys: string[];
}

export class CredentialBroker {
  constructor(private readonly source: Record<string, string | undefined> = process.env) {}

  /** Which secret keys a single capability may receive (present-in-source only). */
  keysFor(capability: Capability): string[] {
    return [...(CAPABILITY_ENV_GRANTS[capability] ?? [])];
  }

  /**
   * Build a scoped env for a set of capabilities: the base operational env plus
   * only the secret keys those capabilities are allowed and that actually exist
   * in the source. Provider API keys are never included unless explicitly mapped.
   */
  grant(capabilities: readonly Capability[]): CredentialGrant {
    const env: Record<string, string> = {};

    for (const key of BASE_ENV_KEYS) {
      const value = this.source[key];
      if (value !== undefined) env[key] = value;
    }

    const grantedKeys = new Set<string>();
    for (const capability of capabilities) {
      for (const key of CAPABILITY_ENV_GRANTS[capability] ?? []) {
        const value = this.source[key];
        if (value !== undefined && value.trim() !== '') {
          env[key] = value;
          grantedKeys.add(key);
        }
      }
    }

    return { env, grantedKeys: [...grantedKeys] };
  }
}

/** Capabilities whose env the broker scopes (i.e. have a mapping at all). */
export function isCredentialScopedCapability(capability: Capability): boolean {
  return capability in CAPABILITY_ENV_GRANTS;
}
