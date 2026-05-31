import { PairingStore } from './pairing.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

export interface TeamsAdapterOptions {
  appId?: string;
  /** Bot Framework service URL for the tenant, e.g. https://smba.trafficmanager.net/... */
  serviceUrl?: string;
  /** Bearer token for the Bot Framework connector. */
  token?: string;
  adminId?: string;
  onEvent: EventEmitter;
}

interface TeamsActivity {
  type?: string;
  text?: string;
  from?: { id?: string };
  conversation?: { id?: string };
  serviceUrl?: string;
}

interface ConnectorResponse {
  error?: { message?: string };
}

/**
 * Microsoft Teams adapter over the Bot Framework connector REST API
 * (architecture section 16.9). Inbound activities are delivered to
 * {@link handleActivity}; outbound replies post back to the conversation.
 */
export class TeamsAdapter implements ChannelAdapter {
  readonly name = 'Microsoft Teams';
  readonly kind = 'teams';

  private status: ChannelStatus = 'not_configured';
  private appId: string | undefined;
  private serviceUrl: string | undefined;
  private token: string | undefined;
  private adminId: string | undefined;
  private connectedAt: string | undefined;
  private readonly pairingStore = new PairingStore();
  private readonly onEvent: EventEmitter;

  constructor(options: TeamsAdapterOptions) {
    this.appId = options.appId;
    this.serviceUrl = options.serviceUrl;
    this.token = options.token;
    this.adminId = options.adminId;
    this.onEvent = options.onEvent;
    if (this.appId && this.serviceUrl) this.status = 'credentials_entered';
  }

  getStatus(): ChannelStatus { return this.status; }

  getInfo(): ChannelInfo {
    return { name: this.name, kind: this.kind, status: this.status, paired: this.status === 'active', connectedAt: this.connectedAt };
  }

  async configure(credentials: Record<string, string>): Promise<void> {
    if (!credentials.appId || !credentials.serviceUrl) throw new Error('appId and serviceUrl required');
    this.appId = credentials.appId;
    this.serviceUrl = credentials.serviceUrl;
    this.token = credentials.token;
    this.adminId = credentials.adminId;
    this.status = 'credentials_entered';
  }

  async startPairing(conversationId: string): Promise<{ code: string; expiresAt: string }> {
    if (!this.serviceUrl) throw new Error('Teams bot registration not configured');
    const { code, expiresAt } = this.pairingStore.create(conversationId);
    await this.sendActivity(conversationId, `Your Helmr pairing code: ${code} (expires at ${expiresAt})`);
    return { code, expiresAt };
  }

  async confirmPairing(code: string): Promise<boolean> {
    const conversationId = this.pairingStore.consume(code);
    if (!conversationId) return false;
    this.connectedAt = new Date().toISOString();
    this.status = 'active';
    return true;
  }

  async start(): Promise<void> {
    if (this.status !== 'active') throw new Error('Channel must be active before starting');
  }

  async stop(): Promise<void> {
    // Inbound delivery is webhook-driven; nothing to tear down locally.
  }

  async handleActivity(activity: TeamsActivity): Promise<void> {
    if (activity.type && activity.type !== 'message') return;
    const text = activity.text;
    const sender = activity.from?.id;
    if (!text || !sender) return;
    const event = normalizeChannelEvent({
      text,
      provider: this.kind,
      principalId: sender,
      workspacePath: process.cwd(),
    });
    await this.onEvent(event);
  }

  private async sendActivity(conversationId: string, text: string): Promise<void> {
    const base = (this.serviceUrl as string).replace(/\/$/, '');
    const res = await fetch(`${base}/v3/conversations/${conversationId}/activities`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'message', text }),
    });
    const data = (await res.json().catch(() => ({}))) as ConnectorResponse;
    if (!res.ok) {
      throw new Error(`Teams sendActivity failed: ${data.error?.message ?? res.statusText}`);
    }
  }
}
