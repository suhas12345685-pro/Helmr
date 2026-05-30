import { WebSocket } from 'ws';

import { PairingStore } from './pairing.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

export interface DiscordAdapterOptions {
  token?: string;
  adminUserId?: string;
  guildId?: string;
  onEvent: EventEmitter;
}

const DISCORD_API = 'https://discord.com/api/v10';
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

interface GatewayPayload { op: number; d?: unknown; t?: string; s?: number }
interface MessageCreateData { content: string; author: { id: string }; channel_id: string }

export class DiscordAdapter implements ChannelAdapter {
  readonly name = 'Discord';
  readonly kind = 'discord';

  private status: ChannelStatus = 'not_configured';
  private token: string | undefined;
  private adminUserId: string | undefined;
  private guildId: string | undefined;
  private connectedAt: string | undefined;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sequence: number | null = null;
  private readonly pairingStore = new PairingStore();
  private readonly onEvent: EventEmitter;

  constructor(options: DiscordAdapterOptions) {
    this.token = options.token;
    this.adminUserId = options.adminUserId;
    this.guildId = options.guildId;
    this.onEvent = options.onEvent;
    if (this.token && this.adminUserId) this.status = 'credentials_entered';
  }

  getStatus(): ChannelStatus { return this.status; }

  getInfo(): ChannelInfo {
    return { name: this.name, kind: this.kind, status: this.status, paired: this.status === 'active', connectedAt: this.connectedAt };
  }

  async configure(credentials: Record<string, string>): Promise<void> {
    if (!credentials.token || !credentials.adminUserId) throw new Error('token and adminUserId required');
    this.token = credentials.token;
    this.adminUserId = credentials.adminUserId;
    this.guildId = credentials.guildId;
    this.status = 'credentials_entered';
  }

  async startPairing(adminUserId: string): Promise<{ code: string; expiresAt: string }> {
    if (!this.token) throw new Error('Token not configured');
    const { code, expiresAt } = this.pairingStore.create(adminUserId);
    const dmChannelId = await this.createDmChannel(adminUserId);
    await this.sendDmMessage(dmChannelId, `Your Helmr pairing code: ${code}\nExpires at ${expiresAt}`);
    return { code, expiresAt };
  }

  async confirmPairing(code: string): Promise<boolean> {
    const adminId = this.pairingStore.consume(code);
    if (!adminId) return false;
    this.connectedAt = new Date().toISOString();
    this.status = 'active';
    return true;
  }

  async start(): Promise<void> {
    if (this.status !== 'active') throw new Error('Channel must be active before starting');
    if (this.ws) return;
    this.ws = new WebSocket(GATEWAY_URL);
    this.ws.on('message', (data) => void this.handleGatewayMessage(data.toString()));
    this.ws.on('error', () => { this.status = 'failed'; });
    this.ws.on('close', () => { this.ws = null; this.clearHeartbeat(); });
  }

  async stop(): Promise<void> {
    this.clearHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private async handleGatewayMessage(raw: string): Promise<void> {
    const payload = JSON.parse(raw) as GatewayPayload;
    if (payload.s) this.sequence = payload.s;

    if (payload.op === 10) {
      const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
      this.startHeartbeat(interval);
      this.identify();
    } else if (payload.op === 0 && payload.t === 'MESSAGE_CREATE') {
      await this.handleMessageCreate(payload.d as MessageCreateData);
    }
  }

  private async handleMessageCreate(data: MessageCreateData): Promise<void> {
    if (!data.content) return;
    const event = normalizeChannelEvent({
      text: data.content,
      provider: this.kind,
      principalId: data.author.id,
      workspacePath: process.cwd(),
    });
    await this.onEvent(event);
  }

  private identify(): void {
    this.ws?.send(JSON.stringify({ op: 2, d: { token: this.token, intents: 33280, properties: { os: 'linux', browser: 'helmr', device: 'helmr' } } }));
  }

  private startHeartbeat(interval: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: this.sequence }));
    }, interval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private async createDmChannel(userId: string): Promise<string> {
    const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: 'POST',
      headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId }),
    });
    const data = (await res.json()) as { id?: string; message?: string };
    if (!res.ok || !data.id) {
      throw new Error(`Discord create DM channel failed: ${data.message ?? res.statusText}`);
    }
    return data.id;
  }

  private async sendDmMessage(channelId: string, content: string): Promise<void> {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = (await res.json()) as { message?: string };
    if (!res.ok) {
      throw new Error(`Discord send DM failed: ${data.message ?? res.statusText}`);
    }
  }
}
