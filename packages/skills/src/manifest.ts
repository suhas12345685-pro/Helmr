import { z } from 'zod';

const JsonSchemaLike = z.record(z.string(), z.unknown());

export const SkillManifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9_.-]*$/, 'id must be a lower-case slug'),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().default('0.1.0'),
  kind: z.enum(['skill', 'plugin', 'channel', 'provider', 'toolpack']).default('skill'),
  source: z.enum(['builtin', 'generated', 'user', 'marketplace', 'workspace']).default('generated'),
  enabled: z.boolean().default(true),
  triggers: z.array(z.string().min(1)).default([]),
  instructions: z.string().default(''),
  permissions: z.array(z.string().min(1)).default([]),
  tools: z.array(z.object({ id: z.string().min(1), description: z.string().default(''), approvalRequired: z.boolean().default(true) })).default([]),
  inputSchemas: z.record(z.string(), JsonSchemaLike).default({}),
  outputSchemas: z.record(z.string(), JsonSchemaLike).default({}),
  requiredSecrets: z.array(z.string().min(1)).default([]),
  healthCheck: z.object({ command: z.string().optional(), url: z.string().url().optional(), timeoutMs: z.number().int().positive().default(5000) }).prefault({}),
  runtimeConstraints: z.object({ network: z.enum(['none', 'approval', 'allowed']).default('approval'), maxRuntimeMs: z.number().int().positive().optional(), requiresWorkspace: z.boolean().default(false) }).prefault({}),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  approvalRequirements: z.array(z.string().min(1)).default([]),
  examples: z.array(z.string()).default([]),
  tests: z.array(z.string()).default([]),
  checksum: z.string().optional(),
  signature: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export function parseSkillManifest(input: unknown): SkillManifest {
  return SkillManifestSchema.parse(input);
}

export function isSkillManifest(input: unknown): input is SkillManifest {
  return SkillManifestSchema.safeParse(input).success;
}
