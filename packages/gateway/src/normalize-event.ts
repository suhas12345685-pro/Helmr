import { randomUUID } from 'node:crypto';

import {
  CapabilitySchema,
  HelmrEventSchema,
  type Capability,
  type HelmrEvent,
} from '../../shared/src/schemas.js';

export { HelmrEventSchema };
export type { Capability, HelmrEvent };

export type NormalizationOptions = {
  createId?: () => string;
  now?: () => Date;
};

export type CliEventInput = {
  text: string;
  workspacePath: string;
  workspaceId?: string;
  principalId?: string;
  requestedCapabilities?: Capability[];
  attachments?: HelmrEvent['payload']['attachments'];
};

export type ApiEventInput = {
  body: {
    text?: string;
    payload?: {
      text?: string;
      attachments?: HelmrEvent['payload']['attachments'];
    };
    workspace: HelmrEvent['workspace'];
    principal: HelmrEvent['principal'];
    requestedCapabilities?: Capability[];
  };
};

export function normalizeCliEvent(
  input: CliEventInput,
  options: NormalizationOptions = {},
): HelmrEvent {
  return parseEvent({
    id: createEventId(options),
    createdAt: createTimestamp(options),
    source: 'cli',
    principal: {
      id: input.principalId ?? 'local-owner',
      type: 'local-user',
      trustLevel: 'owner',
    },
    workspace: {
      id: input.workspaceId ?? 'local',
      path: input.workspacePath,
    },
    payload: createPayload(input.text, input.attachments),
    requestedCapabilities: createCapabilities(input.requestedCapabilities),
  });
}

export function normalizeApiEvent(
  input: ApiEventInput,
  options: NormalizationOptions = {},
): HelmrEvent {
  return parseEvent({
    id: createEventId(options),
    createdAt: createTimestamp(options),
    source: 'api',
    principal: input.body.principal,
    workspace: input.body.workspace,
    payload: createPayload(input.body.text ?? input.body.payload?.text, input.body.payload?.attachments),
    requestedCapabilities: createCapabilities(input.body.requestedCapabilities),
  });
}

function createEventId(options: NormalizationOptions): string {
  return options.createId?.() ?? `evt_${randomUUID()}`;
}

function createTimestamp(options: NormalizationOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function createPayload(
  text: string | undefined,
  attachments: HelmrEvent['payload']['attachments'],
): HelmrEvent['payload'] {
  const normalizedText = sanitizeEventText(text).trim();

  if (!normalizedText) {
    throw new Error('Event text is required');
  }

  return attachments === undefined
    ? { text: normalizedText }
    : { text: normalizedText, attachments };
}

export function sanitizeEventText(text: string | undefined): string {
  return (text ?? '')
    .normalize('NFC')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .replace(/[\r\n\t]+/gu, ' ');
}

function createCapabilities(capabilities: Capability[] | undefined): Capability[] {
  const normalized = capabilities ?? ['workspace_read'];

  for (const capability of normalized) {
    CapabilitySchema.parse(capability);
  }

  return normalized;
}

function parseEvent(event: HelmrEvent): HelmrEvent {
  return HelmrEventSchema.parse(event);
}
