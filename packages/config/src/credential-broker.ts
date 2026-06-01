import type { Capability } from '../../shared/src/contracts.js';
import type { SecretRecord } from './secret-store.js';

/**
 * Scoped, minimal credentials — one of the four edge boundaries
 * (docs/phase1-implementation-plan.md). A sandbox does not protect what is
 * *inside* the sandbox, so the answer is to put less inside it: a job only
 * receives the secrets its granted capabilities actually need, not the whole
 * secret store. A workspace-summary job gets no API keys; only a job that does
 * outward network work sees provider/network tokens.
 */
export type SecretMatcher = (key: string) => boolean;

export interface CredentialScopePolicy {
  rules: Partial<Record<Capability, SecretMatcher>>;
}

const isNetworkSecret: SecretMatcher = (key) =>
  /(_API_KEY|_TOKEN|_SECRET|_KEY)$/.test(key) || /API_KEY/.test(key);

const isGitSecret: SecretMatcher = (key) => /^(GIT|GITHUB|GH)_/.test(key);

export const DEFAULT_CREDENTIAL_SCOPE: CredentialScopePolicy = {
  rules: {
    // Outward network/web work may use provider and network credentials.
    network: isNetworkSecret,
    browser: isNetworkSecret,
    // Pushing/authenticating git needs git credentials only.
    git_write: isGitSecret,
    // An explicit broad secret read grants everything.
    secrets_read: () => true,
  },
};

export class CredentialBroker {
  constructor(private readonly policy: CredentialScopePolicy = DEFAULT_CREDENTIAL_SCOPE) {}

  /** The secret keys these capabilities are permitted to see. */
  allowedKeys(capabilities: readonly Capability[], secretKeys: readonly string[]): string[] {
    const matchers = capabilities
      .map((cap) => this.policy.rules[cap])
      .filter((matcher): matcher is SecretMatcher => Boolean(matcher));
    if (matchers.length === 0) return [];
    return secretKeys.filter((key) => matchers.some((match) => match(key)));
  }

  /** The minimal secret subset granted to a job with these capabilities. */
  grant(capabilities: readonly Capability[], secrets: SecretRecord): SecretRecord {
    const allowed = new Set(this.allowedKeys(capabilities, Object.keys(secrets)));
    const scoped: SecretRecord = {};
    for (const [key, value] of Object.entries(secrets)) {
      if (allowed.has(key)) scoped[key] = value;
    }
    return scoped;
  }

  /**
   * A base environment with every *known secret* not granted to these
   * capabilities removed. Non-secret env vars are left intact.
   */
  scopedEnv(
    baseEnv: Record<string, string | undefined>,
    capabilities: readonly Capability[],
    knownSecretKeys: readonly string[],
  ): Record<string, string | undefined> {
    const allowed = new Set(this.allowedKeys(capabilities, knownSecretKeys));
    const out: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(baseEnv)) {
      if (knownSecretKeys.includes(key) && !allowed.has(key)) continue;
      out[key] = value;
    }
    return out;
  }
}
