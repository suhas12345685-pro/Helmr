import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

import { PairingStore } from './pairing.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

export interface IrcAdapterOptions {
  host?: string;
  port?: number;
  tls?: boolean;
  channel?: string;
  nick?: string;
  /** SASL/account username (also used as IRC username). Optional. */
  username?: string;
  /** SASL password used during PLAIN authentication. Optional. */
  password?: string;
  onEvent: EventEmitter;
}

interface IrcMessage {
  prefix?: string;
  command: string;
  params: string[];
}

/**
 * Minimal but real IRC client adapter.
 *
 * It speaks the wire protocol directly over a TCP or TLS socket: it answers
 * PINGs, optionally authenticates with SASL PLAIN, joins the configured
 * channel, and turns private queries into Helmr chat events. Pairing happens
 * in a private query: the admin opens a query with the bot nick and the bot
 * whispers a single-use pairing code (per architecture section 16.8).
 */
export class IrcAdapter implements ChannelAdapter {
  readonly name = 'IRC';
  readonly kind = 'irc';

  private status: ChannelStatus = 'not_configured';
  private host: string | undefined;
  private port: number;
  private useTls: boolean;
  private channel: string | undefined;
  private nick: string;
  private username: string | undefined;
  private password: string | undefined;
  private connectedAt: string | undefined;
  private socket: Socket | null = null;
  private buffer = '';
  private registered = false;
  private readonly pairingStore = new PairingStore();
  private readonly onEvent: EventEmitter;

  constructor(options: IrcAdapterOptions) {
    this.host = options.host;
    this.port = options.port ?? (options.tls ? 6697 : 6667);
    this.useTls = options.tls ?? false;
    this.channel = options.channel;
    this.nick = options.nick ?? 'helmr';
    this.username = options.username;
    this.password = options.password;
    this.onEvent = options.onEvent;
    if (this.host && this.channel) this.status = 'credentials_entered';
  }

  getStatus(): ChannelStatus { return this.status; }

  getInfo(): ChannelInfo {
    return { name: this.name, kind: this.kind, status: this.status, paired: this.status === 'active', connectedAt: this.connectedAt };
  }

  async configure(credentials: Record<string, string>): Promise<void> {
    if (!credentials.host || !credentials.channel) throw new Error('host and channel required');
    this.host = credentials.host;
    if (credentials.port) {
      const port = Number(credentials.port);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('port must be a valid TCP port');
      this.port = port;
    }
    if (credentials.tls !== undefined) this.useTls = credentials.tls === 'true';
    this.channel = credentials.channel;
    if (credentials.nick) this.nick = credentials.nick;
    if (credentials.username) this.username = credentials.username;
    if (credentials.password) this.password = credentials.password;
    this.status = 'credentials_entered';
  }

  async startPairing(adminNick: string): Promise<{ code: string; expiresAt: string }> {
    if (!this.host) throw new Error('Host not configured');
    const { code, expiresAt } = this.pairingStore.create(adminNick);
    this.sendPrivmsg(adminNick, `Your Helmr pairing code: ${code} (expires at ${expiresAt})`);
    return { code, expiresAt };
  }

  async confirmPairing(code: string): Promise<boolean> {
    const adminNick = this.pairingStore.consume(code);
    if (!adminNick) return false;
    this.connectedAt = new Date().toISOString();
    this.status = 'active';
    return true;
  }

  async start(): Promise<void> {
    if (this.status !== 'active') throw new Error('Channel must be active before starting');
    if (this.socket) return;
    if (!this.host) throw new Error('Host not configured');

    const onData = (chunk: Buffer | string) => this.ingest(chunk.toString());
    this.socket = this.useTls
      ? tlsConnect({ host: this.host, port: this.port, servername: this.host }, () => this.register())
      : netConnect({ host: this.host, port: this.port }, () => this.register());

    this.socket.setEncoding('utf8');
    this.socket.on('data', onData);
    this.socket.on('error', () => { this.status = 'failed'; });
    this.socket.on('close', () => { this.socket = null; this.registered = false; });
  }

  async stop(): Promise<void> {
    if (this.socket) {
      this.send('QUIT :helmr shutting down');
      this.socket.end();
      this.socket = null;
    }
    this.registered = false;
  }

  private register(): void {
    if (this.password) {
      // Request SASL, authenticate, then complete capability negotiation.
      this.send('CAP REQ :sasl');
    }
    this.send(`NICK ${this.nick}`);
    this.send(`USER ${this.username ?? this.nick} 0 * :Helmr`);
  }

  private ingest(raw: string): void {
    this.buffer += raw;
    let index = this.buffer.indexOf('\r\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      if (line) void this.handleLine(line);
      index = this.buffer.indexOf('\r\n');
    }
  }

  private async handleLine(line: string): Promise<void> {
    const message = parseIrcLine(line);

    switch (message.command) {
      case 'PING':
        this.send(`PONG :${message.params[0] ?? ''}`);
        return;
      case 'CAP':
        if (message.params[1] === 'ACK' && this.password) {
          this.send('AUTHENTICATE PLAIN');
        }
        return;
      case 'AUTHENTICATE':
        if (message.params[0] === '+' && this.password) {
          this.send(`AUTHENTICATE ${encodeSaslPlain(this.username ?? this.nick, this.password)}`);
        }
        return;
      case '903': // SASL authentication successful
        this.send('CAP END');
        return;
      case '904': // SASL authentication failed
      case '905':
        this.status = 'failed';
        this.send('CAP END');
        return;
      case '001': // RPL_WELCOME — registration complete
        this.registered = true;
        if (this.channel) this.send(`JOIN ${this.channel}`);
        return;
      case 'PRIVMSG':
        await this.handlePrivmsg(message);
        return;
      default:
        return;
    }
  }

  private async handlePrivmsg(message: IrcMessage): Promise<void> {
    const target = message.params[0];
    const text = message.params[1];
    if (!target || !text) return;

    const sender = nickFromPrefix(message.prefix);
    if (!sender || sender === this.nick) return;

    const event = normalizeChannelEvent({
      text,
      provider: this.kind,
      principalId: sender,
      workspacePath: process.cwd(),
    });
    await this.onEvent(event);
  }

  private sendPrivmsg(target: string, text: string): void {
    this.send(`PRIVMSG ${target} :${text}`);
  }

  private send(line: string): void {
    this.socket?.write(`${line}\r\n`);
  }
}

export function parseIrcLine(line: string): IrcMessage {
  let rest = line;
  let prefix: string | undefined;

  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ');
    prefix = rest.slice(1, space);
    rest = rest.slice(space + 1);
  }

  const params: string[] = [];
  while (rest.length > 0) {
    if (rest.startsWith(':')) {
      params.push(rest.slice(1));
      break;
    }
    const space = rest.indexOf(' ');
    if (space === -1) {
      params.push(rest);
      break;
    }
    params.push(rest.slice(0, space));
    rest = rest.slice(space + 1);
  }

  const command = params.shift() ?? '';
  return { prefix, command, params };
}

function nickFromPrefix(prefix: string | undefined): string | undefined {
  if (!prefix) return undefined;
  const bang = prefix.indexOf('!');
  return bang === -1 ? prefix : prefix.slice(0, bang);
}

export function encodeSaslPlain(username: string, password: string): string {
  // SASL PLAIN payload: authzid \0 authcid \0 passwd, base64-encoded.
  return Buffer.from(`${username} ${username} ${password}`, 'utf8').toString('base64');
}
