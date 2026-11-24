# Hushio iPhone port — handoff

Baseline source commit: **`2122110f9b41436723f368d3e1fb4d8a2a4276c2`**
Branch / worktree: **`port/ios`**
Original checkout (preserved, unchanged): a separate local copy of the baseline checkout

## 1. What works right now

A development-built app runs on the **iOS 26.5 simulator (iPhone 17 Pro)** and shows the real
Hushio phone interface with live catalogue data, plus a native AVFoundation playback engine
and the Phase D service bridges:

| | |
|---|---|
| App renders (release artifact) | `docs/ios-port/evidence/ios-light-home.png`, `ios-dark-home.png` — captured from `tauri ios build -t aarch64-sim` (bundled assets, no dev server) |
| Native playback engine | `PHASE_C_VERIFICATION.md` (P8 controlled-audio probe PASS) |
| Service bridges reachable | no `keyring unavailable` / `No command … found` in the device log |
| Frontend | `pnpm typecheck` 0; `pnpm test` 354 files / 3,746 tests pass |
| Rust | `cargo test --locked` 634 pass |
| Swift | `swift build` for `arm64-apple-ios15.0-simulator` clean |

Physical-device parity is **not** established; see §5.

## 2. Build and install (simulator)

Prerequisites already installed on this machine: Xcode 27.2 at `/Applications/Xcode.app`
(license accepted, `xcode-select` → `…/Contents/Developer`), iOS 27.2 SDK, iOS 26.5 simulator
runtime, rustup toolchain with `aarch64-apple-ios` + `aarch64-apple-ios-sim`, CocoaPods 1.17.

```sh
cd /path/to/hushio
export PATH="$HOME/.cargo/bin:$PATH"          # rustup toolchain (Homebrew rust has no iOS std)

# bundled release build for the simulator (no dev server needed)
pnpm exec tauri ios build -t aarch64-sim --ci

APP=src-tauri/gen/apple/build/arm64-sim/Hushio.app
xcrun simctl boot "iPhone 17 Pro" || true
xcrun simctl install "iPhone 17 Pro" "$APP"
xcrun simctl launch  "iPhone 17 Pro" com.hushio.app.iosdev
```

Debug builds (`--debug`) load the renderer from the Vite dev server instead of the bundle, so
they need `pnpm dev:renderer` running on `127.0.0.1:5173` **before** launching.

## 3. Rebuild from scratch

```sh
pnpm install                     # if node_modules is missing
pnpm exec tauri ios init --ci --skip-targets-install   # only if src-tauri/gen/apple is absent
pnpm exec tauri ios build -t aarch64-sim --ci
```

`src-tauri/gen/apple/` is generated and currently untracked. Regenerating it keeps the merged
`Info.ios.plist` keys (background audio, URL schemes, local-network ATS) because those live in
the tracked source tree, not in the generated project.

## 4. What changed (and why), in review order

| Area | Files | Note |
|---|---|---|
| iOS host + build | `src-tauri/tauri.ios.conf.json`, `src-tauri/Info.ios.plist`, `src-tauri/capabilities/ios.json` | distinct dev bundle id `com.hushio.app.iosdev`; `UIBackgroundModes: audio`; `CFBundleURLTypes` for OAuth/Spotify/app schemes; `NSAllowsLocalNetworking` |
| Desktop-only init excluded | `src-tauri/src/lib.rs` | `#[cfg(desktop)]` guards for tray/taskbar/linux/media controls; runtime scheme registration is desktop-only (iOS uses the plist) |
| Mobile bridge facade | `src-tauri/src/android.rs` | iOS branch dispatches to the Swift plugin; **all calls are timeout-bounded** (see §6) |
| Plugin registration | `src-tauri/tauri-plugin-hushio-player/src/lib.rs` | **one** iOS registration carries every bridge |
| Playback | `ios/Sources/PlayerEngine.swift`, `PlayerSnapshot.swift`, `HushioPlayerPlugin.swift` | AVPlayer engine + wire types + command/event selectors |
| Services | `ios/Sources/ServicesEngine.swift`, `DocumentPicker.swift`, `HushioServicePlugins.swift`, `ServiceSelectors.swift` | Keychain, document picker, notifications, auth, sync |
| Platform detection | `src/lib/bridge.ts`, `androidPlayback.ts`, `App.tsx`, `usePhone.ts`, `insets.ts`, `htmlClasses.ts`, `index.html` | `ios` platform, iPhone shell routing, `viewport-fit=cover`, CSS `env()` safe areas |
| Capability classification | `src/lib/haptics.ts`, `wakeLock.ts`, `desktopPlatform.ts`, `views/settings/categories.tsx`, `pip/PipButton.tsx`, `components/OutputDeviceButton.tsx` | real iOS haptics/keep-awake; desktop-only controls hidden; settings rows classified per platform |
| Auth schemes | `src-tauri/src/google_auth.rs`, `spotify_auth.rs`, `ios_scheme.rs` | iOS uses the app scheme instead of a loopback listener |

## 5. Known limitations and blockers

| Item | Status | What is needed |
|---|---|---|
| Physical iPhone install | **BLOCKED** | No code-signing identity on this Mac (`security find-identity` → 0) and no iPhone connected. User must add an Apple Account in Xcode and set `bundle.iOS.developmentTeam` (or `APPLE_DEVELOPMENT_TEAM`), then trust the developer certificate on the phone |
| Background audio / interruptions / route changes | implemented, **unverified** | Needs a physical device; the simulator cannot enforce `UIBackgroundModes` |
| Equalizer | **not implemented** | `player_set_eq` rejects `not_implemented`; `AVAudioUnitEQ` under an `AVAudioEngine` is the documented proposal |
| Native queue advancement while the WebView is suspended | **open** | Contract C-1/C-2: the shared TS engine drives a singleton queue, exactly as on Android |
| Google / Spotify sign-in | **BLOCKED on credentials** | `HUSHIO_GOOGLE_CLIENT_ID`, `HUSHIO_SPOTIFY_CLIENT_ID` are not configured; flows and URL schemes are wired |
| Document picker / local library | wired, **unexercised** | Requires interaction; no automated tap injection in `simctl` |
| Notifications | wired, **unexercised** | Real `UNAuthorizationStatus`; requires a tap to request |
| Google Cast | **inapplicable** | Android SDK only; rejects `not_supported` (AirPlay is not the same feature) |
| In-app updates | **inapplicable** | Distribution is Xcode dev signing / TestFlight / App Store; settings row hidden |
| VoiceOver / Dynamic Type / full visual review | **open** | Needs interactive device sessions |

## 6. The one non-obvious failure mode (read before touching the bridge)

`PluginApi::register_ios_plugin` and `run_mobile_plugin` both hop to the main thread and wait
for it. Two consequences were observed directly during this port:

1. **Registering more than one iOS plugin deadlocks startup.** The window appears but the
   WKWebView never paints. Confirmed by bisect: one registration → full UI; seven → blank.
   Therefore the shipping design exposes every selector on the single `hushio-player`
   instance (`ServiceSelectors.swift`). If you add an iOS bridge, add its selectors there —
   do **not** add another `register_ios_plugin` call.
2. **Any bridge call made while the main thread is inside Tauri `setup` deadlocks.** Shared
   code reads secrets during startup, so the iOS facade bounds every call
   (`call_bounded` / `call_async_bounded`, 1.5 s) and sets a `BLOCKED` flag to fail fast
   afterwards instead of stalling once per probe.
3. **`Runtime::block_on` must not be used there.** Release builds aborted at launch because
   the bounded call ran inside an existing Tokio runtime. `call_bounded` therefore spawns
   the work and waits on a channel with `recv_timeout`, which is safe from any thread.

Both are also recorded in `BLOCKERS.md` (B014, B015) so a future contributor does not
rediscover them by bisecting.

## 7. Refreshing / maintaining

- Development-signed builds expire with the signing certificate; re-run the §2 build and
  reinstall. Nothing in the app self-updates.
- Upstream changes: the port touches a small set of files (§4). Keep the iOS-specific code
  gated behind `cfg(target_os = "ios")`, `platform === "ios"` or `NATIVE_PLAYER`, and re-run
  `pnpm typecheck && pnpm test && cargo test --locked` plus the simulator build after a merge.
- Interface rule (unchanged from `DECISIONS.md`): `src/lib/bridge.ts`, the playback
  payload/event types and the persistence schemas stay authoritative for both platforms.
