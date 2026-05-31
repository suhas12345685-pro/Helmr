import { PairingStore } from './pairing.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

export interface WhatsAppAdapterOptions {
  /** Meta WhatsApp Cloud API access token. */
  token?: string;
  /** Cloud API phone number ID used as the send endpoint. */
  phoneNumberId?: string;
  adminNumber?: string;
  apiVersion?: string;
  onEvent: EventEmitter;
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: { messages?: Array<{ from?: string; text?: { body?: string } }> };
    }>;
  }>;
}

interface GraphResponse {
  error?: { message?: string };
}

/**
 * WhatsApp adapter built on the Meta WhatsApp Cloud API. Inbound messages
 * arrive as webhook payloads (handed to {@link handleWebhook}); outbound
 * messages — including pairing codes — go through the Graph messages endpoint.
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly name = 'WhatsApp';
  readonly kind = 'whatsapp';

  private status: ChannelStatus = 'not_configured';
  private token: string | undefined;
  private phoneNumberId: string | undefined;
  private adminNumber: string | undefined;
  private readonly apiVersion: string;
  private connectedAt: string | undefined;
  private readonly pairingStore = new PairingStore();
  private readonly onEvent: EventEmitter;

  constructor(options: WhatsAppAdapterOptions) {
    this.token = options.token;
    this.phoneNumberId = options.phoneNumberId;
    this.adminNumber = options.adminNumber;
    this.apiVersion = options.apiVersion ?? 'v21.0';
    this.onEvent = options.onEvent;
    if (this.token && this.phoneNumberId) this.status = 'credentials_entered';
  }

  getStatus(): ChannelStatus { return this.status; }

  getInfo(): ChannelInfo {
    return { name: this.name, kind: this.kind, status: this.status, paired: this.status === 'active', connectedAt: this.connectedAt };
  }

  async configure(credentials: Record<string, string>): Promise<void> {
    if (!credentials.token || !credentials.phoneNumberId) throw new Error('token and phoneNumberId required');
    this.token = credentials.token;
    this.phoneNumberId = credentials.phoneNumberId;
    this.adminNumber = credentials.adminNumber;
    this.status = 'credentials_entered';
  }

  async startPairing(adminNumber: string): Promise<{ code: string; expiresAt: string }> {
    if (!this.token || !this.phoneNumberId) throw new Error('WhatsApp Cloud API not configured');
    const { code, expiresAt } = this.pairingStore.create(adminNumber);
    await this.sendMessage(adminNumber, `Your Helmr pairing code: ${code} (expires at ${expiresAt})`);
    return { code, expiresAt };
  }

  async confirmPairing(code: string): Promise<boolean> {
    const adminNumber = this.pairingStore.consume(code);
    if (!adminNumber) return false;
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
  }

  async stop(): Promise<void> {
    // Inbound delivery is webhook-driven; nothing to tear down locally.
  }

  async handleWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          const text = message.text?.body;
          const from = message.from;
          if (!text || !from) continue;
          const event = normalizeChannelEvent({
            text,
            provider: this.kind,
            principalId: from,
            workspacePath: process.cwd(),
          });
          await this.onEvent(event);
        }
      }
    }
  }

  private async sendMessage(to: string, body: string): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    });
    const data = (await res.json()) as GraphResponse;
    if (!res.ok || data.error) {
      throw new Error(`WhatsApp sendMessage failed: ${data.error?.message ?? res.statusText}`);
    }
  }
}
