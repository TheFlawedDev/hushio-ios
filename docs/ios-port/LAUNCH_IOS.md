# iOS Deep-Link and App-Launch Routing (`hushio://...`)

This document records the architecture, investigation, static verification, and runtime expectations for deep-link and launch routing on iOS.

Per ADR-006 (`docs/ios-port/DECISIONS.md`), device-specific runtime operations are never marked as verified without physical hardware execution evidence.

---

## 1. Investigation of Tauri 2 & `tauri-plugin-deep-link` on iOS

### 1.1 Vendored Plugin Architecture

Inspection of `tauri-plugin-deep-link` v2.6.3 (`Cargo.lock` / crates.io vendored source):

- **Event delivery**:
  In `tauri-plugin-deep-link/src/lib.rs` (lines 719–731):
  ```rust
  .on_event(|_app, _event| {
      #[cfg(any(target_os = "macos", target_os = "ios"))]
      if let tauri::RunEvent::Opened { urls } = _event {
          use tauri::Emitter;

          let _ = _app.emit("deep-link://new-url", urls);
          _app.state::<DeepLink<R>>()
              .current
              .lock()
              .unwrap()
              .replace(urls.clone());
      }
  })
  ```
  On iOS and macOS, URL open events from the operating system (`UIApplicationDelegate application:openURL:options:` on iOS) are surfaced by Tauri core as the enum variant `tauri::RunEvent::Opened { urls }`.
  The deep-link plugin hooks into `.on_event(...)`, emits the Tauri event `"deep-link://new-url"` carrying `urls: Vec<Url>`, and records them in plugin state (`DeepLink.current`) accessible via the command `plugin:deep-link|get_current`.

- **Scheme registration**:
  In `tauri-plugin-deep-link/src/lib.rs` (lines 140–165):
  `register`, `unregister`, and `is_registered` reject with `crate::Error::UnsupportedPlatform` on iOS, Android, and macOS. Dynamic URL scheme registration at runtime is an OS-level impossibility on iOS. URL schemes must be statically declared in `Info.ios.plist` under `CFBundleURLTypes` and configured in `tauri.ios.conf.json`.

- **Configuration mapping**:
  In `tauri-plugin-deep-link/src/config.rs`, mobile schemes are declared under `plugins.deep-link.mobile`:
  ```json
  {
    "plugins": {
      "deep-link": {
        "mobile": [
          { "scheme": ["hushio"] }
        ]
      }
    }
  }
  ```

---

## 2. Implementation Summary

### 2.1 Owned File Changes

1. **`src-tauri/tauri.ios.conf.json`**:
   Configured `plugins.deep-link.mobile` with scheme `["hushio"]` so that Tauri's deep-link plugin recognizes the custom scheme on iOS, matching the existing `CFBundleURLTypes` entry in `Info.ios.plist`.

2. **`src-tauri/src/ios_scheme.rs`**:
   Added `APP_SCHEME = "hushio"` and `SPOTIFY_SCHEME = "hushio-spotify"` alongside `REDIRECT_SCHEME = "com.hushio.app.iosdev"` so all registered iOS schemes are documented in code.

3. **`src/lib/launch.ts`**:
   - Added `launchActionForUrl(rawUrl)` to parse `hushio://playlist?list=...` and file URLs into `LaunchAction`.
   - Reused the existing desktop `launchTake()` / `launch_take` IPC plumbing on iOS rather than inventing an ad-hoc mechanism.
   - Preserved `player_take_launch` as an honest `not_supported` rejection on iOS (avoiding fabricated Android intent adoption).
   - In `startLaunchActions()`, subscribed to `"deep-link://new-url"` alongside `listenLaunchPending` so that deep-link open events delivered by Tauri are converted to `LaunchAction`s and dispatched through `routeLaunchAction()`.
   - In `routeLaunchTarget()`, wired the iOS `target.kind === "file"` branch to adopt the launch file via `adoptLaunchFile` and route into `playOpenedFile`.

4. **`src/lib/bridge.ts`**:
   - Added `adoptLaunchFile(url)` wrapper forwarding to `plugin:hushio-player|adopt_launch_file`.

5. **`src-tauri/tauri-plugin-hushio-player/ios/Sources/HushioServicePlugins.swift`**:
   - Added `adopt_launch_file` selector to `HushioAudioPlugin` and forwarded through `HushioPlayerPlugin`, converting `file://` URLs to durable security-scoped bookmarks via `HushioReference.persist`, returning `{ uri }` and rejecting with real failure codes (`invalid_argument`, `invalid_url`, `not_a_file`, `bookmark_failed`).

6. **`src-tauri/src/android.rs`**:
   - Added `adopt_launch_file` facade function in iOS `mod bridge` using `call_async_bounded` to invoke the mobile plugin selector.

7. **`src/lib/launch.test.ts`**:
   - Added comprehensive tests covering `launchActionForUrl`, iOS file launch routing through `adoptLaunchFile`, error propagation on bookmark failure, deep-link event reception (`deep-link://new-url`), and clean unlistening.

---

## 3. Status of File Launch on iOS: Implemented (SRC), Device-Unverified

iOS file URLs are security-scoped (`NSURL startAccessingSecurityScopedResource` and `stopAccessingSecurityScopedResource`).
As established in `src-tauri/tauri-plugin-hushio-player/ios/Sources/DocumentPicker.swift`, durable file access across launches requires serializing a security-scoped bookmark (`HushioReference`).

File launches delivered to the app now route through `adopt_launch_file` on `hushio-audio` / `HushioPlayerPlugin`, validating the target file and serializing a security-scoped bookmark via `HushioReference.persist`. Security-scoped access is bracketed with `startAccessingSecurityScopedResource` and `defer { stopAccessingSecurityScopedResource() }` on every exit path. The resulting opaque reference string is passed into `playOpenedFile(uri)`, mirroring Android's queue installation with `contentUri: uri`.

### 3.1 Remaining Limitation in Native Audio Transport
While launch adoption and bookmark persistence are source-complete (**SRC**), native playback in `PlayerEngine.swift` currently expects `contentUri` to be a directly resolvable file URL or POSIX path (`item.playbackURL` in `PlayerSnapshot.swift` calls `URL(string: text)` or `URL(fileURLWithPath: text)`). Because an opaque base64 bookmark reference string is not a file URL scheme, `item.playbackURL` returns `nil`, causing `PlayerEngine.loadCurrentItem` to call `awaitURL(item, reason: .missing)` (emitting `player-stream-needed`) rather than resolving the bookmark via `HushioReference.resolve(reference)` and scoping the `AVURLAsset` read.

In accordance with ADR-007 (native transport ownership) and project rules, no parallel player was invented; the standard path was wired and this gap is honestly recorded.

### 3.2 Exact Device Test to Close Parity
To verify end-to-end on a physical device (post-signing blocker H1) or simulator:
1. Transfer an audio file (`test.mp3`) to the iOS device or simulator Files container.
2. In Files.app, select the file and share / open with Hushio.
3. Observe Tauri delivering the open event via `deep-link://new-url` or `launch_take`.
4. Observe `adopt_launch_file` returning `{ uri }` containing the base64 bookmark data.
5. In `PlayerEngine`, verify the queue item is installed with the reference.
6. Verify playback begins and continues across app restarts using the resolved security-scoped bookmark.

---

## 4. Verification Evidence

### 4.1 Static & Test Verification (PASS)

- **TypeScript check**:
  ```sh
  pnpm typecheck
  ```
  Result: Exit code 0 (no type errors).

- **Vitest unit tests**:
  ```sh
  pnpm vitest run src/lib/launch.test.ts src/lib/launchLink.test.ts
  ```
  Result: 2 test files passed, 38 tests passed.

- **Rust target check**:
  ```sh
  cd src-tauri && cargo check --target aarch64-apple-ios-sim
  ```
  Result:
  - When invoked with default system environment, Homebrew's `cargo` lacks the `aarch64-apple-ios-sim` standard library (`error[E0463]: can't find crate for core`).
  - When invoked under `rustup`'s toolchain (`~/.cargo/bin`), the Swift package build script in `tauri-plugin-hushio-player` attempts to write to `/var/folders/.../C/clang/ModuleCache`, which requires host sandbox bypass.
  This is an existing toolchain precondition documented in ADR-005 and `REMAINING_SEQUENCE.md`.

---

## 5. Physical Device & Simulator Reproduction Steps

Once an iPhone or simulator is booted:

### 5.1 Simulator Custom-Scheme Test
1. Boot simulator:
   ```sh
   xcrun simctl boot "iPhone 16"
   ```
2. Build and run app in simulator:
   ```sh
   cd src-tauri
   pnpm exec tauri ios dev
   ```
3. Trigger deep link via `simctl`:
   ```sh
   xcrun simctl openurl booted "hushio://playlist?list=PLrAl6PslT9-XUvKWev54bQ0z8bLqjC_T1"
   ```
4. Verify navigation: The app should navigate to view `ytplaylist` with browse ID `VLPLrAl6PslT9-XUvKWev54bQ0z8bLqjC_T1`.

### 5.2 Physical Device Test (Post-Signing H1)
1. Complete developer signing in `src-tauri/tauri.ios.conf.json` (`bundle.iOS.developmentTeam`).
2. Install build via Xcode or `tauri ios build -t aarch64`.
3. Tap a `hushio://playlist?list=...` link from Notes, Safari, or Messages.
4. Verify the app opens and immediately navigates to the shared playlist.
