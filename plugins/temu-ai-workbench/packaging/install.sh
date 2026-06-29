#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${TEMU_WORKBENCH_BIN_DIR:-$HOME/.local/bin}"

first_executable() {
  for candidate in "$@"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  first_executable \
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" \
    "/Applications/Codex.app/Contents/Resources/cua_node/bin/node" && return 0

  find "$HOME/.cache/codex-runtimes" -maxdepth 6 -type f -name node -perm +111 2>/dev/null | head -1
}

NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then
  cat <<'EOF'
Missing Node.js, and Codex bundled Node was not found.

Install Codex Desktop or Node.js 22+, then run this installer again.
EOF
  exit 1
fi

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/temu-workbench" <<SH
#!/usr/bin/env bash
set -euo pipefail
export PATH="$(cd "$(dirname "$NODE_BIN")" && pwd):/opt/homebrew/bin:/usr/local/bin:\$HOME/.local/bin:\$PATH"
exec "$NODE_BIN" "$PACKAGE_ROOT/scripts/temu-workbench.mjs" "\$@"
SH
chmod +x "$BIN_DIR/temu-workbench"

"$BIN_DIR/temu-workbench" doctor || true

cat <<EOF
TEMU AI Workbench CLI installed.

Command: $BIN_DIR/temu-workbench
Plugin: $PACKAGE_ROOT

Next:
1. Run: temu-workbench doctor
2. Full dashboard/listing workflows require your own TEMU workspace.
3. Load assets/chrome-extension/chrome-mv3 in chrome://extensions/
EOF
