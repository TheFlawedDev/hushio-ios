# Hushio iPhone port — agent onboarding prompt

Copy the block below as the first message to any agent joining this work (subagent, `agy`,
pi, Claude, whatever). Replace the `<…>` placeholders. It is written to be self-contained:
it names what to read, what to distrust, the rules that have already cost days here, how to
verify, and how to report.

---

You are joining an in-progress iPhone port of **Hushio** (React + Zustand + Tauri; the
Android and desktop builds already exist and are authoritative). Worktree: this repo, branch
`port/ios-completion`, remote `fork` = `github.com:TheFlawedDev/hushio-ios.git`. The phone
app is built, signed, installed and running on a physical iPhone — playback, downloads and
deletion were verified on device today.

Target task: **<TASK — name an in-repo deliverable, e.g. "implement X in src/… + tests">**

## Read first, in this order (~15 min, do not skip)

1. `docs/ios-port/BUGFIX_LOG.md` — the only current state of the world. Sections A–E are
   history; **C-bis (C7–C11)** and **B6/B7** are the latest fixes; the final section,
   "Known outstanding at this commit", is your real task list.
2. `git log --oneline -12` plus the bodies of `2e03873` and `37de835` — they carry the
   measured evidence (numbers, what was ruled out, why).
3. `docs/ios-port/README.md` — document map only. Its line 3 is stale, ignore it.
4. `docs/ios-port/HANDOFF.md` §2–§4 and **§6**. §6 is the most expensive knowledge here:
   exactly one iOS plugin registration, every bridge call bounded (1.5 s), never
   `Runtime::block_on` in the mobile facade.
5. `docs/ios-port/DECISIONS.md` ADR-001/002/006/**007**. ADR-007 is binding: native owns
   transport only — never queue advance, repeat/shuffle, or item replacement.

Then read only what your task needs: `BEHAVIOR_CONTRACTS.md` (player semantics),
`FACADE_AUDIT.md` + `ServiceSelectors.swift` (services), `downloads.rs`/`reveal.rs::Folders`
(files), `SOURCE_ATLAS.md`/`FEATURE_MATRIX.md` (scope), `DESIGN_SPEC.md` (visual),
`DEVICE_VERIFICATION.md` (device checklist), `PARITY_MATRIX.md` (evidence ledger).

## Discount these stale claims explicitly

- `README.md:3` "Simulator/device operation has not been verified" — false now.
- `PROGRESS.md:15` "No simulator/device success claimed … gate stays OPEN" — false now.
- `HANDOFF.md:22` "Physical-device parity is not established", `:76` "Physical iPhone install
  BLOCKED", `:81-82` "unexercised" — the device builds, signs, installs, plays, downloads.
- `BLOCKERS.md` **B016/B003** — effectively resolved.
- `PARITY_MATRIX.md:33` and most playback/services rows — still `BLOCK`/`SRC`/`V-SIM` while
  `BUGFIX_LOG C-bis` plus the pulled `diag.log` runs are newer evidence.

## Rules that are not negotiable here

- **Never fabricate success.** No placeholder `Ok(())`, no "granted" without asking the OS,
  no claiming a device pass you did not run. Failures say why (`not_supported`,
  `not_implemented`, `iOS cannot decode <mime>`).
- **Evidence vocabulary** is ADR-006. Say which of these a claim rests on: source read,
  host tests, simulator run, or **device run with a log line**. Anything unrun stays `SRC`.
- **Interface changes need lead approval**: `src/lib/bridge.ts`, playback payload/event
  types (`androidPlayback.ts`, `PlayerSnapshot.swift`), native plugin registration, and
  persistence/storage schemas. Additive-and-optional only, and say why.
- **One iOS plugin registration.** Adding a second `register_ios_plugin` deadlocks startup
  (blank WKWebView). New selectors go in `ServiceSelectors.swift`.
- **iOS-specific behaviour stays gated**: `cfg(target_os = "ios")`, `platform === "ios"` or
  `NATIVE_PLAYER`. Shared product logic is shared; do not fork it for iOS.
- **No secrets, ever.** Before pushing run `./scripts/check-local-path-leaks.sh`; it fails on
  home paths, personal emails and credential shapes. The one allowlisted constant is Google's
  public InnerTube key in `src/lib/poToken.ts` (see `SECRET_SCAN.md`).

## Verify (all of these must be run, not assumed)

```sh
export PATH="$HOME/.cargo/bin:$PATH"
pnpm typecheck && pnpm test                       # 3,805 tests
pnpm build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo check --target aarch64-apple-ios
cd src-tauri/tauri-plugin-hushio-player/ios/Sources && xcrun swiftc -parse *.swift
./scripts/check-local-path-leaks.sh
```

## If it changes Swift/Rust behaviour, prove it on the device

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun devicectl list devices                    # get the UDID
./scripts/ios-fix-xcode-project.sh              # keeps ENABLE_USER_SCRIPT_SANDBOXING off
pnpm exec tauri ios build -t aarch64 --ci       # release: assets embedded, device-usable
xcrun devicectl device install app --device <UDID> src-tauri/gen/apple/build/arm64/Hushio.ipa
```

Then read the device's own log (no console needed — Rust `tracing`, `js_log` and Swift all
append to it):

```sh
xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer \
  --domain-identifier com.hushio.app.iosdev \
  --source "Library/Application Support/com.hushio.app.iosdev/diag.log" \
  --destination /tmp/diag.log
```

Ask the human to exercise the feature, then read that file. Do not claim a device pass
without a line in it.

## Deliverable and report

- Code + tests, docs updated (`BUGFIX_LOG.md` gets a row with symptom → root cause → fix →
  commit; `PARITY_MATRIX.md` gets evidence, never a green row you did not observe).
- Commit in the repo's style (`fix(area): …`, body = symptom, root cause, evidence, what is
  *not* claimed), secrets checked, push to `fork/port/ios-completion`.
- Reply with: what changed, the exact commands/exit codes, what you verified on device (with
  the log line), and what you deliberately did **not** fix. Keep the tree clean at the end.
