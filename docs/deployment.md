# Helmr Deployment

Status: deployment packaging
Last updated: 2026-05-31

This guide covers running the Helmr control plane (Gateway + Hatchery API) as a
container or as a systemd service, and backing up the durable state it owns.

All deployments must satisfy the production gate in
[`production-readiness.md`](./production-readiness.md). The artifacts here set
`HELMR_PRODUCTION=true`, so `helmr self-test` will refuse to start with an
unsafe configuration (missing/short token, wildcarded origins, unsafe limits,
or non-explicit data/config directories).

## Ports

| Service      | Port | Notes                                                |
| ------------ | ---- | ---------------------------------------------------- |
| Gateway      | 3999 | Intake API. Token-gated. `GET /health` is public.    |
| Hatchery API | 4000 | Dashboard/approvals. Token-gated and CORS-restricted. |

## Durable state

Everything Helmr must not lose lives under one directory tree:

- `$HELMR_DATA_DIR/helmr.db` — SQLite control-plane state (jobs, plans,
  approvals, receipts, results, schema version, workspace locks).
- `$HELMR_AUDIT_DIR/*.jsonl` — append-only, hash-chained audit evidence.
- `$HELMR_CONFIG_DIR` — markdown policy/config, channel pairing, and
  `secrets.json` (owner-only, 0600) holding provider API keys configured via
  Hatchery onboarding.

In the container these default to `/var/lib/helmr`, mounted as a named volume.

## Provider keys: environment vs. persisted store

Provider keys can be supplied two ways, and both survive a restart:

- **Environment** — set in `.env` / the systemd `EnvironmentFile`. These always
  take precedence.
- **Hatchery onboarding** — keys entered in the UI are persisted to
  `secrets.json` under the config directory and restored into the environment
  at startup. Keep the config directory on durable storage (the volume above)
  and back it up; treat `secrets.json` as sensitive.

## Option A — Docker / Compose

```bash
cat > .env <<'EOF'
HELMR_API_TOKEN=$(openssl rand -hex 24)
HELMR_ALLOWED_ORIGINS=https://hatchery.example.com
HELMR_MODEL=anthropic/claude-sonnet-4-5
ANTHROPIC_API_KEY=sk-...
EOF

docker compose up -d --build
docker compose exec helmr node dist/src/cli.js self-test
docker compose logs -f helmr
```

The image runs as a non-root `helmr` user, ships only production dependencies,
and declares a `HEALTHCHECK` against the Gateway `/health` endpoint.

## Option B — systemd (no container)

Build and stage the app on the host, then install the unit:

```bash
npm ci && npm run build:ts        # produces dist/
sudo mkdir -p /opt/helmr && sudo cp -r dist package.json package-lock.json node_modules /opt/helmr/
# (or run `npm ci --omit=dev` inside /opt/helmr for a prod-only tree)

sudo useradd --system --home-dir /var/lib/helmr --create-home helmr
sudo install -d -o helmr -g helmr /var/lib/helmr/data /var/lib/helmr/config
sudo install -d -m 0750 /etc/helmr
sudo cp deploy/helmr.env.example /etc/helmr/helmr.env   # edit secrets, chmod 600
sudo cp deploy/helmr.service /etc/systemd/system/helmr.service

sudo systemctl daemon-reload
sudo systemctl enable --now helmr
systemctl status helmr
```

The unit runs `helmr self-test` as `ExecStartPre`, so an unsafe production
config prevents the service from starting. It is sandboxed with
`ProtectSystem=strict` and only `/var/lib/helmr` writable.

## Windows service

Helmr is a Node process, so the simplest supported path on Windows is to wrap
`node dist\src\cli.js start all` with a service manager such as
[NSSM](https://nssm.cc/):

```powershell
nssm install Helmr "C:\Program Files\nodejs\node.exe" "C:\helmr\dist\src\cli.js" start all
nssm set Helmr AppDirectory C:\helmr
nssm set Helmr AppEnvironmentExtra HELMR_PRODUCTION=true HELMR_DATA_DIR=C:\ProgramData\helmr\data HELMR_CONFIG_DIR=C:\ProgramData\helmr\config
# set HELMR_API_TOKEN / HELMR_ALLOWED_ORIGINS / HELMR_MODEL / provider key the same way
nssm start Helmr
```

## Backup and restore

The state is a single directory tree, so backup is a consistent copy of it.
SQLite must be backed up with a SQLite-aware method (not a raw `cp` of a live
database file) to avoid copying a torn write. Helmr also exposes
`backupHelmrState` / `restoreHelmrState` from `packages/memory/src/backup.ts`
for automation; the helper uses SQLite `VACUUM INTO` for the database snapshot
and recursively copies audit/config directories.

Backup (daemon may keep running):

```bash
# Online, consistent SQLite snapshot:
sqlite3 "$HELMR_DATA_DIR/helmr.db" ".backup '/backup/helmr.db'"
# Append-only audit log + config copy straight across:
cp -a "$HELMR_AUDIT_DIR" /backup/audit
cp -a "$HELMR_CONFIG_DIR" /backup/config
```

Restore (daemon stopped):

```bash
systemctl stop helmr            # or: docker compose down
cp -a /backup/helmr.db "$HELMR_DATA_DIR/helmr.db"
cp -a /backup/audit/.   "$HELMR_AUDIT_DIR/"
cp -a /backup/config/.  "$HELMR_CONFIG_DIR/"
systemctl start helmr           # or: docker compose up -d
```

After restoring, verify integrity:

- `helmr self-test` should pass (confirms the DB opens, schema version is
  recorded, and the audit hash-chain verifier is available).
- The hash-chained audit logs detect tampering per job; a restored chain that
  fails verification indicates a corrupt or partial copy.

## Schema migrations and rollback

The control-plane schema is managed by versioned, reversible migrations
(`packages/memory/src/migrations.ts`). On startup the store applies any pending
forward migrations automatically and records each version in
`schema_migrations`.

Both upgrades and rollbacks take an automatic, SQLite-consistent snapshot
(`VACUUM INTO`) into `$HELMR_DATA_DIR/migration-backups/` first, so the
operation is always recoverable even if it fails partway.

```bash
# Inspect the current vs. latest schema version:
helmr migrate status

# Roll the schema back to an earlier version (e.g. before a bad upgrade).
# A pre-rollback snapshot is written automatically.
helmr migrate rollback 1
```

Rolling back runs each migration's reverse step newest-first. Re-running the
daemon (or `helmr migrate status`) re-applies the forward migrations, so an
upgrade → rollback → upgrade cycle is safe and idempotent. Databases created by
older single-version initializers are backfilled with their full migration
history on first run, so intermediate rollbacks work on existing deployments.

> Even with rollback support, take a backup with the steps above **before** a
> major upgrade. Down-migrations that drop columns or tables are inherently
> lossy for the data in them; restoring a pre-upgrade snapshot is the safest way
> to recover the original state in full.
