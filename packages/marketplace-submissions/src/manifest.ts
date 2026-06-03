import { z } from 'zod';

/**
 * The marketplace manifest is the contract every community submission must
 * satisfy, regardless of what kind of capability it is. It is a superset of the
 * lightweight skill manifest: it adds the trust/risk/permission metadata the
 * marketplace needs to decide whether — and how loudly — a capability may be
 * installed.
 */

/** Everything a user or external developer can submit to the marketplace. */
export const CapabilityKind = z.enum([
  'skill',
  'toolpack',
  'channel',
  'provider',
  'workflow',
  'agent',
  'policy',
  'template',
]);
export type CapabilityKind = z.infer<typeof CapabilityKind>;

/** Coarse capabilities a submission may request. */
export const Permission = z.enum([
  'network',
  'filesystem',
  'shell',
  'secrets',
  'env',
  'clipboard',
  'notifications',
]);
export type Permission = z.infer<typeof Permission>;

export const RiskLevel = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const SupportedOS = z.enum(['linux', 'darwin', 'win32', 'wsl2', 'any']);
export type SupportedOS = z.infer<typeof SupportedOS>;

export const MarketplaceManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'id must be lower-case kebab or snake case'),
  name: z.string().min(1),
  description: z.string().min(1),
  kind: CapabilityKind.default('skill'),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/, 'version must be semver, e.g. 1.0.0'),
  author: z.string().min(1),
  /** Where the submission came from (CLI path, github:owner/repo, etc.). */
  source: z.string().default('community'),
  license: z.string().default('UNLICENSED'),
  supportedOS: z.array(SupportedOS).min(1).default(['any']),
  permissions: z.array(Permission).default([]),
  riskLevel: RiskLevel.default('low'),
  /** Tools the capability declares it uses. */
  declaredTools: z.array(z.string()).default([]),
  /** Secrets the capability needs at runtime, declared not embedded. */
  requiredSecrets: z.array(z.string()).default([]),
  /** Commands run to install the capability (reviewed, never piped from remote). */
  installCommands: z.array(z.string()).default([]),
  /** Health-check commands Helmr runs to confirm the capability works. */
  healthChecks: z.array(z.string()).default([]),
  /** Example invocations / tests that double as a contract. */
  examples: z.array(z.string()).default([]),
  /** Files that must be present in the submission for it to be valid. */
  requiredFiles: z.array(z.string()).default([]),
  instructions: z.string().default(''),
  changelog: z.array(z.string()).default([]),
});

export type MarketplaceManifest = z.infer<typeof MarketplaceManifestSchema>;

export function parseMarketplaceManifest(input: unknown): MarketplaceManifest {
  return MarketplaceManifestSchema.parse(input);
}

export function safeParseMarketplaceManifest(input: unknown) {
  return MarketplaceManifestSchema.safeParse(input);
}
