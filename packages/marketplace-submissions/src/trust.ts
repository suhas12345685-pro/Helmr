/**
 * Marketplace trust levels and the rules that bind them. Trust level is the
 * single most important signal a user sees: it answers "how much has Helmr
 * vouched for this?" and it gates install behaviour.
 */
export type TrustLevel =
  | 'official'
  | 'verified'
  | 'community'
  | 'experimental'
  | 'quarantined'
  | 'blocked';

export const TRUST_LEVELS: TrustLevel[] = [
  'official',
  'verified',
  'community',
  'experimental',
  'quarantined',
  'blocked',
];

export interface TrustPolicy {
  /** Can this item be installed at all through normal flows? */
  installable: boolean;
  /** Must Helmr show an explicit warning before install? */
  warnOnInstall: boolean;
  /** May the item be auto-enabled after install without owner approval? */
  autoEnableAllowed: boolean;
  description: string;
}

export const TRUST_POLICIES: Record<TrustLevel, TrustPolicy> = {
  official: {
    installable: true,
    warnOnInstall: false,
    autoEnableAllowed: true,
    description: 'Maintained by the Helmr core team.',
  },
  verified: {
    installable: true,
    warnOnInstall: false,
    // Even verified, low-risk items only auto-enable when low risk (see below).
    autoEnableAllowed: true,
    description: 'Passed security scan and maintainer review.',
  },
  community: {
    installable: true,
    warnOnInstall: true,
    autoEnableAllowed: false,
    description: 'Passed a basic scan but is not officially verified.',
  },
  experimental: {
    installable: true,
    warnOnInstall: true,
    autoEnableAllowed: false,
    description: 'Installable only with an explicit warning.',
  },
  quarantined: {
    installable: false,
    warnOnInstall: true,
    autoEnableAllowed: false,
    description: 'Failed a scan or is broken; cannot be installed normally.',
  },
  blocked: {
    installable: false,
    warnOnInstall: true,
    autoEnableAllowed: false,
    description: 'Known malicious or dangerous; never installable.',
  },
};

/**
 * The central safety rule: should this item be auto-enabled after install?
 *
 * Never auto-enable a community skill after install unless it is verified and
 * low risk. High-risk items always require explicit owner approval, regardless
 * of trust level.
 */
export function shouldAutoEnable(trust: TrustLevel, riskLevel: 'low' | 'medium' | 'high'): boolean {
  if (riskLevel === 'high') return false;
  const policy = TRUST_POLICIES[trust];
  if (!policy.autoEnableAllowed) return false;
  // Verified items only auto-enable when low risk; medium risk needs approval.
  if (trust === 'verified') return riskLevel === 'low';
  // Official items (core team) may auto-enable at low/medium risk. High risk is
  // already excluded above, so anything reaching here is allowed.
  return true;
}

export function isInstallable(trust: TrustLevel): boolean {
  return TRUST_POLICIES[trust].installable;
}
