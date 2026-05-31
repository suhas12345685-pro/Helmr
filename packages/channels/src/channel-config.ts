import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ChannelStatus } from './types.js';

const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000;

export type KnownChannelName =
  | 'webchat'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'whatsapp'
  | 'googlechat'
  | 'signal'
  | 'irc'
  | 'teams'
  | 'wechat'
  | 'imessage';
export type ChannelPairingState = 'unpaired' | 'pending' | 'pairing_required' | 'paired';

export interface ChannelConfigView {
  name: KnownChannelName;
  label: string;
  status: ChannelStatus;
  pairingState: ChannelPairingState;
  endpoint?: string;
  configuredAt?: string;
  pairedAt?: string;
  pairingExpiresAt?: string;
}

interface PersistedPairingRecord {
  codeHash: string;
  expiresAt: string;
  createdAt: string;
}

interface PersistedChannelRecord {
  status: ChannelStatus;
  pairingState: ChannelPairingState;
  endpoint?: string;
  configuredAt?: string;
  pairedAt?: string;
  pairing?: PersistedPairingRecord;
}

interface PersistedChannelConfig {
  version: 1;
  channels: Partial<Record<KnownChannelName, PersistedChannelRecord>>;
}

const KNOWN_CHANNELS: Array<{ name: KnownChannelName; label: string }> = [
  { name: 'webchat', label: 'WebChat' },
  { name: 'telegram', label: 'Telegram' },
  { name: 'discord', label: 'Discord' },
  { name: 'slack', label: 'Slack' },
  { name: 'whatsapp', label: 'WhatsApp' },
  { name: 'googlechat', label: 'Google Chat' },
  { name: 'signal', label: 'Signal' },
  { name: 'irc', label: 'IRC' },
  { name: 'teams', label: 'Microsoft Teams' },
  { name: 'wechat', label: 'WeChat' },
  { name: 'imessage', label: 'iMessage' },
];

const KNOWN_CHANNEL_NAMES = new Set<KnownChannelName>(KNOWN_CHANNELS.map((channel) => channel.name));

export function isKnownChannelName(name: string): name is KnownChannelName {
  return KNOWN_CHANNEL_NAMES.has(name as KnownChannelName);
}

export function generateChannelPairingCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

export class ChannelConfigStore {
  private readonly configPath: string;
  private readonly webchatEndpoint: string;

  constructor(configDir: string, options: { webchatEndpoint: string }) {
    this.configPath = join(configDir, 'channels.json');
    this.webchatEndpoint = options.webchatEndpoint;
  }

  async listChannels(): Promise<ChannelConfigView[]> {
    const config = await this.loadConfig();
    let mutated = false;

    for (const channel of KNOWN_CHANNELS) {
      const record = this.normalizeRecord(channel.name, config.channels[channel.name]);
      const purged = this.purgeExpiredPairing(record);
      if (purged || config.channels[channel.name] !== record) {
        config.channels[channel.name] = record;
        mutated = true;
      }
    }

    if (mutated) await this.saveConfig(config);

    return KNOWN_CHANNELS.map((channel) => this.toView(channel.name, config.channels[channel.name]));
  }

  async configureChannel(name: KnownChannelName): Promise<ChannelConfigView & { pairingCode?: string }> {
    const config = await this.loadConfig();
    const now = new Date();

    if (name === 'webchat') {
      config.channels[name] = {
        status: 'active',
        pairingState: 'paired',
        endpoint: this.webchatEndpoint,
        configuredAt: now.toISOString(),
        pairedAt: now.toISOString(),
      };
      await this.saveConfig(config);
      return this.toView(name, config.channels[name]);
    }

    const code = generateChannelPairingCode();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
    config.channels[name] = {
      status: 'pairing_required',
      pairingState: 'pending',
      configuredAt: now.toISOString(),
      pairing: {
        codeHash: hashPairingCode(code),
        expiresAt,
        createdAt: now.toISOString(),
      },
    };

    await this.saveConfig(config);
    return { ...this.toView(name, config.channels[name]), pairingCode: code };
  }

  async verifyPairingCode(name: KnownChannelName, code: string): Promise<ChannelConfigView & { paired: boolean }> {
    const config = await this.loadConfig();
    const record = this.normalizeRecord(name, config.channels[name]);
    config.channels[name] = record;

    if (name === 'webchat') {
      record.status = 'active';
      record.pairingState = 'paired';
      record.endpoint = this.webchatEndpoint;
      record.pairedAt ??= new Date().toISOString();
      await this.saveConfig(config);
      return { ...this.toView(name, record), paired: true };
    }

    if (this.purgeExpiredPairing(record)) {
      await this.saveConfig(config);
      return { ...this.toView(name, record), paired: false };
    }

    if (!record.pairing || record.pairing.codeHash !== hashPairingCode(code)) {
      await this.saveConfig(config);
      return { ...this.toView(name, record), paired: false };
    }

    record.status = 'active';
    record.pairingState = 'paired';
    record.pairing = undefined;
    record.pairedAt = new Date().toISOString();

    await this.saveConfig(config);
    return { ...this.toView(name, record), paired: true };
  }

  private async loadConfig(): Promise<PersistedChannelConfig> {
    try {
      const raw = await readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedChannelConfig;
      return {
        version: 1,
        channels: parsed.channels && typeof parsed.channels === 'object' ? parsed.channels : {},
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const config: PersistedChannelConfig = { version: 1, channels: {} };
      for (const channel of KNOWN_CHANNELS) {
        config.channels[channel.name] = this.normalizeRecord(channel.name, undefined);
      }
      await this.saveConfig(config);
      return config;
    }
  }

  private async saveConfig(config: PersistedChannelConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const tempPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.configPath);
  }

  private normalizeRecord(name: KnownChannelName, record: PersistedChannelRecord | undefined): PersistedChannelRecord {
    if (name === 'webchat') {
      return {
        status: 'active',
        pairingState: 'paired',
        endpoint: record?.endpoint ?? this.webchatEndpoint,
        configuredAt: record?.configuredAt,
        pairedAt: record?.pairedAt,
      };
    }

    if (!record) return { status: 'not_configured', pairingState: 'unpaired' };

    if (record.pairingState === 'paired') {
      return {
        ...record,
        status: record.status === 'active' ? 'active' : 'paired',
        pairingState: 'paired',
        pairing: undefined,
      };
    }

    if (record.pairing) {
      return {
        ...record,
        status: 'pairing_required',
        pairingState: 'pending',
      };
    }

    return {
      ...record,
      status: record.status === 'active' ? 'pairing_required' : (record.status ?? 'not_configured'),
      pairingState: record.pairingState ?? 'unpaired',
    };
  }

  private purgeExpiredPairing(record: PersistedChannelRecord): boolean {
    if (!record.pairing) return false;
    if (new Date(record.pairing.expiresAt).getTime() > Date.now()) return false;

    record.pairing = undefined;
    record.status = 'pairing_required';
    record.pairingState = 'pairing_required';
    return true;
  }

  private toView(name: KnownChannelName, record: PersistedChannelRecord | undefined): ChannelConfigView {
    const normalized = this.normalizeRecord(name, record);
    const label = KNOWN_CHANNELS.find((channel) => channel.name === name)?.label ?? name;
    return {
      name,
      label,
      status: normalized.status,
      pairingState: normalized.pairingState,
      endpoint: normalized.endpoint,
      configuredAt: normalized.configuredAt,
      pairedAt: normalized.pairedAt,
      pairingExpiresAt: normalized.pairing?.expiresAt,
    };
  }
}

function hashPairingCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}
