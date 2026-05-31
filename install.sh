#!/usr/bin/env bash
# Helmr bootstrap installer (POSIX/macOS/Linux/WSL2).
#
# Usage:
#   curl -fsSL https://helmr.ai/install.sh | bash
#   curl -fsSL https://helmr.ai/install.sh | bash -s -- --dry-run
#
# This is a thin wrapper. It verifies Node.js/npm, prints what it will do, and
# then hands off to `create-helmr@latest`, which owns the real onboarding.
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    --help|-h)
      echo "Usage: install.sh [--dry-run]"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

MIN_NODE_MAJOR=18

info()  { printf '  %s\n' "$1"; }
step()  { printf '\n==> %s\n' "$1"; }
fail()  { printf 'Error: %s\n' "$1" >&2; exit 1; }

step "Helmr setup"
if [ "$DRY_RUN" -eq 1 ]; then
  info "Dry run: prerequisites are checked and intended actions are printed only."
  info "No packages are installed and no daemons are started."
fi

step "1. Checking operating system and shell"
UNAME="$(uname -s 2>/dev/null || echo unknown)"
info "OS: $UNAME"
if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
  info "Environment: WSL2 detected"
fi

step "2. Checking Node.js, npm, and Git"
command -v node >/dev/null 2>&1 || fail "Node.js not found. Install Node.js >= ${MIN_NODE_MAJOR} from https://nodejs.org"
NODE_VERSION="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  fail "Node.js >= ${MIN_NODE_MAJOR} is required (found ${NODE_VERSION})."
fi
info "Node.js ${NODE_VERSION} OK"

command -v npm >/dev/null 2>&1 || fail "npm not found. Install Node.js from https://nodejs.org"
info "npm $(npm --version) OK"

if command -v git >/dev/null 2>&1; then
  info "git $(git --version | awk '{print $3}') OK"
else
  info "git not found (optional, recommended)"
fi

step "3. Bootstrapping Helmr via create-helmr"
if [ "$DRY_RUN" -eq 1 ]; then
  info "Would run: npm create helmr@latest -- --dry-run"
  step "Dry run complete"
  info "Re-run without --dry-run to install Helmr and open Hatchery onboarding."
  exit 0
fi

info "Running: npm create helmr@latest"
npm create helmr@latest

step "Helmr bootstrap finished"
info "Continue setup in Hatchery: http://localhost:4000"
