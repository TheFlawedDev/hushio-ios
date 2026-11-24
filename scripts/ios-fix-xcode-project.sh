#!/usr/bin/env bash
# Re-apply the two settings the generated iOS project needs, and regenerate it.
#
# WHY: `tauri ios init` (and any change of Tauri/toolchain version) regenerates
# src-tauri/gen/apple/project.yml from the CLI's internal template, which drops project
# tweaks this port depends on:
#
#   1. ENABLE_USER_SCRIPT_SANDBOXING = NO
#      Xcode 15+ sandboxes build-phase scripts. The "Build Rust Code" phase must read
#      gen/apple/.tauri/cli-options-server.json, written by the parent `tauri ios build`
#      process. Inside the sandbox that read is denied and the build dies with
#          error: Sandbox: node(...) deny(1) file-read-data .../cli-options-server.json
#          failed to read ...: Operation not permitted (os error 1)
#      This affects build-time scripts only - not the app's runtime sandbox.
#
#   2. DEVELOPMENT_TEAM
#      Normally written by `tauri ios build` from bundle.iOS.developmentTeam; it is set
#      here too so an xcodegen run between init and build cannot lose it.
#
# Idempotent: safe to run any time. Read-only with respect to application code.
#
#   ./scripts/ios-fix-xcode-project.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SPEC="src-tauri/gen/apple/project.yml"
PROJ="src-tauri/gen/apple/hushio-desktop.xcodeproj/project.pbxproj"
CONF="src-tauri/tauri.ios.conf.json"

[[ -f "$SPEC" ]] || { echo "error: $SPEC not found - run 'pnpm exec tauri ios init' first" >&2; exit 2; }
[[ -f "$CONF" ]] || { echo "error: $CONF not found" >&2; exit 2; }

team="$(python3 - "$CONF" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
print((cfg.get("bundle", {}).get("iOS", {}) or {}).get("developmentTeam") or "")
PY
)"

patched=0
if ! grep -q 'ENABLE_USER_SCRIPT_SANDBOXING' "$SPEC"; then
  python3 - "$SPEC" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
s = p.read_text()
needle = "    settings:\n      base:\n"
if needle not in s:
    raise SystemExit("could not find the app target settings block in project.yml")
s = s.replace(needle, needle +
  "        # Build-phase scripts must read .tauri/cli-options-server.json; Xcode's script\n"
  "        # sandbox denies it and the Rust build step fails (see scripts/ios-fix-xcode-project.sh).\n"
  "        ENABLE_USER_SCRIPT_SANDBOXING: NO\n", 1)
p.write_text(s)
PY
  patched=1
  echo "patched $SPEC"
else
  echo "already present in $SPEC: ENABLE_USER_SCRIPT_SANDBOXING"
fi

if [[ -n "$team" ]] && ! grep -q "DEVELOPMENT_TEAM" "$SPEC"; then
  python3 - "$SPEC" "$team" <<'PY'
import sys, pathlib
p, team = pathlib.Path(sys.argv[1]), sys.argv[2]
s = p.read_text()
needle = "    settings:\n      base:\n"
s = s.replace(needle, needle + f'        DEVELOPMENT_TEAM: {team}\n', 1)
p.write_text(s)
PY
  patched=1
  echo "patched $SPEC with DEVELOPMENT_TEAM"
fi

if [[ "$patched" -eq 1 || ! -f "$PROJ" ]]; then
  if command -v xcodegen >/dev/null 2>&1; then
    ( cd src-tauri/gen/apple && xcodegen generate --spec project.yml --project . >/dev/null )
    echo "regenerated project with xcodegen"
  else
    echo "xcodegen not found; run 'pnpm exec tauri ios build' to regenerate the project" >&2
  fi
fi

if grep -q 'ENABLE_USER_SCRIPT_SANDBOXING = NO' "$PROJ" 2>/dev/null; then
  echo "ok: generated project disables user script sandboxing"
else
  echo "warning: $PROJ does not show ENABLE_USER_SCRIPT_SANDBOXING = NO yet" >&2
fi
