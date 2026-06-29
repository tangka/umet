#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="${TEMU_WORKBENCH_BIN_DIR:-$HOME/.local/bin}"
rm -f "$BIN_DIR/temu-workbench"
echo "Removed $BIN_DIR/temu-workbench"
