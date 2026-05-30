import type { SelfTestResult } from './self-test.js';

export type ProductionEnv = Record<string, string | undefined>;

export function getProductionReadinessChecks(env: ProductionEnv = process.env): SelfTestResult[] {
  if (env.HELMR_PRODUCTION !== 'true') {
    return [];
  }

  const apiToken = env.HELMR_API_TOKEN?.trim() ?? '';
  const allowedOrigins = parseCsv(env.HELMR_ALLOWED_ORIGINS);
  const rawRateLimit = env.HELMR_RATE_LIMIT_PER_MINUTE;
  const rateLimit = parseInteger(rawRateLimit);
  const rawBodyLimit = env.HELMR_MAX_BODY_BYTES;
  const bodyLimit = parseInteger(rawBodyLimit);
  const hasExplicitStateDirs = Boolean(env.HELMR_DATA_DIR?.trim() && env.HELMR_CONFIG_DIR?.trim());

  const matchesWildcard = allowedOrigins.some((origin) => origin === '*' || origin.includes('*'));

  return [
    {
      name: 'api_token',
      passed: apiToken.length >= 32,
      detail: apiToken.length >= 32
        ? 'HELMR_API_TOKEN is set with sufficient length'
        : `HELMR_API_TOKEN must be at least 32 chars. Found length: ${apiToken.length}`,
    },
    {
      name: 'allowed_origins',
      passed: allowedOrigins.length > 0 && !matchesWildcard,
      detail: allowedOrigins.length === 0
        ? 'HELMR_ALLOWED_ORIGINS is empty or missing'
        : matchesWildcard
          ? 'HELMR_ALLOWED_ORIGINS contains an invalid wildcard (*) character sequence'
          : `${allowedOrigins.length} allowed origin(s) successfully verified`,
    },
    {
      name: 'rate_limit',
      passed: rawRateLimit === undefined || (!Number.isNaN(rateLimit) && rateLimit !== undefined && rateLimit >= 1 && rateLimit <= 600),
      detail: rawRateLimit === undefined
        ? 'HELMR_RATE_LIMIT_PER_MINUTE defaults to 120'
        : Number.isNaN(rateLimit)
          ? `HELMR_RATE_LIMIT_PER_MINUTE configuration parse failure: "${rawRateLimit}" is not a valid base-10 integer`
          : `HELMR_RATE_LIMIT_PER_MINUTE=${rateLimit} (Verified range 1-600)`,
    },
    {
      name: 'body_limit',
      passed: rawBodyLimit === undefined || (!Number.isNaN(bodyLimit) && bodyLimit !== undefined && bodyLimit >= 1024 && bodyLimit <= 10_485_760),
      detail: rawBodyLimit === undefined
        ? 'HELMR_MAX_BODY_BYTES defaults to 1048576'
        : Number.isNaN(bodyLimit)
          ? `HELMR_MAX_BODY_BYTES configuration parse failure: "${rawBodyLimit}" is not a valid byte count integer`
          : `HELMR_MAX_BODY_BYTES=${bodyLimit} (Verified range 1024-10485760)`,
    },
    {
      name: 'state_dirs',
      passed: hasExplicitStateDirs,
      detail: hasExplicitStateDirs
        ? 'HELMR_DATA_DIR and HELMR_CONFIG_DIR explicitly isolated'
        : 'HELMR_DATA_DIR and HELMR_CONFIG_DIR environment variables must be non-empty paths in production',
    },
  ];
}

function parseCsv(raw: string | undefined): string[] {
  return raw
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function parseInteger(raw: string | undefined): number | undefined {
  if (!raw?.trim()) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
