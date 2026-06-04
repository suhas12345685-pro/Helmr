# Production Checklist

- `HELMR_PRODUCTION=true` or `NODE_ENV=production`.
- `HELMR_API_TOKEN` is long, unique, and secret.
- `HELMR_ALLOWED_ORIGINS` contains exact HTTPS origins, not `*`.
- State, config, audit, and backup directories exist with restrictive permissions.
- Channel allowlists/pairing are enabled.
- Tool and write approval policies are enabled.
- Per-job/day/month budgets and token caps are configured.
- `helmr security audit` and `npm run verify:deployment` pass.
