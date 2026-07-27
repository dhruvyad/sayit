#!/bin/bash
# Build Saynow.app and place it, in the background, after an npm install.
#
# Run detached by scripts/postinstall.js so it cannot hold up the install.
# Every step is bounded and non-interactive: this runs on machines we know
# nothing about, and a prompt nobody can see is a hang.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
LOG="${TMPDIR:-/tmp}/saynow-app-install.log"

exec >"$LOG" 2>&1
echo "saynow: building the settings app at $(date)"

# A ceiling on the whole build. Without one, a stalled toolchain leaves a
# process running forever after an install the user has long forgotten.
LIMIT=180

run_with_limit() {
  "$@" &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$LIMIT" ]; then
      echo "saynow: build exceeded ${LIMIT}s, giving up"
      kill -9 "$pid" 2>/dev/null
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

# </dev/null so nothing can block on input it will never receive.
if ! run_with_limit bash "$ROOT/app/build.sh" </dev/null; then
  echo "saynow: could not build the app. Run 'saynow app install' to see why."
  exit 0
fi

DEST="/Applications"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"

rm -rf "$DEST/Saynow.app"
if cp -R "$ROOT/app/build/Saynow.app" "$DEST/Saynow.app"; then
  echo "saynow: installed $DEST/Saynow.app"
else
  echo "saynow: could not place the app in $DEST"
fi

exit 0
