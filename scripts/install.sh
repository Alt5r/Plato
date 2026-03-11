#!/usr/bin/env bash

set -euo pipefail

REPO_URL="${PLATO_REPO_URL:-https://github.com/Alt5r/Plato.git}"
INSTALL_DIR="${PLATO_INSTALL_DIR:-$HOME/.local/share/plato}"

print_banner() {
  cat <<'EOF'
 ____  _       _____
|  _ \| | __ _|_   _|__
| |_) | |/ _` | | |/ _ \
|  __/| | (_| | | | (_) |
|_|   |_|\__,_| |_|\___/

Secure skill installs for coding agents
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_package_file() {
  if [ ! -f "$INSTALL_DIR/package.json" ]; then
    echo "Installer checkout is missing package.json: $INSTALL_DIR" >&2
    exit 1
  fi
}

clone_or_update_repo() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    git -C "$INSTALL_DIR" fetch --depth 1 origin main
    git -C "$INSTALL_DIR" checkout main
    git -C "$INSTALL_DIR" reset --hard origin/main
    return
  fi

  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
}

main() {
  print_banner
  require_command git
  require_command node
  require_command npm

  echo "Installing PlaTo into $INSTALL_DIR"
  clone_or_update_repo
  require_package_file

  echo "Running npm install -g $INSTALL_DIR"
  npm install -g "$INSTALL_DIR"

  if command -v codex >/dev/null 2>&1; then
    REAL_CODEX_PATH="$(command -v codex)"
    echo "Codex detected. Installing Plato Codex shell hook."
    if PLATO_CODEX_REAL_PATH="$REAL_CODEX_PATH" node "$INSTALL_DIR/bin/secureskills.js" install-codex-shell; then
      CODEX_MESSAGE="Codex shell hook installed. Open a new terminal or run 'exec zsh' once."
    else
      echo "Warning: failed to install the Codex shell hook. You can retry later with 'secureskills enable codex'." >&2
      CODEX_MESSAGE="Codex shell hook was not installed."
    fi
  else
    CODEX_MESSAGE="Codex not found. If you install Codex later, run 'secureskills enable codex' inside a repo."
  fi

  cat <<'EOF'

PlaTo installed.

Try:
  secureskills --help
  secureskills add https://github.com/vercel-labs/skills --skill find-skills
  secureskills enable codex
  secureskills uninstall
EOF
  echo
  echo "$CODEX_MESSAGE"
}

main "$@"
