#!/usr/bin/env bash
# Guard against committing local machine paths and usernames.
#
# Scans every file tracked by git (build artifacts, node_modules, and other
# ignored paths are therefore excluded) and fails if it finds an absolute
# home-directory path ("/Users/", "/home/", or "C:/Users/") or the current
# machine's short username embedded in a path. This is a last line of defense
# against leaking a developer's name or filesystem layout into the repository.
#
# Run manually:
#   ./scripts/check-local-path-leaks.sh
#
# Install as a pre-commit hook for this worktree:
#   cp scripts/check-local-path-leaks.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Optional: also catch specific known usernames on any machine without
# hardcoding them here (comma/colon separated):
#   LEAK_USERNAMES="alice,bob" ./scripts/check-local-path-leaks.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: not inside a git worktree" >&2
  exit 2
fi

# Files skipped from scanning: (a) test fixtures that legitimately contain
# placeholder home paths ("/Users/me", "/Users/é", "/home/u", "/home/me",
# "C:/Users/amang"), and (b) this script itself, which embeds those same path
# patterns as search data. Keep the fixtures fixture-only and do not add real
# machine paths here — a real path in a skipped file would be hidden.
ALLOWLIST=(
  "scripts/check-local-path-leaks.sh"
  "src-tauri/src/media_controls.rs"
  "src/lib/artwork.test.ts"
  "src-tauri/src/linux_portal.rs"
  "src-tauri/src/reveal.rs"
  "src/lib/importPlaylistFile.test.ts"
  "src/lib/localLibrary.test.ts"
)

# Absolute home-directory paths. The leading non-word boundary keeps this from
# matching relative paths such as "phone/home/homeStream" in prose.
HOME_RE='(^|[^A-Za-z0-9_])(/Users/|/home/|[Cc]:/[Uu]sers/)'

# Personal email domains. Test fixtures use example.com; a real consumer mail address in a
# committed file is PII (an Apple ID in a signing note, an author in a script), so it fails
# like a home path does. Version pins (`pkg@1.2.3`) never match: the domain list decides.
EMAIL_RE='[A-Za-z0-9._%+-]+@(gmail|googlemail|icloud|me|mac|outlook|hotmail|live|yahoo|proton|protonmail|aol|gmx|zoho)\.(com|me|net|org)'

# Signing artefacts that must never be committed.
SECRET_FILE_RE='\.(p12|pfx|cer|key|mobileprovision|provisionprofile)$'

# Usernames to catch even without a home-directory prefix. Self-adapts to the
# current machine, plus any names supplied via LEAK_USERNAMES.
names=()
current_user="$(id -un 2>/dev/null || true)"
if [[ -n "$current_user" ]]; then
  names+=("$current_user")
fi
if [[ -n "${LEAK_USERNAMES:-}" ]]; then
  IFS=',:' read -r -a extra <<< "$LEAK_USERNAMES"
  names+=("${extra[@]}")
fi

fail=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue

  skip=0
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$file" == "$allowed" ]]; then
      skip=1
      break
    fi
  done
  [[ "$skip" -eq 1 ]] && continue

  [[ -f "$file" ]] || continue

  # -I: binary files never match, so screenshots and other blobs are ignored.
  if grep -q -E -I -- "$HOME_RE" "$file" 2>/dev/null; then
    echo "leak: $file contains an absolute home path" >&2
    fail=1
  fi
  for name in "${names[@]}"; do
    [[ -z "$name" ]] && continue
    if grep -q -F -I "/$name/" "$file" 2>/dev/null; then
      echo "leak: $file contains '/$name/'" >&2
      fail=1
      break
    fi
  done
  if grep -q -E -I -- "$EMAIL_RE" "$file" 2>/dev/null; then
    echo "leak: $file contains a personal email address" >&2
    fail=1
  fi
  if printf '%s' "$file" | grep -qE "$SECRET_FILE_RE"; then
    echo "leak: $file is a signing/certificate artefact" >&2
    fail=1
  fi
done <<< "$(git ls-files)"

if [[ "$fail" -ne 0 ]]; then
  echo "local path/username leak detected — refusing to continue" >&2
  exit 1
fi

echo "ok: no local path/username leaks"
