#!/usr/bin/env node
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  cancel,
  checkbox,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  password,
  spinner,
} from '@clack/prompts';
import pc from 'picocolors';

type LlmId = 'anthropic' | 'openai' | 'ollama';
type ChannelId = 'telegram' | 'discord' | 'whatsapp';

interface HelmrConfig {
  version: 1;
  createdAt: string;
  llms: Record<LlmId, { enabled: boolean; tokenEnv: string; token?: string }>;
  channels: Record<ChannelId, { enabled: boolean; sessionsPath: string }>;
  storage: {
    home: string;
    database: string;
    sessions: string;
  };
}

const llmOptions: Array<{ value: LlmId; label: string; hint: string; tokenEnv: string }> = [
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude models via Anthropic API', tokenEnv: 'ANTHROPIC_API_KEY' },
  { value: 'openai', label: 'OpenAI', hint: 'GPT models via OpenAI API', tokenEnv: 'OPENAI_API_KEY' },
  { value: 'ollama', label: 'Ollama', hint: 'Local models through Ollama', tokenEnv: 'OLLAMA_API_KEY' },
];

const channelOptions: Array<{ value: ChannelId; label: string; hint: string }> = [
  { value: 'telegram', label: 'Telegram', hint: 'Pre-provision Telegram session tracking' },
  { value: 'discord', label: 'Discord', hint: 'Pre-provision Discord session tracking' },
  { value: 'whatsapp', label: 'WhatsApp', hint: 'Pre-provision WhatsApp session tracking' },
];

function abortIfCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel('Onboarding cancelled. No further changes were made.');
    process.exit(0);
  }

  return value;
}

function emptyLlmConfig(): HelmrConfig['llms'] {
  return {
    anthropic: { enabled: false, tokenEnv: 'ANTHROPIC_API_KEY' },
    openai: { enabled: false, tokenEnv: 'OPENAI_API_KEY' },
    ollama: { enabled: false, tokenEnv: 'OLLAMA_API_KEY' },
  };
}

function emptyChannelConfig(helmrHome: string): HelmrConfig['channels'] {
  return {
    telegram: { enabled: false, sessionsPath: join(helmrHome, 'logs', 'sessions', 'telegram') },
    discord: { enabled: false, sessionsPath: join(helmrHome, 'logs', 'sessions', 'discord') },
    whatsapp: { enabled: false, sessionsPath: join(helmrHome, 'logs', 'sessions', 'whatsapp') },
  };
}

function runMigrations(databasePath: string): void {
  const db = new Database(databasePath);

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const migration = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS system_channels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel_key TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0,
          sessions_path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS message_metadata (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel_key TEXT NOT NULL,
          external_message_id TEXT,
          sender_id TEXT,
          conversation_id TEXT,
          llm_provider TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          payload_json TEXT,
          received_at TEXT NOT NULL DEFAULT (datetime('now')),
          processed_at TEXT,
          FOREIGN KEY (channel_key) REFERENCES system_channels(channel_key) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_message_metadata_channel_key
          ON message_metadata(channel_key);

        CREATE INDEX IF NOT EXISTS idx_message_metadata_conversation_id
          ON message_metadata(conversation_id);

        CREATE INDEX IF NOT EXISTS idx_message_metadata_status
          ON message_metadata(status);
      `);
    });

    migration();
  } finally {
    db.close();
  }
}

function upsertChannels(databasePath: string, channels: HelmrConfig['channels']): void {
  const db = new Database(databasePath);

  try {
    const statement = db.prepare(`
      INSERT INTO system_channels (channel_key, display_name, enabled, sessions_path, updated_at)
      VALUES (@channelKey, @displayName, @enabled, @sessionsPath, datetime('now'))
      ON CONFLICT(channel_key) DO UPDATE SET
        display_name = excluded.display_name,
        enabled = excluded.enabled,
        sessions_path = excluded.sessions_path,
        updated_at = datetime('now')
    `);

    const writeChannels = db.transaction(() => {
      for (const option of channelOptions) {
        statement.run({
          channelKey: option.value,
          displayName: option.label,
          enabled: channels[option.value].enabled ? 1 : 0,
          sessionsPath: channels[option.value].sessionsPath,
        });
      }
    });

    writeChannels();
  } finally {
    db.close();
  }
}

async function provisionFilesystem(config: HelmrConfig, selectedChannels: ChannelId[]): Promise<void> {
  await mkdir(config.storage.home, { recursive: true, mode: 0o700 });
  await chmod(config.storage.home, 0o700);
  await mkdir(config.storage.sessions, { recursive: true, mode: 0o700 });

  for (const channel of selectedChannels) {
    await mkdir(config.channels[channel].sessionsPath, { recursive: true, mode: 0o700 });
  }

  await writeFile(join(config.storage.home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(join(config.storage.home, 'config.json'), 0o600);
}

async function collectProviderTokens(selectedLlms: LlmId[], config: HelmrConfig): Promise<void> {
  for (const llm of selectedLlms) {
    const option = llmOptions.find((candidate) => candidate.value === llm);
    if (!option) continue;

    const token = abortIfCancelled(
      await password({
        message: `Enter ${option.label} API token`,
        mask: '•',
        validate(value) {
          if (llm !== 'ollama' && value.trim().length === 0) {
            return `${option.label} requires a token to be configured now.`;
          }

          return undefined;
        },
      }),
    );

    config.llms[llm] = {
      enabled: true,
      tokenEnv: option.tokenEnv,
      token: token.trim(),
    };
  }
}

export async function runOnboarding(): Promise<void> {
  const helmrHome = join(homedir(), '.helmr');
  const databasePath = join(helmrHome, 'configuration.db');
  const sessionsPath = join(helmrHome, 'logs', 'sessions');

  intro(`${pc.cyan('⚓ Helmr')} ${pc.bold('Onboarding')}`);

  const selectedLlms = abortIfCancelled(
    await checkbox<LlmId>({
      message: 'Select one or more LLM providers to configure.',
      options: llmOptions.map(({ value, label, hint }) => ({ value, label, hint })),
      required: true,
    }),
  );

  const selectedChannels = abortIfCancelled(
    await checkbox<ChannelId>({
      message: 'Select one or more messaging channels to pre-provision.',
      options: channelOptions.map(({ value, label, hint }) => ({ value, label, hint })),
      required: true,
    }),
  );

  const config: HelmrConfig = {
    version: 1,
    createdAt: new Date().toISOString(),
    llms: emptyLlmConfig(),
    channels: emptyChannelConfig(helmrHome),
    storage: {
      home: helmrHome,
      database: databasePath,
      sessions: sessionsPath,
    },
  };

  for (const llm of selectedLlms) {
    const option = llmOptions.find((candidate) => candidate.value === llm);
    if (option) {
      config.llms[llm] = { enabled: true, tokenEnv: option.tokenEnv };
    }
  }

  for (const channel of selectedChannels) {
    config.channels[channel].enabled = true;
  }

  await collectProviderTokens(selectedLlms, config);

  const shouldWrite = abortIfCancelled(
    await confirm({
      message: `Create Helmr sandbox at ${pc.bold(helmrHome)}?`,
      initialValue: true,
    }),
  );

  if (!shouldWrite) {
    cancel('Onboarding cancelled before writing local files.');
    process.exit(0);
  }

  const s = spinner();
  s.start('Creating local sandbox, configuration, SQLite index, and channel session directories...');

  try {
    await provisionFilesystem(config, selectedChannels);
    runMigrations(databasePath);
    upsertChannels(databasePath, config.channels);
    s.stop('Local Helmr sandbox provisioned.');
  } catch (error) {
    s.stop('Provisioning failed.');
    throw error;
  }

  note(
    [
      `${pc.bold('Home:')} ${helmrHome}`,
      `${pc.bold('Config:')} ${join(helmrHome, 'config.json')}`,
      `${pc.bold('SQLite index:')} ${databasePath}`,
      `${pc.bold('Session logs:')} ${sessionsPath}`,
      `${pc.bold('LLMs:')} ${selectedLlms.join(', ')}`,
      `${pc.bold('Channels:')} ${selectedChannels.join(', ')}`,
    ].join('\n'),
    'Provisioned resources',
  );

  outro(`${pc.green('Helmr onboarding complete.')} Run ${pc.bold('helmr status')} to verify your runtime.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOnboarding().catch((error: unknown) => {
    cancel(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
