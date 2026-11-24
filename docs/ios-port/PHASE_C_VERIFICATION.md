# Phase C verification — native playback (iOS)

Baseline commit `2122110f9b41436723f368d3e1fb4d8a2a4276c2`, branch `port/ios`. Everything below was executed on 2026-11-23 on this machine; nothing is projected or estimated.

## Milestone vocabulary

Per `DECISIONS.md` ADR-006: **prototype host works** and **core playback passes (simulator)** are separate from **physical-device background parity**. This document claims the first two only.

## 1. Plugin registration and command round-trip (screen evidence)

- `tauri ios build --debug -t aarch64-sim` → exit 0; bundle `src-tauri/gen/apple/build/arm64-sim/Hushio.app`, id `com.hushio.app.iosdev`.
- Installed and launched on the **iPhone 17 Pro** (iOS 26.5) simulator: PID alive, no crash.
- Screenshot `evidence/ios-phasec-native-plugin.png` shows the **real product**: live catalogue ("Playlists for you", Pop Motivation, Wide Open Country, Classic Rock Party with artwork), the phone shell (Home/Search/Library/Hotlist), greeting and profile button. Catalogue data arrived through the real Rust bridge — not mocked.
- No `No command <x> found for plugin` and no `Plugin hushio-player not initialized` in the device log, so the frontend's startup `player_get_state` round-tripped through the Swift plugin.
- Engine construction is visible in the device log: `-[AVPlayer setAutomaticallyWaitsToMinimizeStalling:]`, `AVAudioSessionImpl_Simulator … Set volume on device 82 to 0.60`, `MPRemoteCommandCenter setSupportedCommands (…)`, `MRMediaRemoteSetCanBeNowPlayingForPlayer … YES`.

## 2. Controlled-audio engine probe (P8, controlled WAV)

The **shipping** engine source (`ios/Sources/PlayerSnapshot.swift` + `PlayerEngine.swift`) was compiled for `arm64-apple-ios15.0-simulator` with a probe driver (`evidence/p8/main.swift`) and executed **inside the simulator runtime** via `xcrun simctl spawn`.

Input: deterministic 8 s 440 Hz mono WAV, file URL passed as `contentUri` — the same field the services adapter will populate.

Observed (`evidence/p8/p8-run.log`, two independent runs):

| Check | Expected | Observed |
|---|---|---|
| Queue install | `accepted == 1` | 1 |
| Decoded duration | ~8000 ms, from the asset (not the wire hint) | 8000 ms |
| Real progression | position advances while playing | 1299 → 3300 ms |
| Pause holds | no advance while paused | 3302 → 3302 ms |
| Seek | 6000 ms lands at 6000 ms | 6000 ms |
| Snapshot stream | non-empty, tagged with current id | 14 snapshots, all `local:p8-probe` |

Result: **P8 PASS**. This exercises real AVPlayer decode/timing/seek/state emission — not a mock and not a fabricated snapshot.

## 3. Frontend routing

`NATIVE_PLAYER = ANDROID || IOS` (`src/lib/androidPlayback.ts`) now selects the `hushio-player` boundary on iOS; `src/lib/audio.ts` uses it for all 15 dispatch sites. `isAndroidAgent` is unchanged, so `networkType.ts` and Android behaviour are unaffected. `pnpm typecheck` exit 0; `pnpm test` 3,746 tests in 354 files, exit 0.

## 4. What this does NOT establish

- **Physical-device playback and background audio** (lock screen, interruption, route change, Bluetooth) — simulator only. Requires the signed device build (Phase F).
- **Local-library playback through the UI** — needs the document picker (Phase D) to populate `contentUri`; the probe supplies that value directly.
- **Equalizer** — `player_set_eq` rejects `not_implemented`; `AVAudioUnitEQ` is the documented C3 proposal.
- **Native queue advancement / background transitions** — contract C-1/C-2 unresolved; the engine deliberately supports the active singleton item only.
- **Google Cast** — rejects `not_supported` (Android SDK only; AirPlay is not the same feature).
