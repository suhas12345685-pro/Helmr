# Deployment

## Docker

Use `deploy/docker-compose.yml` and set real secrets in an environment file. Helmr runs as a non-root container user and mounts `/var/lib/helmr` for state.

## systemd

Copy `deploy/helmr.service` to a user or system unit, set `EnvironmentFile`, then run `systemctl enable --now helmr`.

## Windows

Use WSL2 for production-like deployments. See `deploy/windows-service.md` for scheduled task guidance.

## Reverse proxy

TLS is required for production. See `deploy/reverse-proxy.md` for Caddy and Nginx examples.

## Backup and restore

Run `helmr backup <dir>` on a schedule. Restore by copying `data/` and `config/` back to the configured state directories while Helmr is stopped.
