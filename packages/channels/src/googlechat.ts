import { PairingStore } from './pairing.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

export interface GoogleChatAdapterOptions {
  /** OAuth bearer token minted from the service account credentials. */
  token?: string;
  /** Default Space resource name, e.g. "spaces/AAAA". */
  space?: string;
  adminId?: string;
  onEvent: EventEmitter;
}

interface GoogleChatEvent {
  type?: string;
  message?: { text?: string; sender?: { name?: string } };
  space?: { name?: string };
}

interface GoogleChatResponse {
  error?: { message?: string };
}

/**
 * Google Chat adapter. Inbound events arrive from the Chat API (handed to
 * {@link handleEvent}); replies and pairing codes are posted with the
 * service-account bearer token (architecture section 16.6).
 */
export class GoogleChatAdapter implements ChannelAdapter {
  readonly name = 'Google Chat';
  readonly kind = 'googlechat';

  private status: ChannelStatus = 'not_configured';
  private token: string | undefined;
  private space: string | undefined;
  private adminId: string | undefined;
  private connectedAt: string | undefined;
  private readonly pairingStore = new PairingStore();
  private readonly onEvent: EventEmitter;

  constructor(options: GoogleChatAdapterOptions) {
    this.token = options.token;
    this.space = options.space;
    this.adminId = options.adminId;
    this.onEvent = options.onEvent;
    if (this.token && this.space) this.status = 'credentials_entered';
  }

  getStatus(): ChannelStatus { return this.status; }

  getInfo(): ChannelInfo {
    return { name: this.name, kind: this.kind, status: this.status, paired: this.status === 'active', connectedAt: this.connectedAt };
  }

  async configure(credentials: Record<string, string>): Promise<void> {
    if (!credentials.token || !credentials.space) throw new Error('token and space required');
    this.token = credentials.token;
    this.space = credentials.space;
    this.adminId = credentials.adminId;
    this.status = 'credentials_entered';
  }

  async startPairing(adminId: string): Promise<{ code: string; expiresAt: string }> {
    if (!this.token || !this.space) throw new Error('Google Chat service account not configured');
    const { code, expiresAt } = this.pairingStore.create(adminId);
    await this.sendMessage(this.space, `Your Helmr pairing code: ${code} (expires at ${expiresAt})`);
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
  }

  async stop(): Promise<void> {
    // Inbound delivery is push/webhook-driven; nothing to tear down locally.
  }

  async handleEvent(event: GoogleChatEvent): Promise<void> {
    if (event.type && event.type !== 'MESSAGE') return;
    const text = event.message?.text;
    const sender = event.message?.sender?.name;
    if (!text || !sender) return;
    const normalized = normalizeChannelEvent({
      text,
      provider: this.kind,
      principalId: sender,
      workspacePath: process.cwd(),
    });
    await this.onEvent(normalized);
  }

  private async sendMessage(space: string, text: string): Promise<void> {
    const res = await fetch(`https://chat.googleapis.com/v1/${space}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = (await res.json()) as GoogleChatResponse;
    if (!res.ok || data.error) {
      throw new Error(`Google Chat sendMessage failed: ${data.error?.message ?? res.statusText}`);
    }
  }
}
