#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      cat <<'HELP'
Helmr installer wrapper

Usage:
  curl -fsSL https://helmr.ai/install.sh | bash -s -- [--dry-run]

This thin wrapper verifies Node.js/npm and then invokes create-helmr@latest.
HELP
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

echo "Helmr installer"
echo "1. Check Node.js and npm"
echo "2. Invoke create-helmr@latest"
echo "3. Start Hatchery onboarding through the bootstrapper"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 18 or newer first." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js/npm first." >&2
  exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run: would execute npm exec create-helmr@latest -- --dry-run"
  echo "No packages were installed and no daemon was started."
else
  echo "Executing npm exec create-helmr@latest"
  npm exec create-helmr@latest -- "$@"
fi
