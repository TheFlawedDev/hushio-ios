# iOS bridge facade audit — fabricated-success sweep

Step 1 of `REMAINING_SEQUENCE.md`. Scope: every Rust code path an iOS build compiles that a
shared caller reaches, classified as **ROUTES** (forwards to a real Swift bridge),
**HONEST-ERROR**, **FABRICATED** (a success for an unimplemented capability), or
**N/A-JUSTIFIED** (harmless on iOS and documented in code).

Reproduce the candidate set with:

```sh
rg -n 'cfg\(target_os = "ios"\)|cfg\(not\(target_os = "android"\)\)|cfg\(not\(any\(' src-tauri/src
```

## `src-tauri/src/android.rs`

| Function | iOS behaviour | Class |
|---|---|---|
| `secret_read` / `secret_write` / `secret_clear` | `secure_get` / `secure_set` / `secure_clear` on the Swift Keychain bridge | ROUTES |
| `pick_tree` / `scan_tree` / `read_sidecar_lrc` | `pick_tree` / `scan_tree` / `read_sidecar_lrc` on the Swift document-picker bridge | ROUTES |
| `media_delete` | `media_store_delete` (iOS export reference, not MediaStore) | ROUTES |
| `publish_download` | `media_store_publish` (document export) | ROUTES |
| `open_sign_in` / `await_sign_in_redirect` | `auth_open` / `auth_await` on `ASWebAuthenticationSession` | ROUTES |
| `schedule_retry` | `schedule` on `BGTaskScheduler`; now also requires a registered handler (see below) | ROUTES |
| `notification_state` / `notification_request` / `notification_settings` | `notification_*` on `UNUserNotificationCenter` (fixed this milestone; previously returned `Ok("granted")`) | ROUTES |
| `update_*` (`update_check`, `update_download`, `update_install`, `update_open_install_settings`) | `Err("<command> is not supported on iOS")` | HONEST-ERROR |

Every iOS call goes through `call_bounded` / `call_async_bounded`, so a hung bridge fails
after 1.5 s and latches `BLOCKED` instead of blocking the main thread (B015).

## `src-tauri/src/mobile.rs` (compiled for `cfg(mobile)`, i.e. Android **and** iOS)

These are baseline inline-`tauri::command` stubs, not iOS adapters (ADR-004). Classified
individually because "returns `Ok(())`" is not evidence of a capability:

| Command | iOS reality | Class |
|---|---|---|
| `updates_state` / `updates_check` / `updates_install` / `updates_restart` | Return an idle/void payload, but **iOS no longer calls them**: `startUpdates()` is an explicit no-op on iOS and the settings row is hidden by `IOS_HIDDEN_ROWS`. | N/A-JUSTIFIED (caller removed) |
| `tray_set_playing` | No-op. iOS has no system tray; nothing calls it (the only TS wrapper has no caller). | N/A-JUSTIFIED |
| `window_intro_done` / `window_set_reduce_transparency` | No-ops. iOS window translucency/Reduce Transparency is system-owned; `windowGlass.ts` is desktop-only. | N/A-JUSTIFIED |
| `pip_*` (`pip_toggle`, `pip_is_open`, `pip_ready`, …) | No-ops returning `false`/`Ok(())`. The PiP surface is a desktop window; `PipButton` and `OutputDeviceButton` return `null` on iOS and `PipApp` is never mounted. | N/A-JUSTIFIED |

No change made: altering these would diverge from the Android baseline for no iOS benefit,
and the reachable-caller analysis is what makes them inert.

## `src-tauri/src/lib.rs`

| Path | Class |
|---|---|
| `#[cfg(not(desktop))] let _ = (window, event);` / `let _ = (webview, payload);` | N/A-JUSTIFIED — explicit discards, not success returns |
| `.register_uri_scheme_protocol("localart" / "netmusic")` — real handlers on all platforms | ROUTES |
| `update_*` command wrappers → `android::update` → honest error on iOS | HONEST-ERROR |

## Found and fixed in this sweep

1. **`notification_*` returned `Ok("granted")` on iOS** — a fabricated permission success.
   Now routed to the Swift bridge (previous commit); the desktop stub is kept but renamed
   `not(any(android, ios))` and commented as *not* a parity claim.
2. **`schedule` was unreachable by design** — `Info.ios.plist` had no
   `BGTaskSchedulerPermittedIdentifiers`, so `HushioSyncTask.scheduleRetry()` would reject
   `bg_task_not_permitted` forever, and no launch handler was registered (submitting without
   one makes the OS terminate the app when the task fires). Fixed: the plist key is present,
   `HushioSyncPlugin.load(webview:)` registers the handler once, `schedule` rejects
   `bg_task_not_registered` if the OS refused it, and the handler completes the task as
   **failed** rather than pretending the Rust sync queue ran.

## Deliberately not treated as defects

- `player_*` `not_supported` rejections (`player_next`, `player_set_repeat`, `cast_*`, …) are
  honest refusals, not fabrications.
- `player_set_eq` rejects `not_implemented`; see `ADVANCED_AUDIO.md` for why EQ is a
  re-platforming of the render path rather than a missing node.
