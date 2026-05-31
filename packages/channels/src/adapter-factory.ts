import type { ChannelConfigView, KnownChannelName } from './channel-config.js';
import { DiscordAdapter } from './discord.js';
import { GoogleChatAdapter } from './googlechat.js';
import { IMessageAdapter } from './imessage.js';
import { IrcAdapter } from './irc.js';
import { SignalAdapter } from './signal.js';
import { SlackAdapter } from './slack.js';
import { TeamsAdapter } from './teams.js';
import { TelegramAdapter } from './telegram.js';
import { WeChatAdapter } from './wechat.js';
import { WhatsAppAdapter } from './whatsapp.js';
import type { ChannelAdapter, EventEmitter } from './types.js';

export type ChannelEnv = Record<string, string | undefined>;

export interface BuildAdaptersParams {
  views: ChannelConfigView[];
  env: ChannelEnv;
  emit: EventEmitter;
  log?: (message: string) => void;
}

interface ChannelSpec {
  requiredEnv: string[];
  build: (env: ChannelEnv, emit: EventEmitter) => ChannelAdapter;
}

const has = (env: ChannelEnv, key: string): boolean => Boolean(env[key] && env[key]!.trim());

/**
 * Credential specs for every remotely-paired channel. Secrets are read from
 * the environment (never from the HTTP surface), matching how Helmr handles
 * the API token and model provider keys. WebChat is intentionally absent: the
 * Gateway already serves it over its own WebSocket and needs no credentials.
 */
const CHANNEL_SPECS: Partial<Record<KnownChannelName, ChannelSpec>> = {
  telegram: {
    requiredEnv: ['HELMR_TELEGRAM_TOKEN', 'HELMR_TELEGRAM_ADMIN_ID'],
    build: (env, onEvent) => new TelegramAdapter({
      token: env.HELMR_TELEGRAM_TOKEN,
      adminId: env.HELMR_TELEGRAM_ADMIN_ID,
      onEvent,
    }),
  },
  discord: {
    requiredEnv: ['HELMR_DISCORD_TOKEN', 'HELMR_DISCORD_ADMIN_USER_ID'],
    build: (env, onEvent) => new DiscordAdapter({
      token: env.HELMR_DISCORD_TOKEN,
      adminUserId: env.HELMR_DISCORD_ADMIN_USER_ID,
      guildId: env.HELMR_DISCORD_GUILD_ID,
      onEvent,
    }),
  },
  slack: {
    requiredEnv: ['HELMR_SLACK_BOT_TOKEN', 'HELMR_SLACK_APP_TOKEN'],
    build: (env, onEvent) => new SlackAdapter({
      botToken: env.HELMR_SLACK_BOT_TOKEN,
      appToken: env.HELMR_SLACK_APP_TOKEN,
      adminUserId: env.HELMR_SLACK_ADMIN_USER_ID,
      onEvent,
    }),
  },
  irc: {
    requiredEnv: ['HELMR_IRC_HOST', 'HELMR_IRC_CHANNEL'],
    build: (env, onEvent) => new IrcAdapter({
      host: env.HELMR_IRC_HOST,
      port: env.HELMR_IRC_PORT ? Number(env.HELMR_IRC_PORT) : undefined,
      tls: env.HELMR_IRC_TLS === 'true',
      channel: env.HELMR_IRC_CHANNEL,
      nick: env.HELMR_IRC_NICK,
      username: env.HELMR_IRC_USERNAME,
      password: env.HELMR_IRC_PASSWORD,
      onEvent,
    }),
  },
  signal: {
    requiredEnv: ['HELMR_SIGNAL_RPC_URL', 'HELMR_SIGNAL_ACCOUNT'],
    build: (env, onEvent) => new SignalAdapter({
      rpcUrl: env.HELMR_SIGNAL_RPC_URL,
      account: env.HELMR_SIGNAL_ACCOUNT,
      adminNumber: env.HELMR_SIGNAL_ADMIN_NUMBER,
      onEvent,
    }),
  },
  whatsapp: {
    requiredEnv: ['HELMR_WHATSAPP_TOKEN', 'HELMR_WHATSAPP_PHONE_NUMBER_ID'],
    build: (env, onEvent) => new WhatsAppAdapter({
      token: env.HELMR_WHATSAPP_TOKEN,
      phoneNumberId: env.HELMR_WHATSAPP_PHONE_NUMBER_ID,
      adminNumber: env.HELMR_WHATSAPP_ADMIN_NUMBER,
      onEvent,
    }),
  },
  googlechat: {
    requiredEnv: ['HELMR_GOOGLECHAT_TOKEN', 'HELMR_GOOGLECHAT_SPACE'],
    build: (env, onEvent) => new GoogleChatAdapter({
      token: env.HELMR_GOOGLECHAT_TOKEN,
      space: env.HELMR_GOOGLECHAT_SPACE,
      adminId: env.HELMR_GOOGLECHAT_ADMIN_ID,
      onEvent,
    }),
  },
  teams: {
    requiredEnv: ['HELMR_TEAMS_APP_ID', 'HELMR_TEAMS_SERVICE_URL'],
    build: (env, onEvent) => new TeamsAdapter({
      appId: env.HELMR_TEAMS_APP_ID,
      serviceUrl: env.HELMR_TEAMS_SERVICE_URL,
      token: env.HELMR_TEAMS_TOKEN,
      adminId: env.HELMR_TEAMS_ADMIN_ID,
      onEvent,
    }),
  },
  wechat: {
    requiredEnv: ['HELMR_WECHAT_TOKEN', 'HELMR_WECHAT_AGENT_ID'],
    build: (env, onEvent) => new WeChatAdapter({
      token: env.HELMR_WECHAT_TOKEN,
      agentId: env.HELMR_WECHAT_AGENT_ID,
      adminUser: env.HELMR_WECHAT_ADMIN_USER,
      onEvent,
    }),
  },
  imessage: {
    requiredEnv: ['HELMR_IMESSAGE_ADMIN_HANDLE'],
    build: (env, onEvent) => new IMessageAdapter({
      adminHandle: env.HELMR_IMESSAGE_ADMIN_HANDLE,
      onEvent,
    }),
  },
};

/**
 * Build the adapters that should run right now: a channel must be paired in
 * persisted config AND have its required credentials present in the
 * environment. Paired adapters are restored to their active runtime state so
 * the supervisor can start them; everything else is skipped with a reason.
 */
export function buildConfiguredAdapters(params: BuildAdaptersParams): ChannelAdapter[] {
  const { views, env, emit, log } = params;
  const adapters: ChannelAdapter[] = [];

  for (const view of views) {
    const spec = CHANNEL_SPECS[view.name];
    if (!spec) continue; // webchat / unknown — handled elsewhere

    if (view.pairingState !== 'paired') {
      continue; // not paired: cannot enqueue jobs (architecture 16.12)
    }

    const missing = spec.requiredEnv.filter((key) => !has(env, key));
    if (missing.length > 0) {
      log?.(`channel ${view.name} paired but missing credentials: ${missing.join(', ')}`);
      continue;
    }

    const adapter = spec.build(env, emit);
    adapter.markPaired();
    adapters.push(adapter);
  }

  return adapters;
}
