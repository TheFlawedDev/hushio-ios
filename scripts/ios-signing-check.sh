#!/usr/bin/env bash
# Report iOS code-signing readiness for this project.
#
# Answers "why does `tauri ios build -t aarch64` fail to sign?" without guessing:
#   - which development team is configured,
#   - whether a signing certificate exists in the keychain,
#   - whether a physical device is connected (a personal/free team cannot mint a
#     provisioning profile without one registered device),
#   - whether the generated Xcode project carries the team.
#
# Read-only. Never creates certificates, registers devices, or edits the project.
#
#   ./scripts/ios-signing-check.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
CONF="src-tauri/tauri.ios.conf.json"

say() { printf '%s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }

section "Configured development team"
if [[ -f "$CONF" ]]; then
  team="$(python3 - "$CONF" <<'PY'
import json, sys
try:
    cfg = json.load(open(sys.argv[1]))
except Exception:
    print("")
    raise SystemExit
print((cfg.get("bundle", {}).get("iOS", {}) or {}).get("developmentTeam") or "")
PY
)"
  if [[ -n "$team" ]]; then
    say "  bundle.iOS.developmentTeam = $team  ($CONF)"
  else
    say "  (none in $CONF)"
  fi
else
  say "  (missing $CONF)"
fi
if [[ -n "${APPLE_DEVELOPMENT_TEAM:-}" ]]; then
  say "  APPLE_DEVELOPMENT_TEAM=$APPLE_DEVELOPMENT_TEAM overrides the config"
fi

section "Teams known to Xcode"
defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null \
  | grep -E 'teamID|teamName|isFreeProvisioningTeam' | sed 's/^/  /' \
  || say "  (none — add an Apple Account in Xcode > Settings > Accounts)"

section "Signing certificates in the keychain"
ids="$(security find-identity -v -p codesigning 2>/dev/null | grep -cE '"[^"]+"' || true)"
say "  $ids code-signing identit$( [[ "$ids" == "1" ]] && echo y || echo ies ) found"
security find-identity -v -p codesigning 2>/dev/null | grep -E '"[^"]+"' | sed 's/^/  /' || true

section "Physical devices"
# `devicectl` lists paired devices; `xcdevice` is Xcode's own view and is what decides
# whether a build can target the device at all. Report both, and trust xcdevice.
devices="$(xcrun devicectl list devices 2>/dev/null | grep -viE 'simulated|^Name|^---' | sed '/^$/d' || true)"
if [[ -z "$devices" ]]; then
  say "  none paired (devicectl)"
else
  printf '%s\n' "$devices" | sed 's/^/  /'
fi
on_usb="$(system_profiler SPUSBDataType 2>/dev/null | grep -icE 'iphone|ipad' || true)"
say "  USB attachment: ${on_usb} Apple device(s)"

usable="$(xcrun xcdevice list 2>/dev/null | python3 -c '
import json, sys
try:
    items = json.load(sys.stdin)
except Exception:
    print(0); raise SystemExit
print(sum(1 for x in items
          if not x.get("simulator")
          and x.get("available")
          and x.get("platform") == "com.apple.platform.iphoneos"))
' || echo 0)"
say "  devices Xcode considers available: ${usable}"

section "Generated project"
if grep -q 'DEVELOPMENT_TEAM' src-tauri/gen/apple/hushio-desktop.xcodeproj/project.pbxproj 2>/dev/null; then
  say "  DEVELOPMENT_TEAM is embedded (written by \`tauri ios build\`)"
else
  say "  DEVELOPMENT_TEAM not embedded yet — it appears after the first \`tauri ios build\`"
fi

section "Verdict"
if [[ "${ids:-0}" -gt 0 && "${usable:-0}" -gt 0 ]]; then
  say "  signing looks possible: certificate present and a device is reachable"
elif [[ "${usable:-0}" -gt 0 ]]; then
  say "  no certificate yet — a build will request one via -allowProvisioningUpdates"
  say "  (expect a keychain prompt: choose \"Always Allow\")"
else
  say "  BLOCKED: no reachable physical device."
  say "  A personal/free team cannot create a provisioning profile without one"
  say "  registered device; xcodebuild reports"
  say "    \"Your team has no devices from which to generate a provisioning profile.\""
  say "  Next: connect the iPhone by cable, trust this Mac, enable Developer Mode,"
  say "  then run:  pnpm exec tauri ios build --debug -t aarch64 --ci"
  say "  (that command already passes -allowProvisioningUpdates)."
fi
