# Secret and credential scan

Purpose: make sure nothing credential-shaped, identity-bearing or machine-specific is published
from this repository. Run the checks below before publishing a branch; the automated guard
covers the mechanical part.

Last run: branch `port/ios-completion`, and a full-history pass over **every** commit.

## Automated guard

```sh
./scripts/check-local-path-leaks.sh
```

It fails on:

| Class | What it catches |
|---|---|
| Home paths | any absolute `Users`/`home` directory path (macOS/Linux/Windows forms) |
| Usernames | the current machine's short name in any path |
| Personal email | consumer mail domains in **tracked files** *and* in commit metadata (`main..HEAD`) |
| Signing artefacts | any tracked `.p12 .pfx .cer .key .mobileprovision .provisionprofile` |
| API-key shapes | `AIza…`, `sk-…`, `ghp_…`, `xox[baprs]-…` — with one explicit allowlist entry, see below |

## Manual checks and their results

| Check | Command | Result |
|---|---|---|
| Private keys | `git grep -nE 'BEGIN (RSA \|EC \|OPENSSH )?PRIVATE KEY'` | none |
| Provider tokens | `git grep -nE 'ghp_\|gho_\|sk-\|xox[baprs]-\|AKIA'` | none |
| `.env` / credential files | `git ls-files \| grep -iE '\.env\|credentials\|secrets\|\.pem$\|\.p12$'` | only `src-tauri/src/secrets.rs` (source code, not a credential file) |
| Cookies / auth headers | `git grep -nEi '"(cookie\|authorization\|sapisid\|__Secure-)'` | only crate names in `Cargo.lock` |
| JWT-shaped literals | `git grep -nE 'eyJ[A-Za-z0-9_-]{20,}\.'` | two **test fixtures** in `lyrics/providers.rs` (`eyJhbGciOi.eyJzdWIiOi.sig-part`) — dummy strings |
| Signed/expiring URLs | `git grep -lE 'googlevideo\.com.*(sig\|expire)='` | only a unit-test fixture with a fixed `expire=1700000000` |
| Keystore material | `git ls-files \| grep -iE 'provision\|keystore\|\.jks$\|\.p8$'` | only `keystore.properties.example`, whose passwords are empty |
| Personal identity in history | `git log --all -S'<personal email>'`, `-S'<home-path prefix>'`, `-S'<device name>'` | clean — purged by the history rewrite (see `BUGFIX_LOG.md` §E) |
| Key-shaped strings in history | every commit scanned via `git rev-list --all` | one hit: `src/lib/poToken.ts` (below) |

## The one finding, and why it stays

`src/lib/poToken.ts` contains:

```ts
const GOOG_API_KEY = "AIzaSyDyT5W0…";   // value truncated here on purpose
```

- It is Google's **public** InnerTube web API key, the same class of key every YouTube web
  client ships; it identifies the *client*, not a user, and carries no billing or account scope.
- It was introduced by the **upstream** project (commit `4a791f5 feat(stream): PO token
  minting`) and is present in the recorded baseline `2122110`, i.e. it is already public in the
  original repository. Removing it here would break PO-token minting without improving secrecy.
- It is therefore listed in the guard's `ALLOWLIST` with that justification, so the check still
  fails on *new* key material while allowing this known public constant.

## Not secrets, but present on purpose

| Item | Why it is committed |
|---|---|
| `DEVELOPMENT_TEAM = Z2GA3JXA8J` (generated project + `tauri.ios.conf.json`) | A team identifier is not a credential; it appears inside every signed binary and is required for the build to sign at all |
| Bundle id `com.hushio.app.iosdev` | Public application identity |
| `keystore.properties.example` | Placeholder file with empty passwords, upstream |
| Local ports, host names, API base URLs | Public endpoints or loopback addresses |

## If a real secret is ever committed

1. **Rotate it first.** Removing it from git does not un-publish it.
2. Remove it from the working tree, then rewrite the affected commits (`git filter-branch` or
   `git filter-repo`), force-push, and prune:
   ```sh
   git reflog expire --expire=now --all && git gc --prune=now
   ```
3. Verify with `git log --all -S'<secret>'` and by re-running the guard.
4. Add the shape to `scripts/check-local-path-leaks.sh` so it cannot recur.
