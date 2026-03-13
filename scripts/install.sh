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

agent_display_name() {
  case "$1" in
    codex) echo "Codex" ;;
    claude) echo "Claude" ;;
    *) echo "$1" ;;
  esac
}

prompt_for_default_agent() {
  AVAILABLE_AGENTS=()

  if command -v codex >/dev/null 2>&1; then
    AVAILABLE_AGENTS+=("codex")
  fi

  if command -v claude >/dev/null 2>&1; then
    AVAILABLE_AGENTS+=("claude")
  fi

  SELECTED_AGENT=""
  SELECTED_AGENT_REASON=""

  if [ "${#AVAILABLE_AGENTS[@]}" -eq 0 ]; then
    SELECTED_AGENT_REASON="No supported agent detected. After installing Codex or Claude, run 'secureskills enable <agent>' inside a repo."
    return
  fi

  if [ -n "${PLATO_DEFAULT_AGENT:-}" ]; then
    case "$PLATO_DEFAULT_AGENT" in
      codex|claude)
        if command -v "$PLATO_DEFAULT_AGENT" >/dev/null 2>&1; then
          SELECTED_AGENT="$PLATO_DEFAULT_AGENT"
          return
        fi
        SELECTED_AGENT_REASON="$(agent_display_name "$PLATO_DEFAULT_AGENT") was selected through PLATO_DEFAULT_AGENT but is not installed. Skipping shell hook setup."
        return
        ;;
      skip)
        SELECTED_AGENT_REASON="Shell hook setup skipped through PLATO_DEFAULT_AGENT=skip."
        return
        ;;
      *)
        SELECTED_AGENT_REASON="Ignoring invalid PLATO_DEFAULT_AGENT value: $PLATO_DEFAULT_AGENT"
        return
        ;;
    esac
  fi

  if [ ! -t 0 ]; then
    SELECTED_AGENT_REASON="Supported agents were detected, but installer input is non-interactive. Set PLATO_DEFAULT_AGENT=codex, PLATO_DEFAULT_AGENT=claude, or PLATO_DEFAULT_AGENT=skip to control hook setup."
    return
  fi

  if [ "${#AVAILABLE_AGENTS[@]}" -eq 1 ]; then
    local detected_agent="${AVAILABLE_AGENTS[0]}"
    local detected_name
    detected_name="$(agent_display_name "$detected_agent")"
    local reply
    printf 'Install the PlaTo %s shell hook now? [Y/n] ' "$detected_name"
    read -r reply
    case "$reply" in
      ""|y|Y|yes|YES)
        SELECTED_AGENT="$detected_agent"
        return
        ;;
      *)
        SELECTED_AGENT_REASON="$detected_name shell hook skipped. You can install it later with 'secureskills enable $detected_agent'."
        return
        ;;
    esac
  fi

  echo "Both Codex and Claude are installed."
  echo "Choose which PlaTo shell hook to preinstall first:"
  echo "  1) Codex"
  echo "  2) Claude"
  echo "  3) Skip for now"
  local choice
  printf 'Selection [1-3]: '
  read -r choice
  case "$choice" in
    1|"")
      SELECTED_AGENT="codex"
      ;;
    2)
      SELECTED_AGENT="claude"
      ;;
    3)
      SELECTED_AGENT_REASON="Shell hook setup skipped. You can enable either agent later with 'secureskills enable <agent>'."
      ;;
    *)
      SELECTED_AGENT_REASON="Invalid selection. Shell hook setup skipped."
      ;;
  esac
}

install_selected_agent_hook() {
  if [ -z "$SELECTED_AGENT" ]; then
    AGENT_MESSAGE="$SELECTED_AGENT_REASON"
    return
  fi

  local real_agent_path
  real_agent_path="$(command -v "$SELECTED_AGENT")"
  local display_name
  display_name="$(agent_display_name "$SELECTED_AGENT")"

  echo "$display_name detected. Installing PlaTo $display_name shell hook."
  if PLATO_REAL_BINARY_PATH="$real_agent_path" node "$INSTALL_DIR/bin/secureskills.js" install-shell "$SELECTED_AGENT"; then
    AGENT_MESSAGE="$display_name shell hook installed. Open a new terminal or run 'exec zsh' once."
  else
    echo "Warning: failed to install the $display_name shell hook. You can retry later with 'secureskills enable $SELECTED_AGENT'." >&2
    AGENT_MESSAGE="$display_name shell hook was not installed."
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

  prompt_for_default_agent
  install_selected_agent_hook

  cat <<'EOF'

PlaTo installed.

Try:
  secureskills --help
  secureskills add https://github.com/vercel-labs/skills --skill find-skills
  secureskills enable codex
  secureskills enable claude
  secureskills uninstall
EOF
  echo
  echo "$AGENT_MESSAGE"
}

main "$@"
