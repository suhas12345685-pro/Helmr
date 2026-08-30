# Helmr Product Guide

Helmr is a dynamic self-hosted AI agent platform built around Gateway, Council, Governor, Runtime, skills, memory, channels, and Hatchery onboarding.

## Installation

Helmr offers multiple installation methods:

**Oneliners:**
- macOS and Linux:
  ```bash
  curl -fsSL https://helmr.ai/install.sh | bash
  ```
- Windows (PowerShell):
  ```powershell
  powershell -c "irm https://helmr.ai/install.ps1 | iex"
  ```

**Package Managers:**
- npm:
  ```bash
  npm i -g helmr
  ```
- pnpm:
  ```bash
  pnpm i -g helmr
  ```

**Beta releases:**
```bash
npm i -g helmr@beta
# or
pnpm i -g helmr@beta
```

After installation, initialize your environment:
```bash
# Meet your lobster
helmr onboard
```

## Key guidance

- Keep Gateway as the control-plane/routing hub.
- Keep Council as the decision and orchestration brain.
- Load skills dynamically at runtime from manifests; do not hardcode user skills.
- Require approvals, receipts, budgets, rollback, and audit logs for side effects.
- Treat inbound channel content as untrusted.
- Use explicit secrets and allowed origins for production.

## Operational checklist

1. Run `npm ci` and `npm run verify`.
2. Configure `HELMR_API_TOKEN`, `HELMR_ALLOWED_ORIGINS`, `HELMR_DATA_DIR`, `HELMR_CONFIG_DIR`, `HELMR_AUDIT_LOG`, and `HELMR_BACKUP_DIR`.
3. Run `helmr security audit`.
4. Run `npm run verify:deployment` with real production env.
5. Enable only channels, skills, tools, and providers required for the deployment.

See README.md and docs/audits/helmr-vs-openclaw-production-audit.md for the modernization context.
