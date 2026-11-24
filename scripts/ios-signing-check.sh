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
# `devicectl` reports pairing; `xcdevice` reports what Xcode will build for. Neither
# reflects Developer Mode, which `devicectl device info details` does - and Developer Mode
# OFF is the failure people actually hit, so both views are printed.
dev_output="$(python3 "$(dirname "${BASH_SOURCE[0]}")/ios-devices.py" 2>/dev/null || true)"
dm="$(printf '%s\n' "$dev_output" | sed -n 's/^DEVELOPER_MODE=//p')"
if printf '%s\n' "$dev_output" | grep -q '^NO_DEVICES$'; then
  say "  none paired (see HUMAN_STEPS.md H1)"
else
  printf '%s\n' "$dev_output" | grep -v '^DEVELOPER_MODE=' | while IFS='|' read -r name avail reason; do
    [[ -z "$name" ]] && continue
    say "  $name — Xcode usable: $avail — $reason"
  done
fi
say "  Developer Mode: ${dm:-Unknown}"
usable="$(printf '%s\n' "$dev_output" | grep -c '|yes|' || true)"
say "  devices Xcode considers available: ${usable:-0}"

section "Generated project"
if grep -q 'ENABLE_USER_SCRIPT_SANDBOXING = NO' src-tauri/gen/apple/hushio-desktop.xcodeproj/project.pbxproj 2>/dev/null; then
  say "  build-phase script sandboxing: disabled (required — otherwise the Rust step"
  say "    cannot read .tauri/cli-options-server.json)"
else
  say "  build-phase script sandboxing: ENABLED — the Rust build step will fail with"
  say "    'Sandbox: node(...) deny(1) file-read-data .../cli-options-server.json'"
  say "    fix: ./scripts/ios-fix-xcode-project.sh"
fi
if grep -q 'DEVELOPMENT_TEAM' src-tauri/gen/apple/hushio-desktop.xcodeproj/project.pbxproj 2>/dev/null; then
  say "  DEVELOPMENT_TEAM is embedded (written by \`tauri ios build\`)"
else
  say "  DEVELOPMENT_TEAM not embedded yet — it appears after the first \`tauri ios build\`"
fi

section "Verdict"
if [[ "$dm" == "Disabled" ]]; then
  say "  BLOCKED: the paired iPhone has Developer Mode turned OFF."
  say "  xcodebuild: \"error: Developer Mode disabled — to use the device for"
  say "  development, enable Developer Mode in Settings -> Privacy & Security.\""
  say "  On the phone: Settings -> Privacy & Security -> Developer Mode -> On,"
  say "  tap Restart, then confirm \"Turn On\" after unlocking."
  say "  Then re-run this script (Developer Mode must read Enabled) and:"
  say "    cd src-tauri && pnpm exec tauri ios build --debug -t aarch64 --ci"
  say "  (that command already passes -allowProvisioningUpdates)."
elif [[ "${ids:-0}" -gt 0 && "${usable:-0}" -gt 0 ]]; then
  say "  signing looks possible: certificate present, device reachable, team wired"
  say "  next: cd src-tauri && pnpm exec tauri ios build --debug -t aarch64 --ci"
elif [[ "${usable:-0}" -gt 0 ]]; then
  say "  no certificate yet — a build will request one via -allowProvisioningUpdates"
  say "  (expect a keychain prompt: choose \"Always Allow\")"
else
  say "  BLOCKED: no reachable physical device."
  say "  A personal/free team cannot create a provisioning profile without one"
  say "  registered device; xcodebuild reports"
  say "    \"Your team has no devices from which to generate a provisioning profile.\""
  say "  Next: connect the iPhone by cable, tap Trust, then re-run this script."
fi
