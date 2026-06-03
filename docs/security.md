# Security

Helmr fails closed for private APIs. `/health` is public; all private routes require bearer auth when `HELMR_PRODUCTION=true`, `NODE_ENV=production`, `HELMR_REQUIRE_AUTH=true`, or the bind host is not loopback.

Local unauthenticated development requires `HELMR_AUTH_MODE=none` and is rejected in production. Tokens are compared in constant time. Do not expose Gateway without TLS, explicit origins, and a long random token.

Run:

```bash
helmr security audit
npm run verify:deployment
```
