import { timingSafeEqual } from 'node:crypto';

export interface ApiAuthInput {
  configuredToken?: string;
  authorizationHeader?: string;
  method: string;
  path: string;
}

export type ApiAuthDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 403; error: string };

const PUBLIC_PATHS = new Set(['/health']);

export function evaluateApiAuth(input: ApiAuthInput): ApiAuthDecision {
  if (input.method === 'OPTIONS' || PUBLIC_PATHS.has(input.path)) {
    return { allowed: true };
  }

  const token = input.configuredToken?.trim();
  if (!token) {
    return { allowed: true };
  }

  const header = input.authorizationHeader?.trim();
  if (!header?.startsWith('Bearer ')) {
    return { allowed: false, status: 401, error: 'missing bearer token' };
  }

  const provided = header.slice('Bearer '.length);
  if (!safeTokenEquals(provided, token)) {
    return { allowed: false, status: 403, error: 'invalid bearer token' };
  }

  return { allowed: true };
}

export function safeTokenEquals(provided: string, configured: string): boolean {
  const providedBytes = Buffer.from(provided);
  const configuredBytes = Buffer.from(configured);

  if (providedBytes.length !== configuredBytes.length) {
    return false;
  }

  return timingSafeEqual(providedBytes, configuredBytes);
}
