import type { SelfTestResult } from './self-test.js';

export type ProductionEnv = Record<string, string | undefined>;

export function getProductionReadinessChecks(env: ProductionEnv = process.env): SelfTestResult[] {
  if (env.HELMR_PRODUCTION !== 'true') {
    return [];
  }

  const apiToken = env.HELMR_API_TOKEN?.trim() ?? '';
  const allowedOrigins = parseCsv(env.HELMR_ALLOWED_ORIGINS);
  const rateLimit = parseInteger(env.HELMR_RATE_LIMIT_PER_MINUTE);
  const bodyLimit = parseInteger(env.HELMR_MAX_BODY_BYTES);
  const hasExplicitStateDirs = Boolean(env.HELMR_DATA_DIR?.trim() && env.HELMR_CONFIG_DIR?.trim());

  return [
    {
      name: 'api_token',
      passed: apiToken.length >= 32,
      detail: apiToken.length >= 32
        ? 'HELMR_API_TOKEN is set with sufficient length'
        : 'HELMR_API_TOKEN must be at least 32 characters when HELMR_PRODUCTION=true',
    },
    {
      name: 'allowed_origins',
      passed: allowedOrigins.length > 0 && !allowedOrigins.includes('*'),
      detail: allowedOrigins.length > 0 && !allowedOrigins.includes('*')
        ? `${allowedOrigins.length} allowed origin(s) configured`
        : 'HELMR_ALLOWED_ORIGINS must be explicitly set and cannot include *',
    },
    {
      name: 'rate_limit',
      passed: rateLimit === undefined || (rateLimit >= 1 && rateLimit <= 600),
      detail: rateLimit === undefined
        ? 'HELMR_RATE_LIMIT_PER_MINUTE defaults to 120'
        : rateLimit >= 1 && rateLimit <= 600
          ? `HELMR_RATE_LIMIT_PER_MINUTE=${rateLimit}`
          : 'HELMR_RATE_LIMIT_PER_MINUTE must be between 1 and 600',
    },
    {
      name: 'body_limit',
      passed: bodyLimit === undefined || (bodyLimit >= 1024 && bodyLimit <= 10_485_760),
      detail: bodyLimit === undefined
        ? 'HELMR_MAX_BODY_BYTES defaults to 1048576'
        : bodyLimit >= 1024 && bodyLimit <= 10_485_760
          ? `HELMR_MAX_BODY_BYTES=${bodyLimit}`
          : 'HELMR_MAX_BODY_BYTES must be between 1024 and 10485760',
    },
    {
      name: 'state_dirs',
      passed: hasExplicitStateDirs,
      detail: hasExplicitStateDirs
        ? 'HELMR_DATA_DIR and HELMR_CONFIG_DIR are explicit'
        : 'HELMR_DATA_DIR and HELMR_CONFIG_DIR must be explicit in production',
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
