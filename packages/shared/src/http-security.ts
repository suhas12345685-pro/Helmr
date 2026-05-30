export const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
};

export function getAllowedOrigins(raw: string | undefined): string[] {
  const parsed = raw
    ?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return parsed && parsed.length > 0 ? parsed : ['http://localhost:4000'];
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  return origin === undefined || allowedOrigins.includes(origin);
}
