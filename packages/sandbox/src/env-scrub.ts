/** Environment keys that are safe to forward to a sandboxed process. */
export const DEFAULT_ALLOWED_ENV: readonly string[] = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'NODE_ENV',
  'SYSTEMROOT',
  'COMSPEC',
];

/** Keys whose names imply a secret value; dropped unless explicitly allowed. */
const SECRET_KEY_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|SESSION|COOKIE)/i;

export interface ScrubEnvOptions {
  allow?: readonly string[];
  denySecrets?: boolean;
}

/**
 * Produces a filtered environment for a sandboxed child process. Only allowed
 * keys survive, and keys whose names look like secrets are dropped even if
 * present in the allow list (unless `denySecrets` is disabled). Undefined
 * values are removed so the result is a plain string map.
 */
export function scrubEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options: ScrubEnvOptions = {},
): Record<string, string> {
  const allow = new Set((options.allow ?? DEFAULT_ALLOWED_ENV).map((key) => key));
  const denySecrets = options.denySecrets ?? true;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (!allow.has(key)) {
      continue;
    }
    if (denySecrets && SECRET_KEY_PATTERN.test(key)) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

export function keyLooksSecret(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}
