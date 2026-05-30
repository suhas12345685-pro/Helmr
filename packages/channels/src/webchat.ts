import { WebSocketServer, WebSocket } from 'ws';

import { safeTokenEquals } from '../../shared/src/index.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

export interface WebChatAdapterOptions {
  port: number;
  onEvent: EventEmitter;
  workspacePath?: string;
  /**
   * Bearer token clients must present via the `Sec-WebSocket-Protocol`
   * handshake header (e.g. `new WebSocket(url, [token, 'helmr'])`). When
   * undefined or empty, the socket accepts unauthenticated connections —
   * matching the HTTP surfaces that allow open access when HELMR_API_TOKEN
   * is unset. In production the token must be configured.
   */
  apiToken?: string;
}

const WS_SUBPROTOCOL = 'helmr';

interface IncomingMessage {
  text: string;
}

function isIncomingMessage(value: unknown): value is IncomingMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    typeof (value as Record<string, unknown>).text === 'string'
  );
}

export class WebChatAdapter implements ChannelAdapter {
  readonly name = 'WebChat';
  readonly kind = 'webchat';

  private status: ChannelStatus = 'active';
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private readonly port: number;
  private readonly onEvent: EventEmitter;
  private readonly workspacePath: string;
  private readonly apiToken: string;

  constructor(options: WebChatAdapterOptions) {
    this.port = options.port;
    this.onEvent = options.onEvent;
    this.workspacePath = options.workspacePath ?? process.cwd();
    this.apiToken = options.apiToken?.trim() ?? '';
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  getInfo(): ChannelInfo {
    return {
      name: this.name,
      kind: this.kind,
      status: this.status,
      paired: true,
      connectedAt: new Date().toISOString(),
    };
  }

  async configure(_credentials: Record<string, string>): Promise<void> {
    // WebChat requires no credentials — local user is always owner
  }

  async startPairing(_adminId: string): Promise<{ code: string; expiresAt: string }> {
    throw new Error('WebChat does not require pairing');
  }

  async confirmPairing(_code: string): Promise<boolean> {
    throw new Error('WebChat does not require pairing');
  }

  async start(): Promise<void> {
    if (this.wss) return;

    const expectedToken = this.apiToken;

    this.wss = new WebSocketServer({
      port: this.port,
      verifyClient: (info, done) => {
        if (!expectedToken) return done(true);
        const provided = extractBearerSubprotocol(info.req.headers['sec-websocket-protocol']);
        if (!provided || !safeTokenEquals(provided, expectedToken)) {
          return done(false, 401, 'Unauthorized');
        }
        done(true);
      },
      handleProtocols: (protocols) => (protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false),
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('message', (data) => void this.handleMessage(data.toString()));
    });

    this.wss.on('error', () => {
      this.status = 'failed';
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (!this.wss) return resolve();
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
    this.wss = null;
    this.clients.clear();
  }

  broadcast(event: unknown): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private async handleMessage(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isIncomingMessage(parsed)) return;

    const helmrEvent = normalizeChannelEvent({
      text: parsed.text,
      provider: this.kind,
      principalId: 'local-owner',
      workspacePath: this.workspacePath,
    });

    await this.onEvent(helmrEvent);
  }
}

function extractBearerSubprotocol(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header.join(',') : header;
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (!value || value === WS_SUBPROTOCOL) continue;
    return value;
  }
  return null;
}
