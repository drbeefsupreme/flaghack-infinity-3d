#!/usr/bin/env sh
set -eu

if [ "${GODOT_BIN:-}" != "" ]; then
  GODOT="$GODOT_BIN"
elif command -v godot4.6 >/dev/null 2>&1; then
  GODOT="$(command -v godot4.6)"
elif command -v godot4 >/dev/null 2>&1; then
  GODOT="$(command -v godot4)"
elif command -v godot >/dev/null 2>&1; then
  GODOT="$(command -v godot)"
else
  echo "No Godot binary found. Set GODOT_BIN to a Godot 4.6 executable." >&2
  exit 127
fi

exec "$GODOT" --headless --path "$(pwd)" -s res://addons/gut/gut_cmdln.gd -gconfig=res://.gutconfig.json "$@"
