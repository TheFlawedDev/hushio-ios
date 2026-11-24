# Bug and fix log — from "does not build" to a running iPhone app

Every defect that had to be fixed to get the port to a state where the app **builds, signs,
installs and launches on a physical iPhone**, with the symptom, the actual root cause and the
fix. Several of these presented as *the same* misleading error, which is why they are recorded
in the order they were unmasked rather than by severity.

Branch: `port/ios-completion` (from `port/ios` @ `86eadba`).
Evidence vocabulary is `DECISIONS.md` ADR-006 — nothing here claims device verification it does
not have.

## A. Toolchain and build

| # | Symptom | Root cause | Fix | Commit |
|---|---|---|---|---|
| A1 | `xcodebuild` cannot find an SDK; `tauri ios build` fails immediately | Xcode licence unaccepted, iOS Rust targets absent, global `xcode-select` pointed at CommandLineTools | User performed the licence/account steps; `aarch64-apple-ios` + `-ios-sim` installed; per-command `DEVELOPER_DIR` instead of changing the global selection | — (user) |
| A2 | Window appears, WKWebView never paints (blank app) | Registering **seven** iOS plugins each blocks the main thread during `setup` | One registration (`hushio-player`) carries every selector; service bridges live in `ServiceSelectors.swift` | `86eadba` era (B014) |
| A3 | Same blank app, one plugin | Bridge calls made *while the main thread is inside Tauri `setup`* deadlock | `call_bounded` / `call_async_bounded`: every facade call has a 1.5 s ceiling and latches a `BLOCKED` flag so startup pays the timeout at most once | B015 |
| A4 | Release build aborts at launch | `Runtime::block_on` panics inside an existing Tokio runtime | Channel + `recv_timeout` instead of `block_on` | B017 |
| A5 | `tauri ios build` → *"requires a development team"* | No `bundle.iOS.developmentTeam` in the iOS config | Team set in `tauri.ios.conf.json`; Tauri embeds `DEVELOPMENT_TEAM` into the generated project | `96d285a` |
| A6 | *"Your team has no devices from which to generate a provisioning profile"* (three separate causes, same message) | (a) device not paired for development, (b) Developer Mode off, (c) team had zero registered devices | (a) `xcrun devicectl manage pair --device <name>`; (b) on-device Settings → Privacy & Security → Developer Mode; (c) build once with an explicit `-destination` so Xcode registers the device and mints the profile | `606b07b` |
| A7 | `PhaseScriptExecution "Build Rust Code" failed` | Xcode 15+ sandboxes build-phase scripts (`ENABLE_USER_SCRIPT_SANDBOXING = YES`), so the phase cannot read `.tauri/cli-options-server.json` | `ENABLE_USER_SCRIPT_SANDBOXING: NO` in the generated project; `scripts/ios-fix-xcode-project.sh` re-applies it after any `tauri ios init` | `a0ffa7b`, `09b0b88` |
| A8 | Debug build shows a blank page on the phone | Debug builds load the renderer from the Vite dev server on loopback, unreachable from the device | Ship a **release** build for device testing (assets embedded) | — |
| A9 | Enabling Developer Mode was reported "done" but the build still refused | `xcdevice` reports a device as `available: true` even when Developer Mode is off, so the check gave a false green | `scripts/ios-devices.py` reports xcdevice's per-device reason **and** `Developer Mode Status`; the signing check leads with it | `606b07b` |

## B. Services bridging

| # | Symptom | Root cause | Fix | Commit |
|---|---|---|---|---|
| B1 | Sign-in never completed; `keyring unavailable` in the log | Non-Android path returned a stub, and iOS cannot bind a loopback OAuth listener | `ASWebAuthenticationSession` + the app's custom scheme (`ios_scheme.rs`), bridged through the same command names | `86eadba` era |
| B2 | `notification_state` reported **"granted"** without asking | The non-Android Rust branch returned a literal `Ok("granted")` | iOS routes `notification_state/request/settings` to the Swift bridge (real `UNAuthorizationStatus`); the desktop stub is renamed `not(any(android, ios))` and commented as *not* a parity claim | `2f37ad4` |
| B3 | Sync retry silently did nothing | `BGTaskSchedulerPermittedIdentifiers` was absent (submit would reject forever) and no launch handler was registered (the OS kills the app when such a task fires) | Identifier added to `Info.ios.plist`; handler registered once in `HushioSyncPlugin.load`; `schedule` rejects `bg_task_not_registered` when the OS refuses, and the handler completes the task as **failed** rather than pretending the Rust queue ran | `29fbae9` |
| B4 | Opening an audio file from Files did nothing on iOS | iOS needs security-scoped bookmarks; the shared launcher only handled Android | `adopt_launch_file` selector returns a durable bookmark reference; `launch.ts` routes it | `df8ecf4` |
| B5 | `hushio://` links had no effect | The scheme was in the plist but nothing subscribed to the plugin's event | `plugins.deep-link.mobile` in `tauri.ios.conf.json`; `launch.ts` consumes `deep-link://new-url` | `ba0fa02` |

## C. Playback (device-only failures)

| # | Symptom | Root cause | Fix | Commit |
|---|---|---|---|---|
| C1 | Late event from a replaced source moved the shared player state (source defect D03) | Snapshots, `player-ended` and `player-error` carried no usable identity, and the shared engine did not filter | ADR-007: no generation field, one authorised additive field (`player-ended {id}`); engine filters snapshots/ended/errors by identity — fixes both mobile platforms | `55266d1`, `903a0bf` |
| C2 | "Couldn't play" for songs that Android plays fine | iOS shared Android's format ladder, whose second choice is **Opus in WebM**; AVFoundation has no Opus/WebM decoder | iOS resolves with `mp4Only`; a non-decodable container now raises `iOS cannot decode <mime>` instead of queueing a dead item | `b1f2ad7` |
| C3 | Same toast, still no audio | `HushioResourceLoader` populated `contentInformationRequest` but only called `finishLoading()` from the URLSession completion handler — for a metadata-only probe nothing consumes the body, so AVFoundation waited for the whole file and gave up (`-11800`) | Such requests complete as soon as headers arrive and the transfer is cancelled | `c6331ae` |
| C4 | Same toast | Every network stream was forced through the unverified custom-scheme loader (non-empty header map); also `refreshUrl` resolved without the iOS codec constraint | iOS sends no per-stream headers so AVPlayer fetches signed URLs natively; `refreshUrl` now passes the same codec constraint as the initial resolve | `180e1dd` |
| C5 | Diagnostics were invisible on device (release build has no reachable console) | `console.warn` reaches neither the device log nor `devicectl --console` | `js_log` command forwards to Rust tracing **and** appends to `diag.log` in the app container; Swift side (`HushioDiag`) does the same | `8753cd4`, `29b774d` |
| C6 | `diag.log` finally showed: `No command playerSetSpeed found for plugin hushio-player` (and `playerSetEq`, `playerGetState`, `playerSetVolume`) | The IPC delivered **camelCase** command names to a plugin that only declared snake_case selectors | Every selector has a camelCase alias that forwards to the snake_case implementation and records which spelling was used | `b350b5d` |

The same `diag.log` line proved resolution itself is healthy on the device:
`resolved SwYN7mTi6HM: mime=audio/mp4; codecs="mp4a.40.2" itag=140 host=rr2---sn-…googlevideo.com`.

## D. Accessibility and iOS honesty (found by audit, fixed with tests)

Six P1 and ten P2 findings from `ACCESSIBILITY_AUDIT.md`, plus four of five P3 items:
modal focus traps and dismissal, `aria-current` on the playing row, accessible names composed
from metadata instead of an `aria-label` that hid the artist, queue reorder/remove reachable
without touch gestures, Replay slide progression, 44 pt iOS hit targets, `aria-haspopup`/
`aria-expanded`, and hiding rows whose capability the native layer refuses (EQ, skip-silence,
updater). Commits: `2c69995`, `667167a`, `8c97123`, `608dd84`, `877601b`.
One P3 (fixed DP heights vs Dynamic Type AX1–AX5) is deliberately deferred: those constants
drive virtualised row measurement and need design + device validation
(`DEVICE_VERIFICATION.md` §7).

## E. Repository hygiene

| # | Problem | Fix | Commit |
|---|---|---|---|
| E1 | Personal macOS home paths (machines' `Users` directories) and an Apple ID email were committed in docs | Paths redacted, email removed; the two commits were rewritten and force-pushed, then the old objects were pruned (`reflog expire` + `gc --prune=now`) | history rewrite |
| E2 | A personal mailbox was the commit author on every port commit | Identity switched to a GitHub noreply address; `filter-branch` rewrote author/committer on `port/ios` and `port/ios-completion` only (upstream authors untouched); trees verified byte-identical | history rewrite |
| E3 | Nothing prevented recurrence | `scripts/check-local-path-leaks.sh` fails on home paths, personal emails (files **and** commit metadata) and committed signing artefacts | `b502a6d` |

## Known outstanding at this commit

- **Playback on the device is not yet confirmed working.** C2–C6 are all real defects that were
  fixed, and each fix removed one layer of the failure, but the last one (camelCase selectors)
  still needs one device run to confirm audio. Nothing in this log claims otherwise.
- Device-dependent verification (`DEVICE_VERIFICATION.md` steps 2–7): background audio,
  interruption/route changes, remote commands, services on hardware, OAuth (needs client IDs),
  Dynamic Type/VoiceOver.
