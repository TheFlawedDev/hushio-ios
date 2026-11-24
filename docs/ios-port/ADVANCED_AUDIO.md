# Advanced audio on iOS — capability decisions

Status: **source-only**. Everything below is compiled for the iOS simulator
(`Build complete!`) but has not been run on a physical device. No row here is a claim of
device-verified audio behaviour; the evidence vocabulary is ADR-006.

Baseline: `2122110f9b41436723f368d3e1fb4d8a2a4276c2`.
Contract source: `BEHAVIOR_CONTRACTS.md` §P7 ("Advanced audio contracts and platform
disagreement"). Engine: `src-tauri/tauri-plugin-hushio-player/ios/Sources/PlayerEngine.swift`
(one `AVPlayer`, one active item — transport only, never queue semantics, per ADR-007
Decision 3).

## Capability table

| Capability | Baseline behaviour (§P7) | AVFoundation reality on an `AVPlayer` engine | Decision | Rejection code (current) |
|---|---|---|---|---|
| **EQ** | Shared 10-band EQ (32 Hz…16 kHz, Q 1.41, shelf endpoints, headroom at boosted level, limiter −0.5 dB/20:1). Desktop applies mpv EQ. Android maps to nearest log-frequency hardware `Equalizer` bands; unavailable hardware returns `appliedBands: 0`. | `AVPlayer` exposes only `volume`/`isMuted`/`rate` — there is no equalizer node and no per-band gain API. `AVAudioUnitEQ` exists **only** inside an `AVAudioEngine` graph, which means rebuilding the render path off `AVPlayer`. That is a separate ADR, not a "just add a node" change. | **rejects-not_implemented** (`player_set_eq` throws `PlayerEngineError.notImplemented`; never fakes `appliedBands > 0`) | `not_implemented` |
| **Crossfade / Automix** | `audio.ts` two-deck pipeline: fade 0–12 s, smart fallback 6 s, arm within fade+4 s, remaining > 250 ms, fade ≥ 500 ms, equal-power cosine/sine at 25 ms ticks; skip too-short/same-ID; pause freezes, seek/context-change aborts. Android settings hide it and the Android engine bypasses the deck pipeline. | Crossfade requires two concurrent decode/render paths with independent gain envelopes. A single `AVPlayer` cannot crossfade. There is **no** native mobile command for it (not in `build.rs` `COMMANDS`), and the desktop `audio.ts` deck pipeline is not wired to the native `AVPlayer` engine. | **shared-layer owner** (the TS `audio.ts` deck pipeline owns crossfade/Automix; no native command on either mobile platform) | n/a — no wire command exists |
| **Skip silence** | Shared `headTrimTarget`/`tailReached` use offline `track_analysis` (Symphonia, 10–1200 s, analysis cache 100); tail polling 500 ms. Android has a native continuous `skipSilenceEnabled` but no TS setter call. Leading/trailing trim ≠ Media3 continuous skipping. | `AVPlayer` has no skip-silence/gate API and no equivalent of Media3 `skipSilenceEnabled`. Leading/trailing trim needs offline analysis (shared layer), not an `AVPlayer` switch. | **rejects-not_implemented** (`player_set_skip_silence` rejects honestly; no silence trimming is faked) | `not_supported` |
| **Leveling (LUFS)** | `loudness.ts` targets quiet −19 / normal −14 / loud −11 LUFS (fallback −9); gain bounded 0.05–1 (no boost), unity off, 2 s glide when learned mid-playback. Shared Android `setVolume` forwards directly and does not apply the leveling pipeline. | `AVPlayer` has no loudness measurement or normalization. LUFS leveling needs offline loudness analysis plus a gain envelope; there is no native command for it. The shared layer is the only owner today and expresses its gain by scaling the volume sent through `player_set_volume` (which native merely clamps 0–1 and applies). | **shared-layer owner** (shared `loudness.ts`; no native leveling command) | n/a — no wire command exists |
| **Sleep timer** | Shared: minutes clamp 1–720, `Date.now()` deadline or end-of-song, 250 ms tick, linear final-10 s fade, pause + `playing=false` at deadline, restore volume after 500 ms; end-of-song overrides repeat-one and cancels the timer in `handleEnded`; not persisted. Android native: deadline-only active ticker at 250 ms, writes absolute `player.volume` during fade (not multiplied by base/EQ), pause then 500 ms restore; `endOfSong` is pause-at-end, not a countdown fade. | Fully implementable: `AVPlayer.volume` is directly settable and the ticker/fade/restore is pure transport math on the main queue — no `AVAudioEngine` rebuild required. Implemented in `PlayerEngine.setSleepTimer` and bound to `player_set_sleep_timer`. | **implemented** (this task; transport-only, never queue/advance events) | resolved void on success; `invalid_argument` for a non-finite deadline (was `not_supported` before implementation) |

## Why EQ is not "just add a node"

`AVAudioUnitEQ` is a real, usable node — but it lives in an `AVAudioEngine` graph, not in
`AVPlayer`. Adding it is not a small extension; it is a re-platforming of the render path:

- `AVPlayer` has no public node graph. The only way to insert `AVAudioUnitEQ` is to build
  an `AVAudioEngine` chain (`AVAudioPlayerNode` + `AVAudioUnitEQ` + `AVAudioUnitTimePitch`
  where needed + the output), and feed it from an `AVAudioFile`/`AVAudioPCMBuffer`/manual
  scheduling path.
- That re-platforming changes buffering, seeking, HTTP byte-range/header replay
  (`HushioResourceLoader`), codec coverage and error handling all at once. It is a
  capability of its own and belongs in a separate ADR — it is not reachable by "adding a
  node" to the current `AVPlayer` engine.
- The current `player_set_eq` therefore rejects `not_implemented` rather than returning a
  fake `appliedBands` count. `src/lib/androidEngine.ts` already
  `playerSetEq(...).catch(report("eq"))`, so the rejection is logged and swallowed today
  and no UI gate depends on a non-zero band count.

## Sleep timer (implemented) — transport semantics

`player_set_sleep_timer {endsAtEpochMs: number|null, endOfSong: boolean}` → void, mirroring
the Android `SleepTimer` + `PlayerService.setSleepTimer` shape unchanged (P2):

- **Deadline mode** (`endsAtEpochMs` non-null): a 250 ms main-queue ticker evaluates
  `remaining = deadline − now`. While `0 < remaining < 10_000` it writes the absolute
  `player.volume = remaining / 10_000` (linear, `min(1, max(0, ·))`), exactly like Android
  writing absolute volume rather than multiplying `baseVolume`. At `remaining ≤ 0` it
  pauses, then restores the pre-fade volume after **500 ms**.
- **Past deadline**: the first evaluation sees `remaining ≤ 0` and pauses immediately
  (zero-length fade), still scheduling the 500 ms restore.
- **`endOfSong: true`**: pause when the current item completes, no fade, and the engine
  never advances or restarts (ADR-007 Decision 3). `actionAtItemEnd = .pause` already
  stops the `AVPlayer` at end; the engine additionally clears its play intent so the
  snapshot reports genuinely stopped rather than Media3-style `playing: true`.
- **`{endsAtEpochMs: null, endOfSong: false}`** cancels the timer and restores
  `baseVolume` if a fade was in progress.
- **Already paused at deadline**: pausing is idempotent and the 500 ms restore still runs,
  so a fade that began while paused cannot leave the volume desynchronised.
- **Invalid payload**: a non-finite deadline throws `PlayerEngineError.invalidArgument`
  (`invalid_argument`) instead of being clamped.

Transport-only guarantees: the timer changes `player.volume`, `playRequested` and
`player.pause()` and emits at most a `player-state` snapshot. It never emits queue,
advance, `player-track-changed` or repeat/shuffle events. The Android informational
`player-sleep {state}` event is **not** emitted here — it has no TS consumer (§P2) and
lies outside the authorised additive wire surface (ADR-007 Decision 1 authorises exactly
one additive field: `player-ended {id}`).

## Related files

- `src-tauri/tauri-plugin-hushio-player/ios/Sources/PlayerEngine.swift` — `setSleepTimer`
  and the ticker/fade/fire/restore helpers; `handleItemEnded` now carries the ended id and
  honours `endOfSong`.
- `src-tauri/tauri-plugin-hushio-player/ios/Sources/HushioPlayerPlugin.swift` —
  `player_set_sleep_timer` selector bound to the engine; `player-ended` emits `{id}` when
  the ended item id is known, `{}` otherwise (ADR-007 Decision 1).
