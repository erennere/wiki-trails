#!/bin/bash
# Builds a small Mac app that installs the Wiki Trails extension in Safari, and opens it.
# Needs a Mac with Xcode (free from the App Store). Run from the repository folder, with the
# unzipped extension folder (the one with manifest.json in it):
#   bash scripts/package_safari.sh ~/Downloads/wiki-trails-extension
# or, after `npm run build:extension`, with no folder (it then uses dist/extension).
# Then: Safari > Settings > Extensions > tick "Wiki Trails", and allow it on wikipedia.org.
set -euo pipefail
SRC="${1:-}"
[ -n "$SRC" ] && SRC="$(cd "$SRC" && pwd)"
cd "$(dirname "$0")/.."
SRC="${SRC:-$PWD/dist/extension}"
OUT="dist/safari"
if [ ! -f "$SRC/manifest.json" ]; then
  echo "No extension in $SRC. Give the unzipped wiki-trails-extension folder, or run 'npm run build:extension' first." >&2
  exit 1
fi
# a copy without "key" (it only fixes the extension's id in Edge and Chrome; Safari doesn't use it)
EXT="$(mktemp -d)/Wiki Trails"
cp -R "$SRC" "$EXT"
python3 - "$EXT/manifest.json" <<'PY'
import json, sys
p = sys.argv[1]; m = json.load(open(p)); m.pop('key', None); json.dump(m, open(p, 'w'), indent=2)
PY
TOOL=safari-web-extension-packager                      # Xcode 26 and later
xcrun --find "$TOOL" >/dev/null 2>&1 || TOOL=safari-web-extension-converter   # its older name
rm -rf "$OUT"
xcrun "$TOOL" "$EXT" --project-location "$OUT" --app-name "Wiki Trails" \
  --bundle-identifier "${BUNDLE_ID:-io.github.wikitrails}" --swift --macos-only \
  --copy-resources --no-open --no-prompt --force
PROJ="$(find "$OUT" -maxdepth 3 -name '*.xcodeproj' | head -1)"
SCHEME="$(xcodebuild -list -json -project "$PROJ" | python3 -c 'import json,sys; s=json.load(sys.stdin)["project"]["schemes"]; print(next((x for x in s if "macOS" in x), s[0]))')"
xcodebuild -project "$PROJ" -scheme "$SCHEME" -configuration Release -derivedDataPath "$OUT/build" build | tail -3
APP="$(find "$OUT/build/Build/Products/Release" -maxdepth 1 -name '*.app' | head -1)"
echo "Opening $APP"
open "$APP"
echo "Now: Safari > Settings > Extensions > tick 'Wiki Trails'."
echo "If it isn't listed: open $PROJ in Xcode, choose your Apple ID under Signing & Capabilities for both targets, and press Run."
