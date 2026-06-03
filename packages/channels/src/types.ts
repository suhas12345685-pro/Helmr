import { randomUUID } from 'node:crypto';

import { HelmrEventSchema, type HelmrEvent } from '../../shared/src/index.js';

export type ChannelStatus =
  | 'not_configured'
  | 'instructions_viewed'
  | 'credentials_entered'
  | 'handshake_testing'
  | 'connected'
  | 'pairing_required'
  | 'paired'
  | 'active'
  | 'failed'
  | 'disabled';

export interface ChannelInfo {
  name: string;
  kind: string;
  status: ChannelStatus;
  paired: boolean;
  connectedAt?: string;
}

export interface ChannelAdapter {
  readonly name: string;
  readonly kind: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ChannelStatus;
  getInfo(): ChannelInfo;
  configure(credentials: Record<string, string>): Promise<void>;
  startPairing(adminId: string): Promise<{ code: string; expiresAt: string }>;
  confirmPairing(code: string): Promise<boolean>;
  /**
   * Restore the active runtime state for a channel that pairing already
   * confirmed and persisted (e.g. after a daemon restart). It must never be
   * called for a channel that has not completed pairing.
   */
  markPaired(): void;
  /**
   * Deliver an outbound message to a recipient on this channel (e.g. a job's
   * answer back to the originating chat). Optional: adapters without an outbound
   * transport simply omit it, and the worker logs that the reply was skipped.
   */
  send?(recipientId: string, text: string): Promise<void>;
}

export type EventEmitter = (event: HelmrEvent) => Promise<void>;

export interface ChannelEventInput {
  text: string;
  provider: string;
  principalId: string;
  workspacePath: string;
  workspaceId?: string;
}

export function normalizeChannelEvent(input: ChannelEventInput): HelmrEvent {
  const text = input.text.trim();
  if (!text) throw new Error('Event text is required');

  return HelmrEventSchema.parse({
    id: `evt_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    source: 'chat',
    principal: {
      id: `${input.provider}:${input.principalId}`,
      type: 'remote-user',
      trustLevel: 'limited',
    },
    workspace: {
      id: input.workspaceId ?? 'local',
      path: input.workspacePath,
    },
    payload: { text },
    requestedCapabilities: ['workspace_read'],
  });
}
