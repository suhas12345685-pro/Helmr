#!/usr/bin/env bash
set -euo pipefail

GUM_BORDER_COLOR="#22d3ee"
GUM_ACCENT_COLOR="#f59e0b"
GUM_TEXT_COLOR="#f8fafc"

has_command() {
  command -v "$1" >/dev/null 2>&1
}

run_as_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif has_command sudo; then
    sudo "$@"
  else
    echo "Helmr requires elevated privileges to install missing system package: $*" >&2
    exit 1
  fi
}

install_gum_with_homebrew() {
  brew install gum >/dev/null 2>&1
}

install_gum_with_apt() {
  local keyring="/usr/share/keyrings/charm.gpg"
  local list_file="/etc/apt/sources.list.d/charm.list"

  run_as_root mkdir -p /etc/apt/keyrings /usr/share/keyrings

  if ! has_command curl; then
    run_as_root apt-get update -qq >/dev/null 2>&1
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates >/dev/null 2>&1
  fi

  if ! has_command gpg; then
    run_as_root apt-get update -qq >/dev/null 2>&1
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gnupg >/dev/null 2>&1
  fi

  curl -fsSL https://repo.charm.sh/apt/gpg.key | run_as_root gpg --dearmor -o "${keyring}" >/dev/null 2>&1
  echo "deb [signed-by=${keyring}] https://repo.charm.sh/apt/ * *" | run_as_root tee "${list_file}" >/dev/null
  run_as_root apt-get update -qq >/dev/null 2>&1
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gum >/dev/null 2>&1
}

ensure_gum() {
  if has_command gum; then
    return 0
  fi

  case "$(uname -s)" in
    Darwin)
      if ! has_command brew; then
        echo "Homebrew is required to install gum automatically on macOS: https://brew.sh" >&2
        exit 1
      fi
      install_gum_with_homebrew
      ;;
    Linux)
      if has_command apt-get; then
        install_gum_with_apt
      elif has_command brew; then
        install_gum_with_homebrew
      else
        echo "Could not install gum automatically. Install gum, then rerun this script: https://github.com/charmbracelet/gum" >&2
        exit 1
      fi
      ;;
    *)
      echo "Unsupported operating system for automatic gum installation: $(uname -s)" >&2
      exit 1
      ;;
  esac

  if ! has_command gum; then
    echo "gum installation completed but gum is not available on PATH." >&2
    exit 1
  fi
}

select_package_manager() {
  if [[ -f "pnpm-lock.yaml" ]] || has_command pnpm; then
    printf 'pnpm'
  else
    printf 'npm'
  fi
}

ensure_gum

gum style \
  --border double \
  --border-foreground "${GUM_BORDER_COLOR}" \
  --foreground "${GUM_TEXT_COLOR}" \
  --background "#0f172a" \
  --padding "1 4" \
  --margin "1 0" \
  --align center \
  "⚓ HELMR ARCHITECTURE FRAMEWORK"

package_manager="$(select_package_manager)"

gum spin \
  --spinner dot \
  --title "Checking Helmr dependencies and linking the global binary with ${package_manager}..." \
  --show-output=false \
  -- bash -c '
    set -euo pipefail
    manager="$1"
    if [[ "$manager" == "pnpm" ]]; then
      pnpm install -g . &> /dev/null
    else
      npm install -g . &> /dev/null
    fi
  ' _ "${package_manager}"

gum style \
  --foreground "${GUM_ACCENT_COLOR}" \
  --bold \
  "Helmr is linked. Launching onboarding..."

exec helmr onboard
