#!/bin/bash
# Build Saynow.app.
#
# There is no Xcode project on purpose: swiftc plus a hand-written Info.plist
# is the whole toolchain, so the app builds from a clone with nothing but the
# command line tools installed.
#
#   ./app/build.sh            build into app/build/Saynow.app
#   ./app/build.sh --install  build, then move it to /Applications and open it

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
BUILD="$HERE/build"
APP="$BUILD/Saynow.app"

VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null \
  || grep -m1 '"version"' "$ROOT/package.json" | cut -d'"' -f4)"

if ! command -v swiftc >/dev/null; then
  echo "saynow: swiftc not found. Install the Xcode command line tools:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi

echo "Building Saynow.app $VERSION"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc \
  -O \
  -target arm64-apple-macos14.0 \
  -framework SwiftUI -framework AppKit \
  -o "$APP/Contents/MacOS/Saynow" \
  "$HERE"/Sources/*.swift

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Saynow</string>
  <key>CFBundleDisplayName</key><string>Saynow</string>
  <key>CFBundleIdentifier</key><string>ai.saynow.settings</string>
  <key>CFBundleExecutable</key><string>Saynow</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleIconFile</key><string>Saynow</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticTermination</key><true/>
</dict>
</plist>
PLIST

"$HERE/icon.sh" "$APP/Contents/Resources/Saynow.icns" 2>/dev/null || \
  echo "  (no icon generated — continuing)"

# Ad-hoc signature. Enough for the machine that built it; distributing to
# anyone else needs a Developer ID and notarisation.
codesign --force --deep --sign - "$APP" 2>/dev/null || \
  echo "  (could not ad-hoc sign — the app will still run locally)"

echo "Built $APP"

if [[ "${1:-}" == "--install" ]]; then
  DEST="/Applications/Saynow.app"
  rm -rf "$DEST"
  cp -R "$APP" "$DEST"
  echo "Installed $DEST"
  open "$DEST"
fi
