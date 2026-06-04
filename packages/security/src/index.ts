import { stat } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';

export interface ApiAuthInput {
  configuredToken?: string;
  authorizationHeader?: string;
  method: string;
  path: string;
  nodeEnv?: string;
  helmrProduction?: string;
  requireAuth?: string;
  authMode?: string;
  bindHost?: string;
}

export type ApiAuthDecision =
  | { allowed: true; authRequired: boolean; reason: string }
  | { allowed: false; status: 401 | 403 | 503; error: string; authRequired: boolean; reason: string };

export interface ExposureInput {
  nodeEnv?: string;
  helmrProduction?: string;
  requireAuth?: string;
  authMode?: string;
  bindHost?: string;
}

const PUBLIC_PATHS = new Set(['/health']);
const LOOPBACK_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1', '[::1]']);

export function isLoopbackHost(host: string | undefined): boolean {
  const normalized = (host ?? '').trim().toLowerCase();
  return LOOPBACK_HOSTS.has(normalized);
}

export function isPublicBindHost(host: string | undefined): boolean {
  const normalized = (host ?? '').trim().toLowerCase();
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '[::]' || (!isLoopbackHost(normalized) && normalized.length > 0);
}

export function authIsRequired(input: ExposureInput = {}): { required: boolean; reason: string } {
  // Fail-closed conditions take precedence over any development auth override so a
  // stale HELMR_AUTH_MODE=none can never re-open a production / required-auth deployment.
  if (input.helmrProduction === 'true') return { required: true, reason: 'HELMR_PRODUCTION=true' };
  if (input.nodeEnv === 'production') return { required: true, reason: 'NODE_ENV=production' };
  if (input.requireAuth === 'true') return { required: true, reason: 'HELMR_REQUIRE_AUTH=true' };
  if (isPublicBindHost(input.bindHost)) return { required: true, reason: 'Gateway bind host is not loopback' };
  if (input.authMode === 'none') return { required: false, reason: 'explicit development auth override' };
  return { required: false, reason: 'loopback development mode' };
}

export function evaluateApiAuth(input: ApiAuthInput): ApiAuthDecision {
  if (PUBLIC_PATHS.has(input.path)) {
    return { allowed: true, authRequired: false, reason: 'public health endpoint' };
  }

  if (input.method === 'OPTIONS') {
    const auth = authIsRequired(input);
    return auth.required
      ? { allowed: false, status: 401, error: 'preflight requires an authenticated deployment policy', authRequired: true, reason: auth.reason }
      : { allowed: true, authRequired: false, reason: 'development preflight' };
  }

  const auth = authIsRequired(input);
  const token = input.configuredToken?.trim();
  if (!token) {
    if (auth.required) {
      return { allowed: false, status: 503, error: `HELMR_API_TOKEN is required when ${auth.reason}`, authRequired: true, reason: auth.reason };
    }
    if (input.authMode === 'none') {
      return { allowed: true, authRequired: false, reason: auth.reason };
    }
    return { allowed: false, status: 401, error: 'missing bearer token; set HELMR_AUTH_MODE=none only for local development', authRequired: false, reason: 'implicit open API denied' };
  }

  const header = input.authorizationHeader?.trim();
  if (!header?.startsWith('Bearer ')) {
    return { allowed: false, status: 401, error: 'missing bearer token', authRequired: auth.required, reason: auth.reason };
  }
  const provided = header.slice('Bearer '.length);
  if (!safeTokenEquals(provided, token)) {
    return { allowed: false, status: 403, error: 'invalid bearer token', authRequired: auth.required, reason: auth.reason };
  }
  return { allowed: true, authRequired: auth.required, reason: auth.reason };
}

export function safeTokenEquals(provided: string, configured: string): boolean {
  const providedBytes = Buffer.from(provided);
  const configuredBytes = Buffer.from(configured);
  if (providedBytes.length !== configuredBytes.length) return false;
  return timingSafeEqual(providedBytes, configuredBytes);
}

export function validateAllowedOrigins(value: string | undefined, production = false): { ok: boolean; issues: string[] } {
  const origins = (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const issues: string[] = [];
  if (production && origins.length === 0) issues.push('HELMR_ALLOWED_ORIGINS must be set in production.');
  if (production && origins.includes('*')) issues.push('Wildcard CORS is forbidden in production.');
  for (const origin of origins) {
    if (origin !== '*' && !/^https?:\/\/[^\s]+$/.test(origin)) issues.push(`Invalid origin: ${origin}`);
  }
  return { ok: issues.length === 0, issues };
}

export function redactSecrets(input: string): string {
  return input
    .replace(/(HELMR_API_TOKEN=)[^\s]+/g, '$1[REDACTED]')
    .replace(/(api[_-]?key["'\s:=]+)[^"'\s,}]+/gi, '$1[REDACTED]')
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]');
}

export interface SecurityAuditCheck { name: string; passed: boolean; severity: 'info' | 'warning' | 'critical'; detail: string }

export async function runSecurityAudit(env: NodeJS.ProcessEnv = process.env): Promise<SecurityAuditCheck[]> {
  const production = env.HELMR_PRODUCTION === 'true' || env.NODE_ENV === 'production';
  const checks: SecurityAuditCheck[] = [];
  const auth = authIsRequired({ nodeEnv: env.NODE_ENV, helmrProduction: env.HELMR_PRODUCTION, requireAuth: env.HELMR_REQUIRE_AUTH, authMode: env.HELMR_AUTH_MODE, bindHost: env.HELMR_BIND_HOST });
  checks.push({ name: 'production_mode', passed: production, severity: production ? 'info' : 'warning', detail: production ? 'Production mode is enabled.' : 'Production mode is not enabled.' });
  checks.push({ name: 'api_token_configured', passed: Boolean(env.HELMR_API_TOKEN?.trim()), severity: auth.required ? 'critical' : 'warning', detail: env.HELMR_API_TOKEN ? 'API token is configured.' : 'HELMR_API_TOKEN is missing.' });
  checks.push({ name: 'auth_required', passed: auth.required || env.HELMR_AUTH_MODE === 'none', severity: auth.required ? 'info' : 'warning', detail: auth.reason });
  checks.push({ name: 'cors_origins', passed: validateAllowedOrigins(env.HELMR_ALLOWED_ORIGINS, production).ok, severity: 'critical', detail: validateAllowedOrigins(env.HELMR_ALLOWED_ORIGINS, production).issues.join('; ') || 'Allowed origins look safe.' });
  checks.push({ name: 'public_bind', passed: !isPublicBindHost(env.HELMR_BIND_HOST) || Boolean(env.HELMR_API_TOKEN), severity: 'critical', detail: isPublicBindHost(env.HELMR_BIND_HOST) ? `Gateway binds to ${env.HELMR_BIND_HOST}.` : 'Gateway bind host is loopback/default.' });
  checks.push({ name: 'write_approval_policy', passed: env.HELMR_WRITE_APPROVAL_POLICY !== 'none', severity: 'warning', detail: env.HELMR_WRITE_APPROVAL_POLICY ? `Policy: ${env.HELMR_WRITE_APPROVAL_POLICY}` : 'Default approval gates apply.' });
  checks.push({ name: 'budget_limits', passed: Boolean(env.HELMR_DAILY_BUDGET_USD || env.HELMR_JOB_BUDGET_USD), severity: 'warning', detail: env.HELMR_DAILY_BUDGET_USD || env.HELMR_JOB_BUDGET_USD ? 'Budget limit configured.' : 'No explicit budget limit configured.' });
  checks.push({ name: 'audit_log', passed: Boolean(env.HELMR_AUDIT_LOG || env.HELMR_DATA_DIR), severity: 'warning', detail: env.HELMR_AUDIT_LOG || env.HELMR_DATA_DIR ? 'Audit/state location configured.' : 'No audit log location configured.' });
  checks.push({ name: 'backup_available', passed: Boolean(env.HELMR_BACKUP_DIR), severity: 'warning', detail: env.HELMR_BACKUP_DIR ? 'Backup directory configured.' : 'No backup directory configured.' });
  checks.push({ name: 'dangerous_provider_config', passed: env.HELMR_PROVIDER_ALLOW_INSECURE_HTTP !== 'true', severity: 'critical', detail: env.HELMR_PROVIDER_ALLOW_INSECURE_HTTP === 'true' ? 'Insecure provider HTTP is enabled.' : 'No dangerous provider override detected.' });
  checks.push({ name: 'channel_exposure', passed: env.HELMR_CHANNEL_DM_POLICY !== 'open', severity: 'warning', detail: env.HELMR_CHANNEL_DM_POLICY === 'open' ? 'DM policy is open.' : 'Channels are pairing/allowlist by default.' });
  checks.push({ name: 'tool_permissions', passed: env.HELMR_ALLOW_UNAPPROVED_TOOLS !== 'true', severity: 'critical', detail: env.HELMR_ALLOW_UNAPPROVED_TOOLS === 'true' ? 'Unapproved tools are allowed.' : 'Tool approvals are enforced by default.' });
  await addFileModeCheck(checks, 'state_dir_permissions', env.HELMR_DATA_DIR, 0o077);
  await addFileModeCheck(checks, 'secrets_file_permissions', env.HELMR_SECRETS_FILE, 0o077);
  return checks;
}

async function addFileModeCheck(checks: SecurityAuditCheck[], name: string, file: string | undefined, forbiddenMask: number): Promise<void> {
  if (!file) {
    checks.push({ name, passed: false, severity: 'warning', detail: 'Path is not configured.' });
    return;
  }
  try {
    const mode = (await stat(file)).mode & 0o777;
    checks.push({ name, passed: (mode & forbiddenMask) === 0, severity: 'warning', detail: `${file} mode ${mode.toString(8)}` });
  } catch {
    checks.push({ name, passed: false, severity: 'warning', detail: `${file} does not exist or is not readable.` });
  }
}

export function formatSecurityAudit(checks: SecurityAuditCheck[]): string {
  return checks.map((check) => `${check.passed ? 'PASS' : 'FAIL'} [${check.severity}] ${check.name}: ${check.detail}`).join('\n');
}
