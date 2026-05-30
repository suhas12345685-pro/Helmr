export type ContentLengthDecision =
  | { allowed: true }
  | { allowed: false; status: 400 | 413; error: string };

export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export function getMaxBodyBytes(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BODY_BYTES;
}

export function evaluateContentLength(rawLength: string | undefined, maxBytes: number): ContentLengthDecision {
  if (rawLength === undefined) {
    return { allowed: true };
  }

  const length = Number.parseInt(rawLength, 10);
  if (!Number.isFinite(length) || length < 0) {
    return { allowed: false, status: 400, error: 'invalid content-length' };
  }

  if (length > maxBytes) {
    return { allowed: false, status: 413, error: 'request body too large' };
  }

  return { allowed: true };
}
