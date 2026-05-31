import { WebSocket } from 'ws';

import { PairingStore } from './pairing.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

export interface SlackAdapterOptions {
  botToken?: string;
  appToken?: string;
  adminUserId?: string;
  onEvent: EventEmitter;
}

const SLACK_API = 'https://slack.com/api';

interface SlackSocketEnvelope {
  envelope_id?: string;
  type: string;
  payload?: { event?: { type: string; text?: string; user?: string; channel?: string } };
}

export class SlackAdapter implements ChannelAdapter {
  readonly name = 'Slack';
  readonly kind = 'slack';

  private status: ChannelStatus = 'not_configured';
  private botToken: string | undefined;
  private appToken: string | undefined;
  private adminUserId: string | undefined;
  private connectedAt: string | undefined;
  private ws: WebSocket | null = null;
  private readonly pairingStore = new PairingStore();
  private readonly onEvent: EventEmitter;

  constructor(options: SlackAdapterOptions) {
    this.botToken = options.botToken;
    this.appToken = options.appToken;
    this.adminUserId = options.adminUserId;
    this.onEvent = options.onEvent;
    if (this.botToken && this.appToken && this.adminUserId) this.status = 'credentials_entered';
  }

  getStatus(): ChannelStatus { return this.status; }

  getInfo(): ChannelInfo {
    return { name: this.name, kind: this.kind, status: this.status, paired: this.status === 'active', connectedAt: this.connectedAt };
  }

  async configure(credentials: Record<string, string>): Promise<void> {
    if (!credentials.botToken || !credentials.appToken || !credentials.adminUserId) {
      throw new Error('botToken, appToken, and adminUserId required');
    }
    this.botToken = credentials.botToken;
    this.appToken = credentials.appToken;
    this.adminUserId = credentials.adminUserId;
    this.status = 'credentials_entered';
  }

  async startPairing(adminUserId: string): Promise<{ code: string; expiresAt: string }> {
    if (!this.botToken) throw new Error('botToken not configured');
    const { code, expiresAt } = this.pairingStore.create(adminUserId);
    await this.postMessage(adminUserId, `Your Helmr pairing code: ${code}\nExpires at ${expiresAt}`);
    return { code, expiresAt };
  }

  async confirmPairing(code: string): Promise<boolean> {
    const adminId = this.pairingStore.consume(code);
    if (!adminId) return false;
    this.connectedAt = new Date().toISOString();
    this.status = 'active';
    return true;
  }

  markPaired(): void {
    this.connectedAt = new Date().toISOString();
    this.status = 'active';
  }

  async start(): Promise<void> {
    if (this.status !== 'active') throw new Error('Channel must be active before starting');
    if (this.ws) return;
    const wsUrl = await this.openSocketModeConnection();
    this.ws = new WebSocket(wsUrl);
    this.ws.on('message', (data) => void this.handleMessage(data.toString()));
    this.ws.on('error', () => { this.status = 'failed'; });
    this.ws.on('close', () => { this.ws = null; });
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this.ws = null;
  }

  private async handleMessage(raw: string): Promise<void> {
    const envelope = JSON.parse(raw) as SlackSocketEnvelope;

    if (envelope.envelope_id) {
      this.ws?.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    }

    const event = envelope.payload?.event;
    if (!event || event.type !== 'message' || !event.text || !event.user) return;

    const helmrEvent = normalizeChannelEvent({
      text: event.text,
      provider: this.kind,
      principalId: event.user,
      workspacePath: process.cwd(),
    });

    await this.onEvent(helmrEvent);
  }

  private async openSocketModeConnection(): Promise<string> {
    const res = await fetch(`${SLACK_API}/apps.connections.open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.appToken}`, 'Content-Type': 'application/json' },
    });
    const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
    if (!res.ok || !data.ok || !data.url) {
      throw new Error(`Failed to open Socket Mode connection: ${data.error ?? res.statusText}`);
    }
    return data.url;
  }

  private async postMessage(channel: string, text: string): Promise<void> {
    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(`Slack chat.postMessage failed: ${data.error ?? res.statusText}`);
    }
  }
}
