import { z } from 'zod';
import { randomUUID } from 'node:crypto';

export const HELMR_PROTOCOL_VERSION = '2026-06-03';

export const GatewayMessageTypeSchema = z.enum([
  'HELLO',
  'AUTH',
  'HEARTBEAT',
  'EVENT',
  'REQUEST',
  'RESPONSE',
  'ERROR',
  'APPROVAL_REQUEST',
  'APPROVAL_DECISION',
  'JOB_STATUS',
  'CHANNEL_EVENT',
  'TOOL_RECEIPT',
  'AUDIT_EVENT',
]);
export type GatewayMessageType = z.infer<typeof GatewayMessageTypeSchema>;

export const PrincipalSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['user', 'agent', 'service', 'channel', 'anonymous']).default('anonymous'),
  displayName: z.string().optional(),
});

export const GatewayEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: GatewayMessageTypeSchema,
  protocolVersion: z.literal(HELMR_PROTOCOL_VERSION),
  timestamp: z.string().datetime({ offset: true }),
  requestId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  principal: PrincipalSchema.optional(),
  idempotencyKey: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type GatewayEnvelope = z.infer<typeof GatewayEnvelopeSchema>;

export const HelloPayloadSchema = z.object({ client: z.string().min(1).optional(), server: z.string().min(1).optional(), capabilities: z.array(z.string()).default([]), protocolVersion: z.string().optional() });
export const AuthPayloadSchema = z.object({ scheme: z.enum(['bearer']), token: z.string().min(1) });
export const HeartbeatPayloadSchema = z.object({ intervalMs: z.number().int().positive().optional() });
export const ErrorPayloadSchema = z.object({ code: z.string().min(1), message: z.string().min(1), retryable: z.boolean().default(false) });
export const JobStatusPayloadSchema = z.object({ jobId: z.string().min(1), status: z.enum(['queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'paused']), detail: z.string().optional() });
export const ApprovalDecisionPayloadSchema = z.object({ approvalId: z.string().min(1), decision: z.enum(['approved', 'denied']), reason: z.string().optional() });
export const ToolReceiptPayloadSchema = z.object({ tool: z.string().min(1), receiptId: z.string().min(1), approved: z.boolean(), budgetUsd: z.number().nonnegative().optional() });

export const GatewayPayloadSchemas: Record<GatewayMessageType, z.ZodTypeAny> = {
  HELLO: HelloPayloadSchema,
  AUTH: AuthPayloadSchema,
  HEARTBEAT: HeartbeatPayloadSchema,
  EVENT: z.record(z.string(), z.unknown()),
  REQUEST: z.record(z.string(), z.unknown()),
  RESPONSE: z.record(z.string(), z.unknown()),
  ERROR: ErrorPayloadSchema,
  APPROVAL_REQUEST: z.record(z.string(), z.unknown()),
  APPROVAL_DECISION: ApprovalDecisionPayloadSchema,
  JOB_STATUS: JobStatusPayloadSchema,
  CHANNEL_EVENT: z.record(z.string(), z.unknown()),
  TOOL_RECEIPT: ToolReceiptPayloadSchema,
  AUDIT_EVENT: z.record(z.string(), z.unknown()),
};

export const GatewayErrorCode = {
  InvalidJson: 'invalid_json',
  InvalidProtocol: 'invalid_protocol',
  UnsupportedProtocol: 'unsupported_protocol',
  Unauthorized: 'unauthorized',
  MissingIdempotencyKey: 'missing_idempotency_key',
} as const;

export type GatewayErrorCode = (typeof GatewayErrorCode)[keyof typeof GatewayErrorCode];

export function validateGatewayMessage(input: unknown): GatewayEnvelope {
  const envelope = GatewayEnvelopeSchema.parse(input);
  GatewayPayloadSchemas[envelope.type].parse(envelope.payload);
  if (['REQUEST', 'EVENT', 'APPROVAL_DECISION'].includes(envelope.type) && !envelope.idempotencyKey) {
    throw new Error('idempotencyKey is required for side-effecting Gateway messages');
  }
  if (!envelope.requestId && !envelope.correlationId) {
    throw new Error('requestId or correlationId is required');
  }
  return envelope;
}

export function safeParseGatewayMessage(input: unknown): { ok: true; message: GatewayEnvelope } | { ok: false; error: string } {
  try {
    return { ok: true, message: validateGatewayMessage(input) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function makeGatewayMessage(type: GatewayMessageType, payload: Record<string, unknown> = {}, options: Partial<Omit<GatewayEnvelope, 'type' | 'payload' | 'protocolVersion' | 'timestamp' | 'id'>> & { id?: string } = {}): GatewayEnvelope {
  return validateGatewayMessage({
    id: options.id ?? `msg_${randomUUID()}`,
    type,
    protocolVersion: HELMR_PROTOCOL_VERSION,
    timestamp: new Date().toISOString(),
    requestId: options.requestId,
    correlationId: options.correlationId ?? options.requestId ?? `corr_${randomUUID()}`,
    principal: options.principal,
    idempotencyKey: options.idempotencyKey,
    payload,
  });
}

export function makeErrorMessage(code: GatewayErrorCode, message: string, correlationId?: string): GatewayEnvelope {
  return makeGatewayMessage('ERROR', { code, message, retryable: false }, { correlationId: correlationId ?? `corr_${randomUUID()}` });
}
