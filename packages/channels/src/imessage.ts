import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PairingStore } from './pairing.js';
import { normalizeChannelEvent, type ChannelAdapter, type ChannelInfo, type ChannelStatus, type EventEmitter } from './types.js';

const execFileAsync = promisify(execFile);

export interface IMessageAdapterOptions {
  adminHandle?: string;
  /** Override the host platform (defaults to process.platform); used for tests. */
  platform?: NodeJS.Platform;
  /** Override the AppleScript sender; used for tests. */
  sendViaAppleScript?: (handle: string, text: string) => Promise<void>;
  onEvent: EventEmitter;
}

interface IMessageInbound {
  handle?: string;
  text?: string;
}

/**
 * iMessage adapter (architecture section 16.11). macOS-only and explicitly
 * opt-in: it never silently modifies system files, the Messages database, or
 * privacy permissions. Sending uses AppleScript via `osascript`; inbound
 * messages are supplied by an external bridge to {@link handleMessage}.
 */
export class IMessageAdapter implements ChannelAdapter {
  readonly name = 'iMessage';
  readonly kind = 'imessage';

  private status: ChannelStatus = 'not_configured';
  private adminHandle: string | undefined;
  private connectedAt: string | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly sendViaAppleScript: (handle: string, text: string) => Promise<void>;
  private readonly pairingStore = new PairingStore();
  private readonly onEvent: EventEmitter;

  constructor(options: IMessageAdapterOptions) {
    this.adminHandle = options.adminHandle;
    this.platform = options.platform ?? process.platform;
    this.sendViaAppleScript = options.sendViaAppleScript ?? defaultAppleScriptSender;
    this.onEvent = options.onEvent;
    if (this.adminHandle) this.status = 'credentials_entered';
  }

  getStatus(): ChannelStatus { return this.status; }

  getInfo(): ChannelInfo {
    return { name: this.name, kind: this.kind, status: this.status, paired: this.status === 'active', connectedAt: this.connectedAt };
  }

  async configure(credentials: Record<string, string>): Promise<void> {
    if (!credentials.adminHandle) throw new Error('adminHandle (Apple ID or phone number) required');
    this.adminHandle = credentials.adminHandle;
    this.status = 'credentials_entered';
  }

  async startPairing(adminHandle: string): Promise<{ code: string; expiresAt: string }> {
    this.assertMacOs();
    const { code, expiresAt } = this.pairingStore.create(adminHandle);
    await this.sendViaAppleScript(adminHandle, `Your Helmr pairing code: ${code} (expires at ${expiresAt})`);
    return { code, expiresAt };
  }

  async confirmPairing(code: string): Promise<boolean> {
    const adminHandle = this.pairingStore.consume(code);
    if (!adminHandle) return false;
    this.connectedAt = new Date().toISOString();
    this.status = 'active';
    return true;
  }

  async start(): Promise<void> {
    this.assertMacOs();
    if (this.status !== 'active') throw new Error('Channel must be active before starting');
  }

  async stop(): Promise<void> {
    // Inbound delivery is bridge-driven; nothing to tear down locally.
  }

  async handleMessage(message: IMessageInbound): Promise<void> {
    const text = message.text;
    const sender = message.handle;
    if (!text || !sender) return;
    const event = normalizeChannelEvent({
      text,
      provider: this.kind,
      principalId: sender,
      workspacePath: process.cwd(),
    });
    await this.onEvent(event);
  }

  private assertMacOs(): void {
    if (this.platform !== 'darwin') throw new Error('iMessage is only available on macOS');
  }
}

async function defaultAppleScriptSender(handle: string, text: string): Promise<void> {
  const script = [
    'on run {targetHandle, messageBody}',
    '  tell application "Messages"',
    '    set targetService to 1st account whose service type = iMessage',
    '    set targetBuddy to participant targetHandle of targetService',
    '    send messageBody to targetBuddy',
    '  end tell',
    'end run',
  ].join('\n');
  await execFileAsync('osascript', ['-e', script, handle, text]);
}
