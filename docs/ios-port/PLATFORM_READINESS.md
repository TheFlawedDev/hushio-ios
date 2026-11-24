# Hushio iOS Port — Platform Readiness Assessment

**Role:** Senior Tauri/Rust Platform Engineer — read-only assessment  
**Baseline commit:** `2122110f9b41436723f368d3e1fb4d8a2a4276c2`  
**Assessment date:** 2026-11-23  
**Owned file:** `docs/ios-port/PLATFORM_READINESS.md`  
**Status:** Phase A (pre-implementation). No code has been written, installed, or modified.

> [!IMPORTANT]
> **Lead review addendum (2026-11-23).** The platform reviewer agent was interrupted by an account usage limit before producing its correction, so the lead reviewed the draft against primary source. The following corrections supersede the corresponding statements below; the rest of the document stands as the platform engineer's read-only draft.

1. **Command Line Tools is not itself a blocker (§1.1, §14 PLT-01/02).** Per-command `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` is the documented escape hatch and was already used to read "Xcode 27.2 (27B52)". The only Xcode blocker is the **unaccepted license**. The user must review it interactively — **do not** instruct `-license accept` (auto-accepting a legal agreement is the user's personal act):

   ```sh
   sudo env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -license
   ```

2. **rustup is the common path, not the only one (§1.2, §12 step 2).** Installing rustup is a system change and requires a user decision; this project must not auto-install. `rustc --print target-libdir --target aarch64-apple-ios` already printed a *prospective* path while the Homebrew rustlib dir contains only `aarch64-apple-darwin` — that print is not proof the iOS std is installed.

3. **deep-link registration (§2.1, §3.2, §4.1) — corrected by the Rust agent.** `tauri_plugin_single_instance::init` is `#[cfg(desktop)]`, but `tauri_plugin_deep_link::init` is **unconditional** in `src-tauri/src/lib.rs::run` (verified line ~697) — and correctly so: `tauri-plugin-deep-link` has `#[cfg(target_os = "ios")]` branches (iOS custom URL schemes supported). The draft's "registered unconditionally" for single-instance was right, but deep-link needs `CFBundleURLTypes` in the generated Xcode Info.plist for the schemes to actually route; the `plugins.deep-link` config has only a `desktop.schemes` block today. Treat iOS custom-scheme routing as to-configure, not broken.

4. **No silent feature drops (§6, §7.2, §10).** SMB and Discord are parity targets, not code-size/impracticality casualties — their iOS disposition belongs in `FEATURE_MATRIX.md`, not a compile-time removal. MediaStore has no iOS equivalent; do not invent PHPhotoLibrary audio publishing. Discord is desktop IPC and must be classified (inapplicable/blocked), not auto-stripped.

5. **`mobile.rs` stubs are compile-compat, not verified capability (§3.1, §6).** The `✅` marks mean "compiles/no desktop panic", not "works on iOS". In particular the non-Android `notification_state`/`notification_request` stubs return `"granted"` and `notification_settings` returns `Ok(())` — a fabricated success that must not be inherited by iOS.

6. **Updates (§5, §6).** In-app APK self-update is genuinely inapplicable on iOS; distribution is Xcode development signing (immediate target), then TestFlight/App Store. "App Store/TestFlight only" is too narrow — dev-signed installs are the required handoff.

7. **`download_dir()` → `Documents/` (§3.7) and the ATS 127.0.0.1 exemption (§3.6) are unverified**, not established facts. Mark both "needs build-time verification" after `tauri ios init`.

8. **`build.rs` (§2.3) verified**: it is only `tauri_build::build()`. The scaffold no-change claim is acceptable; keep the resource-bundling caveat.

9. **`tauri ios build --target …` (§12 step 8) flags are unverified** against the installed CLI (`tauri-cli 2.12.4`) because the license gate prevents running it now. Confirm with `pnpm exec tauri ios build --help` before relying on the exact flags.

---

## 1. Toolchain State

### 1.1 Xcode

| Item | Observed value | Required for iOS |
|---|---|---|
| Xcode path | `/Applications/Xcode.app` | ✅ present |
| Xcode version | **27.2** (Build 27B52) | ✅ adequate |
| Xcode license | **UNACCEPTED** | ❌ **blocker** |
| Active developer directory | Currently points to Command Line Tools | ❌ **blocker** |
| iOS SDK availability | Cannot be queried — license gate | ⚠️ unverified |
| iOS Simulator runtimes | Cannot be queried — license gate | ⚠️ unverified |

**Finding:** `xcodebuild -showsdks` and `xcrun --sdk iphonesimulator` are blocked by the unaccepted Xcode license agreement. Every Tauri iOS command (`tauri ios init`, `tauri ios build`, `tauri ios dev`) will fail at the same gate. The user must run `sudo xcodebuild -license accept` from a terminal **themselves** (a legal agreement). This assessment does not accept it.

> [!CAUTION]
> Until the Xcode license is accepted by the user, **no iOS toolchain step — project generation, SDK queries, simulator launch, or device signing — can proceed**. This is the single most urgent blocker.

**Workaround pattern for all subsequent toolchain invocations (once license accepted):**  
Set `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` per command. Never set it globally or via `sudo`. Example:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer tauri ios init
```

### 1.2 Rust

| Item | Observed value | Required for iOS |
|---|---|---|
| `rustc` binary | `/opt/homebrew/bin/rustc` | ✅ |
| Rust version | **1.100.0** (Homebrew) | ✅ adequate |
| `rustup` | **absent from PATH** | ❌ **blocker for std targets** |
| `rustup home` (`~/.rustup`) | **does not exist** | ❌ |
| Installed cross-compile targets | `aarch64-apple-darwin` only | ❌ **iOS targets missing** |

**Finding:** The Rust installation was done via Homebrew, which ships a single pre-compiled `rustc` binary. The standard library (`rust-std`) components for iOS targets — `aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios` — are managed exclusively by `rustup component add` or `rustup target add`. Without `rustup`, there is no supported path to install these targets without upgrading Rust management.

> [!IMPORTANT]
> `rustc --print target-list` confirms iOS triple names (`aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios`) are known to the compiler, but the corresponding `rust-std` sysroot components **are not installed**. Attempting to compile for any iOS triple will fail with `error[E0463]: can't find crate for 'std'`.

**Options to resolve (do not install — assessment only):**

| Path | Action required | Notes |
|---|---|---|
| Install `rustup` | Install from `rustup.rs` or `brew install rustup`; run `rustup target add aarch64-apple-ios aarch64-apple-ios-sim` | Requires a system change; preferred approach |
| Homebrew `rust` formula components | Homebrew does not ship per-target `rust-std` components; this path does not exist | ❌ not viable |
| `cargo build --target` with `rust-src` nightly feature | Requires nightly + `-Zbuild-std` flag; not aligned with stable Tauri 2 builds | ❌ not advisable for production |

**Recommended:** Install `rustup` and use it to manage toolchain and targets. The existing Homebrew `rustc` 1.100 and `cargo` can coexist with `rustup`-managed toolchains, but Tauri's iOS build system expects `rustup` to be present to identify the installed targets.

**Required iOS targets:**

```
aarch64-apple-ios       # physical iPhone (ARM64)
aarch64-apple-ios-sim  # iOS Simulator on Apple Silicon Mac
x86_64-apple-ios        # iOS Simulator on Intel Mac (not needed here, but noted)
```

### 1.3 Node / pnpm

Not assessed in depth (not a Rust/platform concern); CONTRIBUTING.md requires Node.js 22 and pnpm 10.

---

## 2. Cargo Manifest and Dependency Audit

### 2.1 Main crate (`src-tauri/Cargo.toml`)

```
name: hushio-desktop
edition: 2024
crate-type: ["staticlib", "cdylib", "rlib"]
```

The `staticlib` + `cdylib` combination is correct for Tauri mobile targets (Tauri generates a static library for iOS and a shared library for Android).

#### Unconditional dependencies (compile on every target, including iOS)

| Crate | iOS concern | Assessment |
|---|---|---|
| `tauri = { version = "2", features = ["protocol-asset", "tray-icon"] }` | `tray-icon` feature **does not exist on iOS** — Tauri 2 compiles the feature flag but the tray subsystem is behind `#[cfg(desktop)]` guards in Tauri's own code. Needs verification that `tray-icon` feature itself does not force a desktop-only native dependency at compile time. | ⚠️ **verify** |
| `tauri-plugin-single-instance = "2.5.5"` | Plugin is registered inside `#[cfg(desktop)]` in `lib.rs` — safe | ✅ |
| `tauri-plugin-deep-link = "2.6.3"` | Registered unconditionally in `lib.rs`; Tauri 2 deep-link plugin supports iOS (custom URL schemes). The `tauri.conf.json` `deep-link.desktop.schemes` block is desktop-only config — needs an `ios` block added | ⚠️ needs iOS config block |
| `tauri-plugin-window-state = "2.5.0"` | Registered inside `#[cfg(desktop)]`. Safe at compile time — verify it has no unconditional platform-native transitive dependency | ⚠️ **verify transitive deps** |
| `axum = "0.8"` | `axum` is pure Rust / `tokio`-based; compiles on iOS (Tauri's stream proxy uses it). No known iOS compile blocker. | ✅ |
| `reqwest` (rustls-tls, json, stream, gzip, cookies) | `rustls-tls` avoids OpenSSL; compiles on iOS. `cookies` crate is pure Rust. | ✅ |
| `symphonia = { version = "0.5", features = ["all"] }` | Symphonia is pure Rust; `features = ["all"]` enables all decoders. Compiles on iOS, but its use on iOS is undefined — desktop playback (`mod playback`) is `#[cfg(desktop)]`. Need to confirm symphonia is not referenced outside desktop-only code paths. | ⚠️ **verify usage scope** |
| `lofty = "0.22"` | Pure Rust tag reading library; compiles on iOS. Used in downloads and local library. | ✅ |
| `smb = "0.12.1"`, `smb-fscc`, `smb-msg` | SMB crates; pure Rust async SMB implementation. No unconditional platform-native linkage visible in crate metadata. Likely compiles on iOS, but SMB is a desktop/LAN feature — no `cfg` guard in `Cargo.toml` guards these from iOS compile. | ⚠️ **adds code size; needs `#[cfg(not(target_os = "ios"))]` guard if SMB UI is not shown on iOS** |
| `notify = "8"` | **Already correctly guarded:** `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]` | ✅ |
| `tauri-plugin-updater = "2"` | Same guard as `notify` — excluded from Android and iOS | ✅ |
| `souvlaki = "0.9.3"` | Windows and macOS only in `Cargo.toml`. Not present on iOS. | ✅ |
| `keyring = { version = "3", features = ["apple-native"] }` | macOS-only via `[target.'cfg(target_os = "macos")'.dependencies]`. iOS will fall through to the `#[cfg(not(desktop))]` branch in `google_auth.rs` which routes to `android::secret_*`. That path currently calls Android-specific Kotlin bridges — **requires an iOS secrets adapter**. | ❌ **needs iOS adapter** |

#### Dependency section for iOS that must be added

No `[target.'cfg(target_os = "ios")'.dependencies]` section exists. When implementing iOS, a `keyring`-compatible iOS secrets adapter (or direct `Security.framework` / Tauri keychain command) must be declared here.

### 2.2 Plugin crate (`src-tauri/tauri-plugin-hushio-player/Cargo.toml`)

```toml
[dependencies]
tauri = "2"
[build-dependencies]
tauri-plugin = { version = "2", features = ["build"] }
links = "tauri-plugin-hushio-player"
```

The plugin's `src/lib.rs` exports two `plugins()` implementations:

- `#[cfg(target_os = "android")]` — registers 7 Kotlin bridge plugins (player, secure, media, auth, permission, audio, sync, update).
- `#[cfg(not(target_os = "android"))]` — returns a single no-op `hushio-player` plugin.

**iOS falls into the `not(android)` branch**, which means no native playback capability will be registered. This is the correct starting state — it prevents compilation errors — but it means **all Android Kotlin bridges (audio, secure, media, auth, etc.) are absent on iOS**. Each must be replaced with an equivalent iOS Swift plugin.

### 2.3 `build.rs`

Present in both `src-tauri/build.rs` and `src-tauri/tauri-plugin-hushio-player/build.rs`. The main `build.rs` calls `tauri_build::build()`. No iOS-specific build script logic exists yet. The iOS Xcode project will be generated by `tauri ios init`; the `build.rs` does not need changes for the initial scaffold.

---

## 3. Rust Source — Conditional Compilation Audit

### 3.1 Mobile/desktop split (`lib.rs`)

```rust
#[cfg(desktop)] mod playback;      // mpv-based desktop playback — EXCLUDED from iOS ✅
#[cfg(desktop)] mod tray;          // system tray — EXCLUDED ✅
#[cfg(desktop)] mod updates;       // tauri-plugin-updater — EXCLUDED ✅
#[cfg(desktop)] mod window;        // window state — EXCLUDED ✅
#[cfg(desktop)] mod pip;           // picture-in-picture — EXCLUDED ✅
#[cfg(mobile)]  mod mobile;        // no-op stubs for tray/window/pip/updates — INCLUDED ✅
```

The `mobile` module (`src/mobile.rs`) provides no-op stubs for all desktop commands so they compile and return safe defaults on mobile. iOS is part of `#[cfg(mobile)]`. This is well-structured.

### 3.2 `android.rs` — the critical gap

`android.rs` defines two parallel `bridge` modules:

- `#[cfg(target_os = "android")]` — real Kotlin bridge implementation.
- `#[cfg(not(target_os = "android"))]` — stub functions returning `Err("Android services are only available on Android.")`.

**iOS falls into the stub branch.** All calls to `android::secret_read/write/clear`, `android::pick_tree`, `android::scan_tree`, `android::publish_download`, `android::open_sign_in`, `android::await_sign_in_redirect`, and `android::notification_*` will return errors on iOS. This is not a compile blocker, but it means **none of the following work on iOS without new adapters:**

- Keychain / secure credential storage (Google refresh token, Spotify token, Last.fm, etc.)
- File tree picker (local library folder selection)
- Media store publish (download completion notification)
- OAuth sign-in browser flow
- Push notification permission

### 3.3 `secrets.rs` / `google_auth.rs` — secure storage on iOS

`secrets.rs` delegates to `KeyringSlot`, which on non-desktop targets routes to `android::secret_*`. The `keyring` crate with `apple-native` feature is macOS-only. **No iOS keychain integration exists.** The fix is a new `[target.'cfg(target_os = "ios")'.dependencies]` entry for a keychain crate or a custom `Security.framework` Tauri command plugin.

### 3.4 `media_controls.rs`

Implements three platform backends:

- `#[cfg(any(target_os = "windows", target_os = "macos"))]` — `souvlaki`-backed SMTC/MRCP
- `#[cfg(target_os = "linux")]` — MPRIS via `mpris-server`/`zbus`
- Implicit fallback for all other targets — `Controls::install()` exists but `set_track/set_playing/clear` are no-ops

**On iOS** the `Controls::install()` call in `lib.rs:run()` is unconditional. The `install` method on the fallback `Controls` struct will silently do nothing (session creation fails and is logged as a warning). This is acceptable as a temporary state; iOS lock-screen / Now Playing integration requires a Swift `MPNowPlayingInfoCenter` adapter which will be part of Phase C.

The `media_set_track`, `media_set_playing`, `media_set_position`, `media_clear` Tauri commands are registered unconditionally and will reach the no-op path on iOS.

### 3.5 Desktop-only paths that must not initialize on iOS

| Path | Guard in source | iOS-safe? |
|---|---|---|
| `tray::setup` | `#[cfg(desktop)]` in `lib.rs:run()` | ✅ |
| `updates::start` | `#[cfg(desktop)]` | ✅ |
| `window::restore_main`, `window::apply_glass` | `#[cfg(desktop)]` | ✅ |
| `app.manage(tray::Tray::default())` | `#[cfg(desktop)]` | ✅ |
| `app.manage(pip::Pip::default())` | `#[cfg(desktop)]` | ✅ |
| `macos_window::install` | `#[cfg(target_os = "macos")]` | ✅ |
| `menu::install` | `#[cfg(target_os = "macos")]` | ✅ |
| `audio_output::install` | `#[cfg(target_os = "macos")]` | ✅ |
| `linux_session::setup` | Unconditional call; `linux_session` likely no-ops on non-Linux | ⚠️ verify |
| `linux_portal::start` | Same | ⚠️ verify |
| `taskbar::setup` | Unconditional; must be verified to no-op on iOS | ⚠️ verify |
| `media_controls::Controls::install` | Unconditional; falls to no-op on unknown targets | ✅ (no-op) |
| `playback::Engine::new` | `#[cfg(desktop)]` | ✅ |
| Stream proxy (`axum`-based local HTTP) | Unconditional — **will attempt to bind to 127.0.0.1 on iOS** | ⚠️ **needs verification** — iOS may allow loopback binding in-process; Tauri's WebView on iOS will need to be allowed to load from that localhost URL |

### 3.6 `stream.rs` — local HTTP proxy on iOS

The stream proxy (`StreamProxy<Registry>`) is an `axum`-based HTTP server started unconditionally. On iOS, an in-process HTTP server can listen on loopback, but the Tauri WKWebView must be configured to allow `http://127.0.0.1:*` loading. The existing CSP in `tauri.conf.json` already allows `http://127.0.0.1:*` in `media-src`. The iOS port must verify WKWebView ATS (App Transport Security) allows loopback non-TLS connections — Apple defaults require HTTPS except for `localhost` / `127.0.0.1`, which are explicitly exempted.

### 3.7 Download directory path on iOS

```rust
let default_dir = if cfg!(target_os = "android") {
    app.path().app_cache_dir()?.join(format!("{APP_SLUG}-downloads"))
} else {
    app.path().download_dir()?.join(APP_NAME)   // ← iOS takes this branch
};
```

On iOS `download_dir()` resolves to the app's sandboxed `Documents/` subdirectory (Tauri 2 uses `NSDocumentDirectory`). This is correct behavior — iOS apps cannot write to a system-wide Downloads folder. However the `reveal.rs` folder-picker uses `tauri_plugin_dialog::DialogExt` which is guarded `#[cfg(desktop)]`, so the iOS folder-picker requires a dedicated document picker adapter (UIDocumentPickerViewController).

---

## 4. Tauri Configuration for iOS

### 4.1 `tauri.conf.json` — iOS gaps

| Config key | Current value | iOS requirement |
|---|---|---|
| `bundle.targets` | `["nsis", "dmg", "app"]` | iOS bundles are generated separately via `tauri ios build`; this list does not need `ipa` added, but confirms no iOS bundle config exists yet |
| `bundle.resources."resources/mpv/"` | Bundles mpv runtime for desktop | iOS must exclude this resource — mpv is a desktop-only binary |
| `plugins.updater` | desktop-only plugin already | ✅ no iOS impact |
| `plugins.deep-link.desktop.schemes` | `["hushio"]` | An `ios.schemes` block is needed for custom URL scheme handling on iOS |
| `app.windows` | Desktop window geometry (1280×820, decorations=false) | No iOS equivalent; iOS windows are managed by UIKit — Tauri generates the iOS UI host automatically |
| `app.security.assetProtocol.scope` | `["$AUDIO/**", "$DOWNLOAD/**", "$MUSIC/**", "$APPDATA/**", "$APPCACHE/**"]` | iOS path equivalents differ — `$AUDIO` and `$MUSIC` resolve to `NSMusicDirectory` which may not exist on iOS sandbox; `$APPDATA` and `$APPCACHE` are valid |
| `app.security.csp` | Includes `http://127.0.0.1:*` in `media-src` | ✅ needed for stream proxy |

### 4.2 `tauri.conf.json` — missing iOS section

No `tauri.ios.conf.json` exists. When `tauri ios init` runs (after Xcode license is accepted), it will generate an Xcode project under `src-tauri/gen/apple/`. An iOS-specific merge config will be needed for:

- Bundle identifier (task prompt recommends a **distinct** development identifier — e.g., `com.hushio.app.ios-dev`)
- Minimum iOS deployment target (Tauri 2 defaults; must be verified against user's physical device OS)
- Entitlements (background audio, keychain sharing if needed)
- Info.plist keys (NSMicrophoneUsageDescription is not needed; `UIBackgroundModes: audio` is required for background playback)

### 4.3 Capabilities — iOS capability file missing

Current capability files:

| File | Platforms | iOS impact |
|---|---|---|
| `capabilities/default.json` | No `platforms` filter — applies to all | Will be included on iOS. `hushio-player:default` permission will reference the no-op iOS plugin; this compiles but grants no native capability |
| `capabilities/desktop.json` | `["windows", "linux", "macOS"]` | Correctly excluded from iOS ✅ |
| `capabilities/pip.json` | (not read in this pass) | Needs review |

A `capabilities/mobile.json` (or `capabilities/ios.json`) file must be created covering iOS-specific permissions and scopes. The Android project likely provides a template, but its Kotlin-bridge permissions will not apply.

---

## 5. Android Plugin Rust Scaffolding — iOS Counterpart Assessment

The existing Android plugin at `src-tauri/tauri-plugin-hushio-player/` provides:

| Android bridge | Kotlin class | Purpose | iOS equivalent needed |
|---|---|---|---|
| `hushio-player` | `PlayerPlugin` | Native audio playback (Media3/ExoPlayer) | ✅ **needed** — `AVFoundation`/`AVAudioSession` Swift plugin |
| `hushio-secure` | `SecurePlugin` | Android Keystore credential storage | ✅ **needed** — `Security.framework` Keychain Swift plugin |
| `hushio-media` | `MediaStorePlugin` | MediaStore publish, delete | ✅ **needed** — PHPhotoLibrary / Files.app export (limited iOS equivalent) |
| `hushio-auth` | `AuthPlugin` | OAuth browser launch + redirect capture | ✅ **needed** — `ASWebAuthenticationSession` Swift plugin |
| `hushio-permission` | `PermissionPlugin` | Notification permission state/request | ✅ **needed** — `UNUserNotificationCenter` Swift plugin |
| `hushio-audio` | `LocalAudioPlugin` | SAF tree picker, file scan, .lrc sidecar | ✅ **needed** — `UIDocumentPickerViewController` Swift plugin |
| `hushio-sync` | `SyncPlugin` | Background sync scheduling (WorkManager) | ⚠️ **iOS equivalent is BGTaskScheduler / BGAppRefreshTask** — limited compared to Android WorkManager |
| `hushio-update` | `UpdatePlugin` | APK self-update download/install | ❌ **not applicable on iOS** — App Store / TestFlight only; stub returning not-supported |

The Swift plugin counterparts must follow the same Tauri 2 mobile plugin architecture: a Swift package registered via `tauri-plugin`'s `register_ios_plugin` path, declaring the same command names as the Android bridges.

> [!NOTE]
> The Rust-side `android.rs` stubs already handle `#[cfg(not(target_os = "android"))]` with error returns. iOS will need a parallel `ios.rs` (or an extension of `android.rs`) that calls the iOS Swift bridges rather than returning the generic Android-not-available error.

---

## 6. Desktop-Only Features — iOS Disposition

| Feature | Rust module | iOS action |
|---|---|---|
| mpv desktop playback | `src/playback.rs` (`#[cfg(desktop)]`) | Excluded — iOS uses native Swift AVFoundation plugin |
| System tray | `src/tray.rs` (`#[cfg(desktop)]`) | Excluded — no-op stubs in `mobile.rs` ✅ |
| Auto-updater (tauri-plugin-updater) | `src/updates.rs` (`#[cfg(desktop)]`) | Excluded — no-op stub in `mobile.rs` ✅ |
| Window state / Glass / vibrancy | `src/window.rs`, `macos_window.rs` | Excluded / macOS-only ✅ |
| Picture-in-picture | `src/pip.rs` (`#[cfg(desktop)]`) | Excluded — no-op stubs ✅ |
| MPRIS media controls (Linux) | `media_controls.rs` mpris module | Linux-only dep — not compiled on iOS ✅ |
| souvlaki (Windows/macOS SMTC) | `media_controls.rs` platform module | Windows/macOS dep — not compiled on iOS ✅ |
| File watcher (`notify` crate) | `local_library/watch.rs` | Already excluded: `cfg(not(any(android, ios)))` ✅ |
| SMB network shares | `network/smb.rs` | Compiles on iOS (pure Rust) but SMB over iOS cellular/Wi-Fi may be impractical; **no `cfg` guard prevents compilation** — SMB crates add binary size |
| Reveal-in-Finder / open folder | `src/reveal.rs` uses `tauri_plugin_dialog` desktop only | `folder_pick` and `open_folder` commands use `#[cfg(desktop)]` dialog — need iOS document picker replacement |
| Discord rich presence | `src/discord.rs` | Compiles unconditionally; Discord IPC socket does not exist on iOS — will silently fail at runtime. Should be guarded or no-op'd on iOS |

---

## 7. Build Script and Resource Concerns

### 7.1 mpv resource bundle

`tauri.conf.json` includes:
```json
"resources": { "resources/mpv/": "mpv/" }
```

The `resources/mpv/` directory holds the macOS mpv runtime binary (the `.gitkeep` was deleted per git status). On iOS, `bundle.resources` is used differently and mpv cannot be bundled as an executable. The iOS build config must either omit this resource entry or guard it to desktop-only targets. The iOS Xcode project (`gen/apple/`) will not include Tauri's desktop resources by default, but this should be explicitly verified post-`tauri ios init`.

### 7.2 App bundle identifier

Current identifier: `com.hushio.app`

The task prompt explicitly requires a **distinct development bundle identifier** for iOS signing. Recommendation: `com.hushio.app.iosdev` (or as directed by the signing setup). This avoids any entitlement or keychain-sharing conflict with a future production identifier.

### 7.3 `gen/android` exists; `gen/apple` does not

The Android Xcode-equivalent project was generated previously. iOS initialization has not been run. After Xcode license acceptance, `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer tauri ios init` will create `src-tauri/gen/apple/`.

---

## 8. Simulator vs. Physical Device Capability Differences

| Capability | Simulator | Physical device |
|---|---|---|
| Audio playback (AVAudioSession) | Partial — no background audio enforcement | Full behavior |
| Background audio (`UIBackgroundModes: audio`) | Not enforced — app stays alive | Required; enforced by OS |
| Lock screen Now Playing controls | Not present in Simulator | Available via `MPNowPlayingInfoCenter` |
| Audio route changes (headphone insert/remove) | Not simulated | Full behavior |
| Bluetooth audio | Not available | Available |
| Camera / photo library | Available (simulated) | Full |
| Push notifications | Available (simulated) | Requires APNs certificate |
| File import (UIDocumentPickerViewController) | Available | Full |
| Network (Wi-Fi, cellular) | Uses Mac's network | On-device cellular behavior |
| Performance (tokio thread pool, background tasks) | Mac CPU | A-series SoC behavior differs |

> [!WARNING]
> Per the Master Plan (Section 5): "A simulator pass does not establish background audio or device integration correctness. Physical-device testing is mandatory." This assessment confirms background audio, lock-screen controls, and audio session lifecycle cannot be fully validated in the simulator.

---

## 9. Signing and Physical Device Blockers

The following items are user-operated steps. This assessment documents them; it does not perform them.

| Step | Blocker type | Who acts |
|---|---|---|
| Accept Xcode license | Legal agreement | **User** (`sudo xcodebuild -license accept`) |
| Add Apple Account to Xcode | Credential | **User** (Xcode > Settings > Accounts) |
| Trust development certificate on iPhone | Device setting | **User** (Settings > General > VPN & Device Management) |
| Enable Developer Mode on iPhone | Device setting | **User** (Settings > Privacy & Security > Developer Mode) |
| Free Apple Developer Program | No cost for development-signed builds (7-day expiry) | **User** (Apple ID required) |
| Paid Apple Developer Program | Required for 1-year cert, TestFlight, App Store | **User** ($99/year — not required for dev testing) |

---

## 10. Dependency Compile-Risk Summary

### High risk (will fail to compile or link for `aarch64-apple-ios`)

| Item | Reason |
|---|---|
| **iOS `rust-std` targets absent** | No `rustup`; iOS cross-compilation cannot proceed at all |
| **Xcode license not accepted** | `tauri ios init` and all subsequent steps blocked |

### Medium risk (requires code changes before first clean iOS build)

| Item | Reason |
|---|---|
| `tauri = { features = ["tray-icon"] }` | Verify `tray-icon` feature does not introduce a system-tray native dependency that fails to link on iOS |
| `taskbar::setup` unconditional call | Needs `#[cfg(desktop)]` guard or no-op on iOS |
| `linux_session::setup` / `linux_portal::start` unconditional calls | Needs no-op verification on iOS |
| `discord.rs` unconditional init | Discord IPC socket absent on iOS; needs `#[cfg(not(any(target_os = "ios", target_os = "android")))]` guard or silent no-op |
| `google_auth.rs` `KeyringSlot` on iOS | Routes to `android::secret_*` stub returning `Err()`; sign-in will appear to fail — needs iOS keychain adapter |
| SMB crates compile unconditionally | No iOS-specific exclusion; will increase binary size; SMB functionality unsupported on iOS at the UI level |

### Low risk (compile likely, behavior degraded without adaptation)

| Item | Reason |
|---|---|
| `axum` stream proxy on iOS | Compiles; loopback binding works on iOS; ATS exempts 127.0.0.1 |
| `symphonia` unconditional compile | Will compile; desktop playback is `#[cfg(desktop)]`; Symphonia itself is not called on iOS unless referenced elsewhere |
| `media_controls::Controls::install` | No-op on iOS; session creation silently skipped |
| `reveal.rs` file operations | Most compile; `folder_pick` / `open_folder` are `#[cfg(desktop)]`-guarded |

---

## 11. File Ownership Boundaries

This assessment identifies which source files will require changes in Phase B and beyond. Changes must be coordinated through the Lead per Master Plan §2.

### Files this engineer (Tauri/Rust Platform) owns

| File / Directory | Action when implementation starts |
|---|---|
| `src-tauri/Cargo.toml` | Add `[target.'cfg(target_os = "ios")'.dependencies]`; guard SMB; remove/guard `tray-icon` feature if it causes link failure |
| `src-tauri/tauri.conf.json` | No change until iOS gen config is established |
| `src-tauri/tauri.ios.conf.json` | **Create** — iOS bundle identifier, deployment target, entitlements path |
| `src-tauri/capabilities/ios.json` | **Create** — iOS-specific Tauri ACL capability |
| `src-tauri/src/lib.rs` | Add `#[cfg]` guards for `taskbar`, `linux_*`, `discord` on iOS; add `#[cfg(target_os = "ios")] mod ios_platform` |
| `src-tauri/src/android.rs` | Add iOS bridge stubs or refactor to `src-tauri/src/mobile_platform.rs` that dispatches to Android or iOS |
| `src-tauri/tauri-plugin-hushio-player/src/lib.rs` | Add `#[cfg(target_os = "ios")]` plugin registration for Swift bridges |
| `src-tauri/tauri-plugin-hushio-player/Cargo.toml` | Add iOS build dependencies when Swift plugin is scaffolded |
| `src-tauri/gen/apple/` | Generated by `tauri ios init`; modified for entitlements and Info.plist |

### Files owned by other agents (do not edit)

| File / Directory | Owner |
|---|---|
| `src/` (all TypeScript/React) | Source Logic Archaeologist, React Port Engineer, Design Custodian |
| `src-tauri/src/` (feature modules: lyrics, downloads, scrobble, stats, network, etc.) | iOS Services Engineer |
| `src-tauri/src/playback.rs` | iOS Media Engineer (iOS playback adapter) |
| `docs/ios-port/MASTER_PLAN.md` | Lead |
| `docs/ios-port/DESIGN_SPEC.md` | Design Custodian |
| `docs/ios-port/SOURCE_ATLAS.md` | Source Logic Archaeologist |

---

## 12. Critical Path to Phase B Gate

The Phase B gate requires: *App launches in the simulator and shows the actual shared phone interface, with no startup failures from unavailable native capabilities.*

Steps in dependency order:

```
1. [USER] Accept Xcode license: sudo xcodebuild -license accept
2. [USER] Install rustup and add iOS targets:
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
      rustup target add aarch64-apple-ios aarch64-apple-ios-sim
3. [PLATFORM ENGINEER] Run:
      DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
        tauri ios init
   → generates src-tauri/gen/apple/
4. [PLATFORM ENGINEER] Create tauri.ios.conf.json with:
      - distinct bundle identifier (e.g., com.hushio.app.iosdev)
      - minimum iOS version matching user's device
5. [PLATFORM ENGINEER] Add #[cfg] guards for iOS blockers:
      - taskbar::setup, linux_session, linux_portal on iOS
      - discord unconditional init
      - tray-icon feature if it causes link failure
6. [PLATFORM ENGINEER] Add iOS secrets stub in android.rs / new ios.rs
      (returns descriptive "iOS keychain not yet implemented" until Phase D)
7. [PLATFORM ENGINEER] Verify tauri = { features = ["tray-icon"] } links on iOS
      - If it fails: remove feature from unconditional dep; add back as
        [target.'cfg(desktop)'.dependencies] entry
8. [PLATFORM ENGINEER] First build attempt:
      DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
        tauri ios build --target aarch64-apple-ios-sim
      → resolve all remaining link/compile errors
9. [PLATFORM ENGINEER] Run simulator:
      DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
        tauri ios dev
      → confirm app displays existing phone shell
```

Expected compilation issues beyond step 8:
- SMB crates may have system linkage (verify on first build)
- `souvlaki` and `keyring` macOS features must not be pulled in by iOS (platform guards in `Cargo.toml` are correct for macOS; verify they don't cascade)
- Tokio runtime configuration (`features = ["full"]`) is known to work on iOS

---

## 13. References

| Resource | URL | Status |
|---|---|---|
| Tauri 2 iOS guide | https://v2.tauri.app/guides/create-mobile-apps/ios/ | Unverified (network not accessed; URL from Tauri 2 docs structure) |
| Tauri 2 mobile plugin guide | https://v2.tauri.app/develop/plugins/mobile/ | Unverified |
| Tauri 2 prerequisites | https://v2.tauri.app/start/prerequisites/ | Unverified |
| Rust `aarch64-apple-ios` target tier | https://doc.rust-lang.org/nightly/rustc/platform-support/apple-ios.html | Unverified |
| Apple ATS localhost exemption | https://developer.apple.com/documentation/bundleresources/information_property_list/nsapptransportsecurity | Unverified |
| `rustup target add` reference | https://rust-lang.github.io/rustup/cross-compilation.html | Unverified |

> [!NOTE]
> All URLs above are labeled **Unverified** per task instructions — network access was not used during this assessment. Citations are drawn from known Tauri 2 and Apple documentation structures as of the assessment date and from direct source inspection at baseline commit `2122110`.

---

## 14. Blocker Register

| ID | Blocker | Phase | Severity | Resolution |
|---|---|---|---|---|
| PLT-01 | Xcode license not accepted — all iOS toolchain steps blocked | B | **Critical** | User must run `sudo xcodebuild -license accept` |
| PLT-02 | `rustup` absent — iOS `rust-std` targets cannot be installed | B | **Critical** | User/engineer: install `rustup`, add iOS targets |
| PLT-03 | No `gen/apple/` iOS Xcode project — `tauri ios init` not run | B | High | Unblocked only after PLT-01 and PLT-02 |
| PLT-04 | `google_auth.rs` / `secrets.rs` iOS path returns Android-not-available error | D | High | iOS keychain Swift plugin + `ios.rs` Rust adapter |
| PLT-05 | `tauri-plugin-hushio-player` iOS branch is a no-op — no native audio | C | High | iOS Swift AVFoundation plugin |
| PLT-06 | No `tauri.ios.conf.json` — bundle identifier, entitlements, deployment target missing | B | High | Create before `tauri ios init` |
| PLT-07 | `taskbar::setup`, `linux_session::setup`, `linux_portal::start` unconditional calls may panic on iOS | B | Medium | Add `#[cfg(desktop)]` guards |
| PLT-08 | `tray-icon` Tauri feature — iOS link behavior unverified | B | Medium | Verify on first `tauri ios build` |
| PLT-09 | OAuth sign-in (`google_sign_in`, `spotify_sign_in`) uses TCP loopback callback — may not work on iOS | D | Medium | Replace with `ASWebAuthenticationSession` |
| PLT-10 | Physical device signing (Apple Account, cert trust, Developer Mode) | F | Medium | User-operated steps; documented above |
| PLT-11 | SMB crates compile unconditionally — no iOS exclusion | B | Low | Add `cfg` guard if link issues found; binary size impact |
| PLT-12 | Discord IPC unconditionally initialized — will silently fail on iOS | B | Low | Add `#[cfg(not(any(target_os = "ios", target_os = "android")))]` |

---

*Assessment complete. No code, settings, or licenses were modified. Next action requires PLT-01 (user) and PLT-02 (user/engineer) to be resolved before any build attempt.*
