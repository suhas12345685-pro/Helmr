import { PairingStore } from './pairing.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

export interface WeChatAdapterOptions {
  /** WeChat Work (qyapi) access token. */
  token?: string;
  /** Application agent id. */
  agentId?: string;
  adminUser?: string;
  onEvent: EventEmitter;
}

interface WeChatMessage {
  FromUserName?: string;
  Content?: string;
  MsgType?: string;
}

interface WeChatResponse {
  errcode?: number;
  errmsg?: string;
}

/**
 * WeChat Work (Enterprise WeChat) adapter using the qyapi message API
 * (architecture section 16.10). Inbound callback messages are handed to
 * {@link handleMessage} already parsed from the callback XML; outbound
 * messages — including pairing codes — go through the message/send endpoint.
 */
export class WeChatAdapter implements ChannelAdapter {
  readonly name = 'WeChat';
  readonly kind = 'wechat';

  private status: ChannelStatus = 'not_configured';
  private token: string | undefined;
  private agentId: string | undefined;
  private adminUser: string | undefined;
  private connectedAt: string | undefined;
  private readonly pairingStore = new PairingStore();
  private readonly onEvent: EventEmitter;

  constructor(options: WeChatAdapterOptions) {
    this.token = options.token;
    this.agentId = options.agentId;
    this.adminUser = options.adminUser;
    this.onEvent = options.onEvent;
    if (this.token && this.agentId) this.status = 'credentials_entered';
  }

  getStatus(): ChannelStatus { return this.status; }

  getInfo(): ChannelInfo {
    return { name: this.name, kind: this.kind, status: this.status, paired: this.status === 'active', connectedAt: this.connectedAt };
  }

  async configure(credentials: Record<string, string>): Promise<void> {
    if (!credentials.token || !credentials.agentId) throw new Error('token and agentId required');
    this.token = credentials.token;
    this.agentId = credentials.agentId;
    this.adminUser = credentials.adminUser;
    this.status = 'credentials_entered';
  }

  async startPairing(adminUser: string): Promise<{ code: string; expiresAt: string }> {
    if (!this.token || !this.agentId) throw new Error('WeChat Work credentials not configured');
    const { code, expiresAt } = this.pairingStore.create(adminUser);
    await this.sendMessage(adminUser, `Your Helmr pairing code: ${code} (expires at ${expiresAt})`);
    return { code, expiresAt };
  }

  async confirmPairing(code: string): Promise<boolean> {
    const adminUser = this.pairingStore.consume(code);
    if (!adminUser) return false;
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
    // Inbound delivery is callback-driven; nothing to tear down locally.
  }

  async handleMessage(message: WeChatMessage): Promise<void> {
    if (message.MsgType && message.MsgType !== 'text') return;
    const text = message.Content;
    const sender = message.FromUserName;
    if (!text || !sender) return;
    const event = normalizeChannelEvent({
      text,
      provider: this.kind,
      principalId: sender,
      workspacePath: process.cwd(),
    });
    await this.onEvent(event);
  }

  private async sendMessage(touser: string, content: string): Promise<void> {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${this.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ touser, msgtype: 'text', agentid: Number(this.agentId), text: { content } }),
    });
    const data = (await res.json()) as WeChatResponse;
    if (!res.ok || (data.errcode && data.errcode !== 0)) {
      throw new Error(`WeChat message send failed: ${data.errmsg ?? res.statusText}`);
    }
  }
}
