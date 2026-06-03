import { z } from 'zod';

export const ChannelManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['implemented', 'placeholder']).default('placeholder'),
  configSchema: z.record(z.string(), z.unknown()).default({}),
  authSetup: z.array(z.string()).default([]),
  rateLimits: z.object({ perMinute: z.number().int().positive().default(60) }).default({}),
  permissions: z.array(z.string()).default([]),
});
export type ChannelManifest = z.infer<typeof ChannelManifestSchema>;
export const STARTER_CHANNELS: ChannelManifest[] = [
  { id: 'webchat.local', name: 'Local WebChat', status: 'implemented', permissions: ['channel:send','channel:receive'] },
  { id: 'cli', name: 'CLI', status: 'implemented', permissions: ['channel:send','channel:receive'] },
  { id: 'slack', name: 'Slack', status: 'placeholder', permissions: ['channel:send','channel:receive'] },
  { id: 'whatsapp', name: 'WhatsApp', status: 'placeholder', permissions: ['channel:send','channel:receive'] },
  { id: 'discord', name: 'Discord', status: 'placeholder', permissions: ['channel:send','channel:receive'] },
  { id: 'email', name: 'Email', status: 'placeholder', permissions: ['channel:send','channel:receive'] },
  { id: 'teams', name: 'Microsoft Teams', status: 'placeholder', permissions: ['channel:send','channel:receive'] },
];
