import { PairingStore } from './pairing.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

export interface TelegramAdapterOptions {
  token?: string;
  adminId?: string;
  onEvent: EventEmitter;
}

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat: { id: number }; from?: { id: number } };
}

interface TelegramResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly name = 'Telegram';
  readonly kind = 'telegram';

  private status: ChannelStatus = 'not_configured';
  private token: string | undefined;
  private adminId: string | undefined;
  private connectedAt: string | undefined;
  private polling = false;
  private offset = 0;
  private readonly pairingStore = new PairingStore();
  private readonly onEvent: EventEmitter;

  constructor(options: TelegramAdapterOptions) {
    this.token = options.token;
    this.adminId = options.adminId;
    this.onEvent = options.onEvent;
    if (this.token && this.adminId) this.status = 'credentials_entered';
  }

  getStatus(): ChannelStatus { return this.status; }

  getInfo(): ChannelInfo {
    return { name: this.name, kind: this.kind, status: this.status, paired: this.status === 'active', connectedAt: this.connectedAt };
  }

  async configure(credentials: Record<string, string>): Promise<void> {
    if (!credentials.token || !credentials.adminId) throw new Error('token and adminId required');
    this.token = credentials.token;
    this.adminId = credentials.adminId;
    this.status = 'credentials_entered';
  }

  async startPairing(adminId: string): Promise<{ code: string; expiresAt: string }> {
    if (!this.token) throw new Error('Token not configured');
    const { code, expiresAt } = this.pairingStore.create(adminId);
    await this.sendMessage(adminId, `Your Helmr pairing code: ${code}\nExpires at ${expiresAt}`);
    return { code, expiresAt };
  }

  async confirmPairing(code: string): Promise<boolean> {
    const adminId = this.pairingStore.consume(code);
    if (!adminId) return false;
    this.status = 'paired';
    this.connectedAt = new Date().toISOString();
    this.status = 'active';
    return true;
  }

  async start(): Promise<void> {
    if (this.status !== 'active') throw new Error('Channel must be active before starting');
    if (this.polling) return;
    this.polling = true;
    void this.pollLoop();
  }

  async stop(): Promise<void> {
    this.polling = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const text = update.message?.text;
    const chatId = update.message?.chat.id;
    if (!text || !chatId) return;
    const event = normalizeChannelEvent({
      text,
      provider: this.kind,
      principalId: String(chatId),
      workspacePath: process.cwd(),
    });
    await this.onEvent(event);
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=30`;
    const res = await fetch(url);
    const data = (await res.json()) as TelegramResponse;
    if (!data.ok) return [];
    return (data.result as TelegramUpdate[]) ?? [];
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = (await res.json()) as TelegramResponse;
    if (!res.ok || !data.ok) {
      throw new Error(`Telegram sendMessage failed: ${data.description ?? res.statusText}`);
    }
  }
}
