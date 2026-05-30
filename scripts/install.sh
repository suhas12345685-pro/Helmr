#!/usr/bin/env bash
# Helmr one-line installer for macOS, Linux, and WSL2.
# Usage:
#   curl -fsSL https://helmr.ai/install.sh | bash
#   curl -fsSL https://helmr.ai/install.sh | bash -s -- --dry-run
#
# Flags:
#   --dry-run   Print what would happen without making changes.
#   --no-open   Do not open the Hatchery WebUI when setup completes.

set -euo pipefail

DRY_RUN=false
OPEN_BROWSER=true
MIN_NODE_MAJOR=18

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --no-open) OPEN_BROWSER=false ;;
    --help|-h)
      grep -E '^# ' "$0" | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

log() { printf '  %s\n' "$*"; }
banner() { printf '\n%s\n  %s\n%s\n' "$(printf '%.0s-' {1..60})" "$1" "$(printf '%.0s-' {1..60})"; }
run_or_print() {
  if [ "$DRY_RUN" = true ]; then
    printf '  [dry-run] %s\n' "$*"
  else
    eval "$@"
  fi
}

banner "Helmr installer"

# Detect OS and shell.
OS_NAME="$(uname -s)"
log "Platform: ${OS_NAME} ($(uname -m))"
if grep -qi microsoft /proc/version 2>/dev/null; then
  log "Detected WSL2 environment."
fi

# Detect Node.
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found. Install Node ${MIN_NODE_MAJOR}+ from https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
log "Node.js: $(node --version)"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  echo "Node.js ${MIN_NODE_MAJOR}+ is required; found v${NODE_MAJOR}." >&2
  exit 1
fi

# Detect npm.
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found. Reinstall Node from https://nodejs.org" >&2
  exit 1
fi
log "npm: $(npm --version)"

# Detect git (optional but recommended).
if command -v git >/dev/null 2>&1; then
  log "git: $(git --version | head -n1)"
else
  log "git: not found (recommended but not required)"
fi

# Run the create-helmr initializer.
banner "Running create-helmr@latest"
run_or_print "npm create helmr@latest"

if [ "$DRY_RUN" = true ]; then
  banner "Dry run complete — no changes made"
  exit 0
fi

if [ "$OPEN_BROWSER" = true ]; then
  URL="http://localhost:4000"
  banner "Opening Hatchery"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 || true
  fi
  log "Hatchery WebUI: $URL"
fi

banner "Helmr installed"
log "Run 'helmr ask \"summarize this workspace\"' to try the first job."
log "Run 'helmr self-test' to verify your environment."
