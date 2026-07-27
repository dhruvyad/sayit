#!/bin/bash
# Draw the app icon and compile it to .icns.
#
# The icon is generated rather than committed as a binary: it is the same
# five-bar waveform the speech bubble uses, so the two cannot drift.

set -euo pipefail
OUT="${1:?usage: icon.sh <output.icns>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

swiftc -O -framework AppKit -o "$WORK/icongen" "$HERE/Sources/IconGen/main.swift"
"$WORK/icongen" "$WORK/Saynow.iconset"
iconutil -c icns "$WORK/Saynow.iconset" -o "$OUT"
