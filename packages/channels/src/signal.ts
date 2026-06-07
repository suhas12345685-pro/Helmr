import { PairingStore } from './pairing.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

export interface SignalAdapterOptions {
  /** JSON-RPC endpoint exposed by a local signal-cli daemon. */
  rpcUrl?: string;
  /** The bot's own registered Signal number. */
  account?: string;
  adminNumber?: string;
  onEvent: EventEmitter;
}

interface SignalEnvelope {
  source?: string;
  sourceNumber?: string;
  dataMessage?: { message?: string };
}

interface JsonRpcResult {
  result?: unknown;
  error?: { message?: string };
}

/**
 * Signal adapter that drives a local `signal-cli` daemon over JSON-RPC
 * (architecture section 16.7). Helmr never creates symlinks or changes
 * permissions; it only talks to a daemon the user already runs.
 */
export class SignalAdapter implements ChannelAdapter {
  readonly name = 'Signal';
  readonly kind = 'signal';

  private status: ChannelStatus = 'not_configured';
  private rpcUrl: string | undefined;
  private account: string | undefined;
  private adminNumber: string | undefined;
  private connectedAt: string | undefined;
  private polling = false;
  private readonly pairingStore = new PairingStore();
  private readonly onEvent: EventEmitter;

  constructor(options: SignalAdapterOptions) {
    this.rpcUrl = options.rpcUrl;
    this.account = options.account;
    this.adminNumber = options.adminNumber;
    this.onEvent = options.onEvent;
    if (this.rpcUrl && this.account) this.status = 'credentials_entered';
  }

  getStatus(): ChannelStatus { return this.status; }

  getInfo(): ChannelInfo {
    return { name: this.name, kind: this.kind, status: this.status, paired: this.status === 'active', connectedAt: this.connectedAt };
  }

  async configure(credentials: Record<string, string>): Promise<void> {
    if (!credentials.rpcUrl || !credentials.account) throw new Error('rpcUrl and account required');
    this.rpcUrl = credentials.rpcUrl;
    this.account = credentials.account;
    this.adminNumber = credentials.adminNumber;
    this.status = 'credentials_entered';
  }

  async startPairing(adminNumber: string): Promise<{ code: string; expiresAt: string }> {
    if (!this.rpcUrl || !this.account) throw new Error('signal-cli daemon not configured');
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
        const envelopes = await this.receive();
        // ⚡ Bolt: Process independent incoming Signal messages concurrently instead of sequentially
        // to reduce total latency when receiving multiple messages in a single poll.
        await Promise.all(envelopes.map(envelope => this.handleEnvelope(envelope)));
      } catch {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async handleEnvelope(envelope: SignalEnvelope): Promise<void> {
    const text = envelope.dataMessage?.message;
    const sender = envelope.sourceNumber ?? envelope.source;
    if (!text || !sender) return;
    const event = normalizeChannelEvent({
      text,
      provider: this.kind,
      principalId: sender,
      workspacePath: process.cwd(),
    });
    await this.onEvent(event);
  }

  private async receive(): Promise<SignalEnvelope[]> {
    const data = await this.rpc('receive', { account: this.account });
    const result = data.result as { envelopes?: SignalEnvelope[] } | SignalEnvelope[] | undefined;
    if (Array.isArray(result)) return result;
    return result?.envelopes ?? [];
  }

  private async sendMessage(recipient: string, message: string): Promise<void> {
    const data = await this.rpc('send', { account: this.account, recipient: [recipient], message });
    if (data.error) throw new Error(`Signal send failed: ${data.error.message ?? 'unknown error'}`);
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<JsonRpcResult> {
    const res = await fetch(this.rpcUrl as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
    const data = (await res.json()) as JsonRpcResult;
    if (!res.ok && !data.error) throw new Error(`Signal RPC ${method} failed: ${res.statusText}`);
    return data;
  }
}
