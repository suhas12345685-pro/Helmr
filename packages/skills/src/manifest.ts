import { z } from 'zod';

/**
 * A Helmr skill (or plugin) manifest. Skills are how Helmr extends itself: a new
 * skill is a small, declarative capability the agents can discover and use. They
 * are stored as `<id>.skill.json` files in a skills directory and auto-discovered
 * at runtime, so a newly created skill is wired in without any code change.
 */
export const SkillManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'id must be lower-case kebab or snake case'),
  name: z.string().min(1),
  description: z.string().min(1),
  kind: z.enum(['skill', 'plugin']).default('skill'),
  /** Keywords/phrases that hint when this skill is relevant. */
  triggers: z.array(z.string().min(1)).default([]),
  /** Natural-language instructions the agent follows when the skill is active. */
  instructions: z.string().default(''),
  /** Where the skill came from. */
  source: z.enum(['builtin', 'generated', 'user']).default('generated'),
  enabled: z.boolean().default(true),
  version: z.string().default('0.1.0'),
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
