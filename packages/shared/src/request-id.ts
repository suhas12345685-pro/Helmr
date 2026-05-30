import { randomUUID } from 'node:crypto';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function normalizeRequestId(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (trimmed && SAFE_REQUEST_ID.test(trimmed)) {
    return trimmed;
  }
  return `req_${randomUUID()}`;
}
