# Exposure Runbook

Before exposing Helmr beyond localhost:

1. Set `HELMR_PRODUCTION=true`.
2. Set a unique `HELMR_API_TOKEN` of at least 32 characters.
3. Set `HELMR_ALLOWED_ORIGINS` to exact HTTPS origins, never `*`.
4. Put Gateway behind TLS reverse proxy.
5. Enable pairing/allowlists for channels.
6. Configure budgets, audit logs, backups, and write approval policy.
7. Run `helmr security audit` and `npm run verify:deployment`.
