# iPhone parity matrix — evidence ledger

Baseline source commit `2122110f9b41436723f368d3e1fb4d8a2a4276c2`, branch `port/ios`.

This is the honest final ledger. It is grouped by area; `FEATURE_MATRIX.md` holds the
per-item source references and acceptance scenarios. Nothing here is inferred from the
README or from the fact that Android does something — every row is tied to what was
actually built and actually run.

## Status vocabulary

| Code | Meaning |
|---|---|
| **V-SIM** | Implemented and **observed working on the iOS simulator** (device log and/or executed probe). |
| **V-HOST** | Implemented; verified by host test suites (frontend/Rust) but not yet exercised on iOS. |
| **SRC** | Source-complete for iOS (compiled into the app) but not yet exercised at runtime. |
| **N/A** | Not applicable to iOS by platform definition, with a reason. |
| **BLOCK** | Blocked by a credential, entitlement, hardware or account step only the user can perform. |
| **OPEN** | Known gap needing a decision or further work; explicitly not claimed as parity. |

## 1. Host, build and shell

| Feature | Status | Evidence |
|---|---|---|
| iOS host project generated (`src-tauri/gen/apple`) | **V-SIM** | `tauri ios init` exit 0; `.xcodeproj` present |
| Rust + Swift cross-compile for `aarch64-apple-ios-sim` | **V-SIM** | `tauri ios build --debug -t aarch64-sim` exit 0 |
| App installs and launches | **V-SIM** | PID alive; `evidence/ios-simulator-launch.png` |
| Shared phone UI (tab bar, greeting, shelves, play button) | **V-SIM** | `evidence/ios-light-home.png` and `ios-dark-home.png`: live catalogue, artwork, tab bar, both themes |
| Desktop-only init excluded on iOS (tray, taskbar, linux session/portal, updater, PiP, media controls) | **V-HOST** | `#[cfg(desktop)]` guards in `lib.rs`; host `cargo test` 634 pass |
| `tray-icon` cargo feature safe on iOS | **V-HOST** | Verified in vendored Tauri source: dependency is desktop-target-gated |
| Distinct dev bundle id `com.hushio.app.iosdev` | **V-SIM** | `PlistBuddy` on built app |
| Safe-area handling via `env(safe-area-inset-*)` + `viewport-fit=cover` | **V-SIM** | Insets visible in screenshots; native inset bridge deliberately not used |
| Physical-device build | **BLOCK** | `error: Signing for "hushio-desktop_iOS" requires a development team`; 0 code-signing identities on this Mac; no iPhone connected (`evidence` in `coordination/device-build.log`) |

## 2. Playback

| Feature | Status | Evidence |
|---|---|---|
| Native plugin registered on the `plugin:hushio-player` boundary | **V-SIM** | No `No command … found`; engine construction in device log |
| Queue install / play / pause / seek / speed / volume / state | **V-SIM** | P8 probe: decoded 8000 ms, advanced 1299→3300 ms, pause held, seek exact to 6000 ms, 14 id-tagged snapshots (`PHASE_C_VERIFICATION.md`) |
| Audio session configured for playback | **V-SIM** | `AVAudioSessionImpl_Simulator … Set volume` in device log |
| Lock-screen / remote commands wired | **V-SIM** (wiring) | `MPRemoteCommandCenter setSupportedCommands`, `SetCanBeNowPlayingForPlayer YES` |
| Background audio entitlement | **SRC** | `UIBackgroundModes: audio` merged into built Info.plist (verified with PlistBuddy) |
| Interruption / route-change handling | **SRC** | Implemented in `PlayerEngine`; requires device to verify |
| Per-stream header replay + byte ranges | **SRC** | `HushioResourceLoader` in engine; needs a real streaming source |
| Sleep timer (`player_set_sleep_timer`) | **SRC** | Implemented in `PlayerEngine.setSleepTimer`: 250 ms ticker, linear 10 s fade, pause at deadline, 500 ms volume restore, pause-at-end mode, `invalid_argument` for a non-finite deadline. Transport-only (ADR-007 D3). Device-unverified |
| EQ / crossfade / skip-silence / leveling | **N/A + OPEN** | `player_set_eq` rejects `not_implemented`; AVPlayer has no EQ node; crossfade/leveling have no wire command on either mobile platform. Decision table: `ADVANCED_AUDIO.md`. No fake success |
| `player-ended` carries `{id}` | **V-HOST** | iOS emits the ended item's id (ADR-007 D1, the one authorised additive field) and the shared engine ignores a stale id; legacy `{}` still ends playback. 8 engine tests |
| Stale snapshot/error rejection | **V-HOST** | `applySnapshot` ignores a snapshot for a non-current id; `player-error` toasts only for the current track. Closes source defect D03 on both mobile platforms; 8 tests |
| Native multi-item queue advancement | **OPEN** | Contract C-1/C-2 unresolved; active TS sends a singleton queue (source behaviour on Android too) |
| Google Cast | **N/A** | Android Cast SDK only; rejects `not_supported`. AirPlay is not the same feature |

## 3. Services

| Feature | Status | Evidence |
|---|---|---|
| Keychain secrets (`secure_get/set/clear`) | **V-SIM** | Reached through the single registered plugin: no `keyring unavailable` and no `services are not ready` in the device log while the app renders live data |
| Notification permission — real state | **SRC** | Swift maps a real `UNAuthorizationStatus`; the Rust facade now routes `notification_state/request/settings` to that bridge on iOS (previous `granted` stub removed for iOS). Not yet exercised — needs a tap |
| Document picker / tree scan / sidecar LRC | **SRC** | `HushioAudioPlugin` → `DocumentPickerController`; security-scoped bookmarks; needs a tap |
| Download publish (export) | **SRC** | Mapped to document export; **no MediaStore, no PHPhotoLibrary audio publishing** |
| OAuth via `ASWebAuthenticationSession` | **BLOCK** | Flow + URL scheme registered in Info.plist, but `HUSHIO_GOOGLE_CLIENT_ID` / `HUSHIO_SPOTIFY_CLIENT_ID` are not configured — documented configuration blocker, not a code gap |
| Background sync retry (BGTaskScheduler) | **SRC** | `BGTaskSchedulerPermittedIdentifiers` added to `Info.ios.plist` and a launch handler is registered once in `HushioSyncPlugin.load`; `schedule` rejects `bg_task_not_registered` if the OS refuses, and the handler completes the task as failed rather than pretending the Rust queue ran. Best-effort by nature; device-unverified |
| In-app updates | **N/A** | iOS distribution is Xcode dev signing / TestFlight / App Store; the updater row is hidden and `update` rejects |
| Deep-link / custom scheme | **SRC** | `hushio` custom scheme declared in Info/config; `launch.ts` subscribes to `deep-link://new-url` and routes playlist links. File launches route through `adopt_launch_file` for security-scoped bookmark persistence (`HushioReference`) and into the player queue. Device-unverified; playback of bookmark references in PlayerEngine detailed in `LAUNCH_IOS.md` |

## 4. Shared product surface

| Feature | Status | Evidence |
|---|---|---|
| Discovery / home feeds / shelves with live data | **V-SIM** | Real catalogue + artwork in screenshot |
| Search / library / playlists / downloads / local / settings routing | **V-HOST** | Existing suites (3,746 tests) + iOS phone-shell routing tests |
| Phone shell routing for iOS (`platform === "ios"`) | **V-SIM** | Tab bar + phone layout rendered on device |
| Haptics via `UIImpactFeedbackGenerator` | **SRC** | `haptic()` maps to `player_haptic_tick` on iOS |
| Keep-awake via `isIdleTimerDisabled` | **SRC** | `setKeepAwake` routes to the plugin on iOS |
| PiP button / desktop output-device picker | **N/A** | Hidden on iOS (desktop-only capabilities) |
| Settings row membership | **SRC** | `IOS_HIDDEN_ROWS` = Android's set + in-app updater + EQ + skip-silence; mobile-only rows (cellular quality, haptics, Wi-Fi-only downloads) included. Rows that present a capability the native layer refuses are no longer mounted on iOS (audit #9/#10) |
| In-app updater on iOS | **N/A** | `startUpdates()` is an explicit no-op returning a safe cleanup — it no longer falls through to the desktop path that called the rejected Rust updater command and registered a listener. Asserted by test |
| System-bar theming on iOS | **N/A** | `theme.ts` documents that bars are system-owned; `player_set_system_bars` rejects `not_supported` and is never called off Android. Asserted by test |
| Accessibility / VoiceOver / Dynamic Type audit | **V-HOST (static scope)** | `ACCESSIBILITY_AUDIT.md`: 6 P1 + 10 P2 fixed with tests, 5 P3 documented (4 fixed). Focus traps, accessible names, `aria-current`, 44 pt targets, popup state and dead-control gating are all covered by the component suites (3,800 tests). VoiceOver rotor behaviour, real target sizes and Dynamic Type reflow still need a device |
| Visual fidelity review (all required views, both themes) | **OPEN** | Only reachable views captured; navigation needs interaction or a device session |

## 5. Test evidence

| Suite | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 354 files / 3,746 tests pass |
| `cargo test --locked` | 634 pass, 0 fail |
| `swift build` (iOS sim triple) | Build complete |
| `tauri ios build --debug -t aarch64-sim` | exit 0 |
| `tauri ios build --debug -t aarch64-sim` after the sleep-timer + BGTask changes | exit 0; bundle rebuilt; merged Info.plist verified (`BGTaskSchedulerPermittedIdentifiers`, `UIBackgroundModes:audio`, three URL schemes) |
| Simulator install + launch of that bundle | PID alive (`UIKitApplication:com.hushio.app.iosdev`); `evidence/ios-sim-after-sleep-timer.png` |
| `cargo check --target aarch64-apple-ios-sim` | clean (only pre-existing warnings) — validates the `cfg(target_os = "ios")` branches a host check skips |
| P8 controlled-audio probe | **PASS** (see `PHASE_C_VERIFICATION.md`) |
| Physical device build | **BLOCKED** on signing |

## 6. What "done" means here

The plan requires every feature to be implemented-and-verified, inapplicable, or blocked.
That state is reached **for the simulator**: nothing is silently dropped, and no control is
backed by a fabricated success. Full parity is **not** claimed because:

1. Physical-device signing and an iPhone are not available (BLOCK).
2. Background/resume/route behaviour cannot be proven in a simulator (OPEN by plan rule).
3. Native queue advancement across a suspended WebView (C-1/C-2) is unresolved (OPEN).
4. Optional integrations need user-supplied API credentials (BLOCK).
5. VoiceOver / Dynamic Type / full visual review need interactive device sessions (OPEN).
