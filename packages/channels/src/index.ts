import { z } from 'zod';

export * from './types.js';
export * from './pairing.js';
export * from './webchat.js';
export { TelegramAdapter } from './telegram.js';
export { DiscordAdapter } from './discord.js';
export { SlackAdapter } from './slack.js';
export { IrcAdapter, parseIrcLine, encodeSaslPlain } from './irc.js';
export { SignalAdapter } from './signal.js';
export { WhatsAppAdapter } from './whatsapp.js';
export { GoogleChatAdapter } from './googlechat.js';
export { TeamsAdapter } from './teams.js';
export { WeChatAdapter } from './wechat.js';
export { IMessageAdapter } from './imessage.js';
export { ChannelSupervisor } from './supervisor.js';
export type { ChannelSupervisorDeps, SupervisedChannel } from './supervisor.js';
export { buildConfiguredAdapters } from './adapter-factory.js';
export type { ChannelEnv, BuildAdaptersParams } from './adapter-factory.js';
export { createChannelHealingProbe, createChannelRemediation } from './channel-healing.js';
export type { ChannelHealingSource } from './channel-healing.js';
export * from './channel-config.js';

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
export const STARTER_CHANNELS: z.input<typeof ChannelManifestSchema>[] = [
  { id: 'webchat.local', name: 'Local WebChat', status: 'implemented', permissions: ['channel:send','channel:receive'] },
  { id: 'cli', name: 'CLI', status: 'implemented', permissions: ['channel:send','channel:receive'] },
  { id: 'slack', name: 'Slack', status: 'placeholder', permissions: ['channel:send','channel:receive'] },
  { id: 'whatsapp', name: 'WhatsApp', status: 'placeholder', permissions: ['channel:send','channel:receive'] },
  { id: 'discord', name: 'Discord', status: 'placeholder', permissions: ['channel:send','channel:receive'] },
  { id: 'email', name: 'Email', status: 'placeholder', permissions: ['channel:send','channel:receive'] },
  { id: 'teams', name: 'Microsoft Teams', status: 'placeholder', permissions: ['channel:send','channel:receive'] },
];
