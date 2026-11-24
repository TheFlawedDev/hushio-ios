# Behavior contracts — baseline extraction, not an iOS implementation

**Baseline:** `2122110f9b41436723f368d3e1fb4d8a2a4276c2`. Read with `SOURCE_ATLAS.md` and `FEATURE_MATRIX.md`. All target behavior is **pending/unverified on iOS**. Source paths are repository-relative; `K/` and `KT/` abbreviate the Android player Kotlin implementation/test directories defined in the atlas.

“Observed” below means extracted from control flow, not device-verified. “Required proof” is an acceptance scenario, not a claim of current source correctness. Where desktop, shared TS and Android disagree, the disagreement is part of the contract handoff. No new algorithm, native interface or security policy is approved by this document.

## P1. Playback values, units and source identity

### Shared application model

`src/stores/player.ts::PlayerValues`, `src/types.ts::Track`, `src/lib/audio.ts::Playback`:

- Shared `position`, `duration`, seek arguments and `Track.duration` are **seconds**. Unknown duration is represented as `0` in the store (audio façade may have NaN). UI position update events read `audio.currentTime`.
- `playing` is optimistic intent at `startCurrent`, then updated from audio events. `buffering` is independent; `waiting` sets it true, `playing` clears it. The native mobile `playing` field is **playWhenReady**, not Media3 `isPlaying`, so buffered playback can have both playing and buffering true.
- Shared volume is finite, clamped **0–1**; default **0.8**. Set-volume clears mute. Sleep scales the level. Shared speed setting is **0.5–2**, rounded to **0.05**; pitch preservation is requested.
- `playQueue` resets the playback context and increments `contextId`; `load` maintains its own `loadGeneration` and `loadedId`. These are not interchangeable with a track ID or native generation.

### Mobile queue item wire model

`src/lib/androidPlayback.ts::PlayerQueueItem/PlayMeta/queueItemFor`, `src/lib/bridge.ts::playerSetQueue`, `K/PlayerPlugin.kt::parseItem`, `K/QueueItem.kt`:

| Field | Meaning / exact boundary |
|---|---|
| `id: string` | Library/source identity; not URL, not queue occurrence ID. Native URL updates locate the **first matching ID**. Duplicate IDs are possible in shared queue history, so ID alone is insufficient for replacement generations. |
| `title`, `artist` | Display metadata; artist defaults empty. TS `PlayMeta` does not include album although Kotlin queue item accepts optional `album`. |
| `durationMs: number` | Milliseconds; shared `playMetaFor` uses `Math.round((track.duration ?? 0) * 1000)`. Not a substitute for decoded native duration. |
| `url: string` | Resolved URL; empty for local items created by TS. TS remote headers contain `User-Agent: MEDIA_USER_AGENT`. |
| `headers: Record<string,string>` | Per-stream request headers; copied by `queueItemFor`, remembered by native service keyed by playback URI and injected by Media3 resolving data source. Not a general credential export. |
| `liked: boolean` | `queueItemFor` initializes false, not current library lookup. Native like synchronization back into JS exists; JS-to-native setter is not called in the surveyed TS. |
| `expiresAtEpochMs: number | null` | Absolute epoch **milliseconds**, null for local. URL `expire` parameter/path seconds multiplied by 1000; otherwise `expiryOf` uses now + **10 minutes**. Different from resolver cache TTL. |
| `contentUri?: string` | Native local source. Kotlin `playbackUri()` prefers `contentUri` over `url`; **null** versus empty string matters, because missing-URI checks test null. Not an iOS security-scoped URL format. |
| `artworkUrl?: string` | Optional. Shared metadata sends only HTTP(S) artwork; local artwork URI is not forwarded here. Kotlin fetches native artwork separately. |

`PlayerSnapshot` wire payload: `{playing, buffering, positionMs, durationMs, index, id, speed, repeat, shuffle}`. `id` nullable, position/duration ms coerced ≥0 in Kotlin `toPayload`, repeat `off | all | one`, speed unitless multiplier. TS idle snapshot: false/false, zero times/index, null ID, speed 1, repeat off, shuffle false. Kotlin empty queue current is **-1**, so the idle TS index is not an invariant native index.

### Source ID families (preserve, do not normalize into video IDs)

- YouTube catalogue: actual video IDs and browse IDs; radio accepts valid source IDs via `autoplay.ts::isRadioSeed` rather than all arbitrary strings.
- Local: `local:` + first 16 lowercase hex characters of SHA1 of the **lowercased path** (`R/local_library.rs::hash_path/read_track`). Renaming/moving a file can change identity; preserving an ID across a copied sandbox path is an unresolved migration decision, not existing behavior.
- Network: `net:{serverId}:{path}` (`R/network.rs::track_id/split_track_id`); split once after server. URI encodes this identity; don't discard path characters/plus/Unicode.
- JioSaavn: `jiosaavn:{sourceId}` (`src/lib/jiosaavn.ts`).
- Add-on search: `addon:{source.id}:{track.id}` (`src/lib/searchScope.ts::addonSongOf`). The active audio source dispatcher has no dedicated direct-add-on-ID branch; a lossless metadata match may work, but uncapped/capped paths need baseline proof.
- Android open-file launch can use the **content URI itself** as native ID (`src/lib/launch.ts::playOpenedFile`), and does not reconstruct the normal JS queue.

**Tests:** `src/lib/androidPlayback.test.ts`, `androidEngine.test.ts`, `src/stores/player.restore.test.ts`, `src/lib/localLibrary.test.ts`, Rust local-library/network tests, `KT/PlayerPayloadsTest.kt`, `PlayerMathTest.kt`.

## P2. Mobile command/event boundary

Commands are invoked as `plugin:hushio-player|<snake_case_name>` by `src/lib/bridge.ts`; Kotlin methods are camelCase. Non-Android plugin currently has no corresponding implementation. “Resolve void” means command acceptance, **not evidence that audio started**.

### Playback and queue commands

| Command | Arguments / result | Observed Kotlin behavior and TS reachability |
|---|---|---|
| `player_set_queue` | `{items, startIndex, startPositionMs}` → `{accepted}` | `replaceQueue`: cancel URL wait/retry, cap list at 500, clamp index, replace MediaItems, prepare then **pause**; empty clears. TS calls this with **one item/index 0**, followed by play. Position is milliseconds; no separate input clamp here beyond underlying player. |
| `player_play`, `player_pause` | none → void | `setPlaying`: play first calls `ensureUsable`; pause does not pass through all URL-wait cancellation state. Resolve does not promise readiness. |
| `player_get_state` | none → snapshot | Current intent/state; called at engine start, explicit resume and foreground visibility. |
| `player_seek` | `{positionMs}` → void | Clamp to `[0,max(0,nativeDuration)]`, seek, emit state. Unknown/negative native duration clamps to zero. Shared store only clamps lower bound, so UI may briefly show beyond-end requested position. |
| `player_set_volume` | `{volume}` → void | Clamp 0–1, NaN→1, save baseVolume, apply EQ headroom. TS validates finite before forwarding. |
| `player_set_speed` | `{speed}` → void | Clamp 0.5–2, NaN→1; `PlaybackParameters(speed, 1f)` requests unchanged pitch. |
| `player_set_eq` | `{enabled,gainsDb:number[]}` → `{appliedBands}` | Create Android hardware Equalizer; may return **0** if unavailable; maps ten UI gains to device bands. TS does not use returned count as a success gate. |
| `player_set_url` | `{id,url,headers,expiresAtEpochMs}` → void | First matching native ID, replace MediaItem/headers, clear matching URL wait, prepare if idle, optionally resume; unknown ID rejects `unknown_item`. No generation argument. |
| `player_append`, `player_insert_next` | `{items}` → `{count}` | Native-only surface in surveyed TS; truncates to capacity and adds items in native player. |
| `player_remove_at`, `player_move` | `{index}` / `{from,to}` → void | Native-only surface; invalid index rejects `index_out_of_range`; mirror preserves current occurrence index after mutations. |
| `player_toggle` | none → `{playing}` | Native-only surface; toggles requested play flag with `ensureUsable`. |
| `player_next`, `player_previous` | none → void | Native-only command surface. Previous restarts when >3000ms **or no previous native item**; otherwise previous. This differs from JS previous wrap semantics. |
| `player_set_repeat`, `player_set_shuffle` | `{mode}` / `{enabled}` → void | Native-only surface; repeat unknown mode→off. Shared repeat/shuffle settings have no surveyed calls to these commands. |
| `player_set_skip_silence` | `{enabled}` → void | Native-only surface; Media3 skipSilenceEnabled. Existing UI setting not wired to it. |
| `player_set_sleep_timer` | `{endsAtEpochMs:number|null,endOfSong}` → void | Native-only surface; absolute deadline and pause-at-end; see P7 differences. |
| `player_set_like` | `{id,liked}` → void | Native-only surface; first matching ID or `unknown_item`, updates native heart/session buttons. |

`K/PlayerPlugin.kt::withPlayer/awaitPlayer` serializes access onto Android UI thread, starts service if missing, retries **60 × 50ms** before `player_not_ready`; block exceptions reject error.message or `player_failed`. There is no cancellation token for queued native plugin commands. Source replacement is not a cancel command.

### Player events and consumers

`K/PlayerEvents.kt` has one volatile nullable sink; emit drops an event when no sink. No durable event log, acknowledgment, sequence number or generation is present.

| Event | Payload / observed timing | Current TS consumption |
|---|---|---|
| `player-state` | Snapshot P1; transition/intent/parameter changes and every **1000ms while isPlaying** | `androidEngine.applySnapshot`, then ordered media events. No ID/generation rejection. |
| `player-ended` | `{}` on native STATE_ENDED | Dispatch `ended` unconditionally → shared `handleEnded`. No source identity. |
| `player-action` | `{action}`: play/pause/next/previous/like/unlike | Play sets `wantsPlayback=true`; next→`next(true)`, previous→`prevTrack()`, like/unlike toggles only if needed; pause has no dedicated intent update here. |
| `player-focus` | `{state:"lost"|"gained"}` for playWhenReady audio-focus reason | Sets wantsPlayback to gained. Android Media3 handles audio focus; cannot assume same iOS interruption policy without adapter. |
| `player-stream-needed` | `{index,id,reason:"missing"|"expired"|"http_403"}` | `refreshUrl` checks ID and async generation, refreshes shared resolver, sets URL; reason/index not used by TS. |
| `player-error` | `{index,id,code,message,recoverable}` | Logs code/message and shows generic track-title toast; no ID filter, automatic skip or special handling based on recoverable in TS. |
| `player-track-changed` | `{index,id,reason:"auto"|"user"|"error"}` | **No TS listener found.** Emitted native on item transition. |
| `player-route` | `{reason:"becoming_noisy"|"device_removed"}` | No engine listener found; native already pauses. |
| `player-sleep` | `{state:"fading"|"fired"}` | No surveyed TS listener. |

`mediaEventsFor(before,after)` emits in this exact order when conditions hold: **play, pause, waiting, playing, durationchange, timeupdate**. Play/pause compare playing booleans; playing fires entering playing-without-buffering; durationchange compares duration; timeupdate compares position or index (not ID). ID-only change at same index/time has no dedicated event.

`applySnapshot` suppresses unexpected native playback by requesting pause and reporting `playing:false` when `!wantsPlayback`. A playing snapshot resets refresh counters. Startup accepts an already-playing native snapshot by setting wantsPlayback; foreground `get_state` failure applies idle, potentially resetting visible state. Subscriptions log registration failure; the engine does not return an unsubscribe function for all lifetime listeners.

### Adjacent native plumbing

`player_get_insets` → CSS-pixel sides; `insets` event publishes sides; `player_set_system_bars {dark}`, `player_keep_awake {on}`, `player_haptic_tick`, `player_exit`, `player_take_launch` are OS adapters, not audio algorithms. `launch-intent` wakes pending-launch draining. Android plugin injects system Reduce Motion dataset/events and locks small phones portrait. iOS accommodations need independent implementation/verification.

Cast commands are separate: `cast_open`, `cast_load {url,contentType,title,artist,artworkUrl,positionMs,playing}`, `cast_play_pause {play}`, `cast_seek {positionMs}`, `cast_status`→`{connected,playing,positionMs}`, `cast_stop`; `cast-session` state started/ended/failed. `src/lib/cast.ts` loads current MP4-preferred stream, then pauses local; it does not mirror future queue items. Do not conflate these with local-player events or automatically replace Cast with AirPlay.

**Tests:** `src/lib/androidEngine.test.ts` (resume, rapid resolve, pause during resolve, metadata, native actions/focus, refresh cap); `androidPlayback.test.ts`; `KT/QueueBridgeTest.kt`, `QueueMirrorTest.kt`, `BridgeEdgeTest.kt`, `PlayerPayloadsTest.kt`, `StreamPolicyTest.kt`, `src/lib/cast.test.ts`. Native-device integration is still unverified.

## P3. Stale events, serialization and cancellation

### Existing protections

1. `stores/player.ts::load` increments generation and checks it plus current ID on rejected playback; late old failure must not mark new track paused. Prefetch completion checks generation.
2. `audio.ts::loadSeq` gates resolved source/loading/start and failure handling. `wantPlaying` prevents delayed starts after pause. Blend state object identity/up-next ID checks reject stale preparation.
3. `androidEngine.ts::playGeneration` increments per new play and `adoptNativeItem`; checks after local path/remote resolve and before `playerPlay`. `androidPause` clears wantsPlayback. This prevents an old **resolution** replacing a newer selection in the tested race, but there is still a native-await window after `playerSetQueue` begins.
4. `refreshUrl` checks ID before request and generation after resolve. It does not carry a native occurrence/replacement generation.
5. Desktop `NativeAudioDeck` increments generation on load/source removal; commands are serialized via promise queue; old queued commands return without acting, replaced loads throw AbortError. Events require matching deck, generation and loaded=true. Rust `desktop_playback_control` also checks current generation under a per-session operation lock.
6. Search/view loads use live/key checks; import matching stops starting new workers and suppresses view updates after cleanup. These are result-discard guards, not universally HTTP cancellation.

### Unresolved mobile holes (D03)

- No native snapshot/ended/error generation. `applySnapshot` does not compare ID to currentId. Same-ID A→B→A cannot be distinguished by ID alone. `player-ended` cannot be filtered by ID at all.
- `player-error` may toast currentTitle for an old source. `player-action` payload has no source identity, and like action reads current JS track rather than carrying native ID.
- Native `setUrl` changes first matching ID; repeated occurrences or a replaced same-ID URL can accept a stale refresh.
- `refreshUrl` only clears/pauses at its limit; it doesn't cancel outstanding resolver requests. Parallel refresh completions within one generation can arrive out of order.
- Android `awaitUrl` remembers resumeAfterUrl when it pauses. `setPlaying(false)` does not itself clear resumeAfterUrl; a late refreshed URL may ask to resume. TS wantsPlayback guard may counteract it only when JS receives snapshots. Reproduce before deciding a fix.
- Rust mpv event emitter tags events with the generation current **when read** (`playback.rs` event task), not intrinsically with the mpv source that generated them. The tagging/filtering is useful but not proof every buffered old mpv event is excluded.

### Required iOS proof / interface decision

Media + Platform + React must agree how active playback occurrence and load generation are represented at the native boundary **before claiming stale-event safety**. A protocol extension may be necessary; do not pretend it already exists in Android wire types or silently change them. Preserve current units/payload meaning; document compatibility and tests for any added identity.

Inject delayed resolve, native load completion, duration, position, error, focus and ended events for A after selecting B (also A→B→A); pause during URL refresh; queue mutation while next item prepares; rapid seek then replace. Neither old state nor old completion may corrupt current playback/queue, and cancellation must not be toasted as a new playback failure. Exact adapter cancellation behavior remains to be designed by its owner, not invented here.

## P4. Shared queue/business rules

Source: `src/stores/player.ts`, `src/lib/queue.ts`, `queueInsert.ts`, `smartShuffle.ts`, `autoplay.ts`, `playQueue.ts`. Retain these decisions rather than delegating semantic order to an OS queue's shuffle implementation.

- `playQueue([])` is a no-op. Start index clamps to available tracks. Existing `queued` flags are removed. With shuffle, selected track is first, remainder seeded-shuffled; unshuffled IDs remembered. Source label `playingFrom` preserved. New context resets autoplay count.
- `playTrack` reuses first matching occurrence at/after current index; otherwise inserts immediately after current (or at 0). It clears playingFrom and starts selection.
- `addToQueue` dedupes incoming IDs. Empty queue is populated but **does not auto-play**. Normally reject IDs already upcoming; with noDuplicateQueue reject any already anywhere. Play-next inserts immediately after current; ordinary append follows contiguous explicitly-user-queued block (`queuedEnd`), before original/recommended tail. Explicit insertion location is clamped to that range.
- `moveUpcoming` only acts when from/to are strictly after current and in range; moved item's `queued` marker reflects whether it lands in explicit block. `jumpTo` validates then starts row.
- Removing previous row decrements index; removing current selects next remaining or final remaining; when queue empty pauses/stops listening, clears loadedId and resets basic queue state. Removing current while **paused** updates queue/position but does not immediately load replacement. Don't silently “correct” this asymmetry without baseline comparison.
- `dontPlay` records blocked track then removes. `clearUpcoming` keeps history/current and removes rest. Shared played list is ID-deduped max **200**; autoplay compaction keeps **100** previous rows.
- `prev()` restarts at zero if shared position **>3s**, else `prevTrack()` wraps to final track at start. System media action `previous` uses `prevTrack` because Android ActionPlayer has already done >3s restart. Native standalone previous command differs (P2).
- Repeat cycle **off→all→one→off**. Natural ended with repeat-one seeks zero and plays again; manual next ignores repeat-one and follows next logic. At last row, nonmanual next without repeat-all stops/reset position unless autoplay eligible; manual behavior delegates `advance`, which has its own wrapping/shuffle rules. Preserve `queue.ts::advance` tests.
- Shuffle cycle is off→shuffle→smart shuffle→off. Unshuffle removes upcoming recommendations, restores remembered relative order then explicit queued items ahead of ordinary upcoming items. Smart suggestions use context guard and backoff; don't seed a new random order on every render/native snapshot.
- Autoplay enabled only with repeat off, eligible final source, and not episode. `autoplay.ts`: MAX_TAIL **25**, LOW_WATER **5**, retry hold **60s**, source duration/artist/recording exclusions. Shared refill guard/context prevents wrong-context append. Empty/refill failure uses `AutoPlay couldn't find more songs right now`; awaiting state can stop playing rather than invent suggestions. Radio failure leaves existing queue and toasts failure.
- Restore schema version **3**, queue/index/position/duration/volume/mute/shuffle/smartShuffle/repeat/unshuffled/source/autoplayCount persisted; playing/buffering are not restored as true. Position-only writes throttled **3000ms**, pending write flush on pagehide/hidden. `resumeFrom`: invalid position→0; within last **1s** of positive duration→0; otherwise ≥0. Hydration waits player and settings; restore-off clears queue and position.

Native Android `QueueMirror` is separate: max500, current -1 empty, clamped replace, append/insert truncate, remove/move preserve current index. The current engine does **not** mirror whole shared queue into it. Required iOS queue/background ownership agreement is P6, not a claim these two queues are synchronized today.

**Tests:** `src/stores/player.{queue,queued,moveUpcoming,jumpTo,restore,throttle,autoplay,smartShuffle}.test.ts`, `src/lib/{queue,queueInsert,smartShuffle,autoplay,playQueue}.test.ts`, `KT/QueueMirrorTest.kt`, `QueueBridgeTest.kt`.

## P5. Source selection, bytes, retries and failures

### Resolution and quality (shared)

`src/lib/resolveStream.ts::resolveStream/pickAudio/resolveUncached`, `streamingQuality.ts`, `firstSuccess.ts`, `ytFetch.ts`:

- Quality selection: low **48kbps**, medium **128**, high **256**, lossless **uncapped**. Data saver forces48. Cellular picks mobile setting; Wi-Fi/unknown picks Wi-Fi setting. Current `networkType.ts` hardcodes non-Android to Wi-Fi (not valid iOS implementation).
- Format ladder **141 > 251 > 140 > 250 > 249 > 139**, then bitrate. Prefer audio-only, non-DRC/original if any; adaptive then progressive audio-only; top-level URL fallback when no audio candidates. Ceiling uses **10% headroom** but retains all candidates when none fit. mp4Only narrows only if MP4 exists. Thus neither “lossless” nor mp4Only is a codec guarantee.
- Refresh pins cached **itag + content length** where available; pin filtering overrides normal quality/container selection. Reject a different known content length. LUFS from track absolute loudness, else loudness_db−14.
- Clients in initial order VISIONOS, IOS, ANDROID_VR, WEB, YTMUSIC, ANDROID, TV; `firstSuccess` staggers starts **600ms**, cancels loser probe signals on winner. Successful client preferred next. Refresh marks stale client bad for **10min**, removes verified status, excludes it for current resolve. Two rounds; second resets session/PO token; then Piped mirrors in fixed source order. If Piped also fails, rethrow last client error.
- Probe GET sends browser UA + `Range: bytes=0-4095`, **6s** timeout, accept200/206 with a nonempty first chunk then cancel body. Piped fetch timeout **12s** per mirror, prefers MP4/AAC then highest bitrate, verifies selected URL. Underlying client-info calls are not fully canceled merely because a probe signal was aborted.
- Cache key `{id,maxKbps,mp4Only}`, max **50**, TTL default10min or URL expiry−5min, clamped0..6h. Nonrefresh shares in-flight promise; refresh bypasses cache/shared request but can overlap an earlier request. Known verified client may return before asynchronous background probe; failure evicts same URL. No per-user cancel exposed by resolveStream.
- Optional add-on substitution only when quality uncapped and providers enabled: ordered sources, total6s budget, normalized title equality, artist identity/word containment and duration tolerance≤3s when both known; accepts only lossless formats. Fail/timeout logs and falls back. Refresh path in `androidEngine.refreshUrl` does not retry the initial add-on lookup. JioSaavn has its own prefixed resolver/rendition probe.
- YouTube fetch wrapper uses Tauri HTTP and sets `Origin` for hosts ending youtube.com. Unsafe header permission/config and ability to set UA/Origin must be verified on iOS; WebView fetch is not an interchangeable substitute.

### Desktop/browser source precedence and retry

`audio.ts::sourceFor`: local ID → local registered source; network ID → network protocol; otherwise downloaded file if path exists → stream. Stream path registers HTTPS URL in Rust and plays app loopback. `localPlaybackSource` resolves only registered ID, checks approved path, registers file then returns URL/MIME. Desktop mpv validates loopback app port/path/no embedded credentials for stream URL, or accepts approved absolute local path/resolved local/network ID.

`audio.ts::onFailure`: preserve current position if >1s else pendingSeek; first failure reloads fresh URL and restarts; second failure inside **30 playback seconds** stops/pauses and generic title toast. It is not a universal one-retry-per-30-wall-clock-seconds limit. After >30 seconds of playhead advance, retry can occur again. Explicit resume resets retry state. Watchdog **8s** unchanged playhead, only while wanted/current generation; progress/playing/pause disarm. AbortError ignored. Resume after URL expiry−2min margin or pause >10min refreshes at preserved position; local/network/download sources have no stream-expiry marker and are not refreshed this way.

### Android active flow and native failure policy

`androidPlayStream`: convert seconds to finite nonnegative rounded ms; local resolves actual track path→contentUri/null expiry; otherwise optional add-on or normal resolver→singleton native queue. It does not use desktop downloaded/network source precedence (D04). A pause during resolve still permits queue replacement/preparation, but not final play when guard remains valid.

`androidEngine.refreshUrl`: current ID only; max **3 requests in rolling60s**; fourth pauses, dispatches pause, shows generic `Couldn't play "<title>"`. New track/adoption or playing snapshot clears counters. Failure logs/toasts; no guaranteed retry timer. It does not enforce native per-occurrence refresh serialization.

`K/StreamPolicy.kt`, `PlayerService.onStreamError`:

| Failure | Native response |
|---|---|
| no playback URI (null) | `player-stream-needed` reason missing; pause/store resume intent; timeout15s |
| expired by epoch clock | stream-needed expired; no missing-URL timeout scheduled for this reason |
| bad HTTP status403 | stream-needed http_403; no missing-URL timeout for this reason |
| HTTP500–599 or network connection/timeout | prepare retry after **1s,2s,4s**; then failCurrent recoverable=true |
| content URI file-not-found | pause, error code file_missing/recoverable=false |
| other content error or fatal decode/HTTP error | pause, error/recoverable=false |

Retry resets at native READY and item transitions. Missing-URL timeout emits url_missing, and only if native hasNext does it advance with reason error/resume remembered intent. Since active TS sends one native item, that does not establish skipping to the shared next row. ClearUrlWait on queue replacement cancels timeout/retry; failed playback is not automatically skipped by TS player-error consumer.

### Rust byte/rendition contract

`src-tauri/src/stream.rs`:

- Bind **127.0.0.1:0**, idempotent start with ephemeral port; registry accepts nonempty ID and HTTPS URL. Active Registry ignores refresh/maxKbps; generic Upstream403-refresh tests are broader than active resolver (D14).
- Host gate permits loopback authorities, Origin gate app origins, literal null and loopback dev origins; missing Host/Origin accepted by current gate. Foreign present origin/nonloopback present host refused403. Do not weaken gating or assume arbitrary remote resources are trusted.
- GET/HEAD/local ranges: registered canonical local files only, local ID exactly16 hex suffix; unregistered local ID404. Byte ranges support one range, suffix/open-ended; invalid range416; MIME/content-length/content-range/accept-ranges retained, no-store/CORS.
- Upstream UA browser string; connect/read20s; GET forwards Range; upstream403 attempts one re-resolve/re-fetch. Remaining403→404, unresolvable→502. Identity `(itag,total length)` kept by request URI; nonzero range for changed identity→**409**, not spliced byte ranges of different renditions. New bytes=0 request may establish new identity. Maps capped500.
- iOS native requests must preserve headers/range/rendition invariants and demonstrate actual AAC/MP4, Opus/WebM, FLAC/add-on and local format capabilities before supported controls are claimed. Format lists in source are not AVFoundation compatibility evidence.

**Tests:** `resolveStream.test.ts`, `firstSuccess.test.ts`, `streamingQuality.test.ts`, `audio.playback.test.ts`, `androidEngine.test.ts`, `KT/StreamPolicyTest.kt`, Rust `stream.rs` tests including `range_for_a_different_rendition_is_refused_with_409`, `registered_local_audio_serves_full_and_range_requests`, host/origin tests; `playback.rs::accepts_only_the_local_stream_proxy`.

## P6. Background, native/shared ownership and route/focus

**Observed Android ownership:** `PlayerService` MediaLibraryService + ExoPlayer + MediaLibrarySession owns decoding/current-item position and native lifetime; native network wake mode, focus handling, noisy-output pause, audio-device callback and metadata/art/session buttons. Min/max buffers15/30s, no back buffer; state ticker1s only while actual isPlaying. Native artwork max512px,15s timeouts. OnDestroy releases player/session/EQ/callbacks and publishes stopped widget state.

`ActionPlayer` native system next/previous emit actions instead of directly advancing, allowing JS store queue rules; previous >3000ms restarts directly. Media button single/double gesture handled native; JS mediaSession fallback separately delays play/pause tap500ms and multi→next; do not install competing handlers on iOS. Standard seek-back/forward step10s. Removing wired/Bluetooth/USB/HDMI sink pauses and emits route; becoming noisy also pauses. Android focus event updates TS wantsPlayback, preventing unintended restarts in current tests; actual platform focus resume behavior remains Media3 responsibility.

**Not owned natively end-to-end today:** shared whole queue, repeat/shuffle/smart shuffle, recommendation refill, listening-progress generation, shared sleep timer and JS persistence flush. Native queue capability is not wired; media next/previous and refresh callbacks require live JS; event sink drops when unavailable. Neither Kotlin service nor Rust code proves these survive a suspended WebView. `player-track-changed` lacks a shared-store consumer.

**Required agreement for iOS:** keep shared queue decisions/formats authoritative, while native state/commands must permit necessary current-item and queued advancement, sleep, interruption/route handling and accounting without JS timers. Native mirror policy, reconciliation after foreground/restart, unresolved remote URLs when JS unavailable, failure ordering, repeat/shuffle occurrence identity and persistence must be explicitly approved by Media/React/Platform/Lead. This is a readiness gap, not permission to duplicate algorithms independently in Swift.

**Required physical proofs:** controlled audio continues through lock/app switch; current metadata/progress resumes accurately; next/previous/repeat with JS suspended; transient/permanent interruption and headset/Bluetooth disconnect; no unsolicited resume after explicit pause; foreground snapshot does not replace newer selection; process termination/relaunch is separately tested and not equated with backgrounding. Simulator success does not close these rows.

## P7. Advanced audio contracts and platform disagreement

- **Crossfade/Automix:** `audio.ts` two decks, fade settings0..12 whole seconds, smart fallback6s; Reduce Animation disables blending. Arm within fade+4s, remaining>250ms; fade≥500ms. Skip too-short songs/failure and same ID. Equal-power cosine/sine volumes at25ms ticks. Edges use head/tail analysis when skipSilence or smartFade. Incoming position accounts for late wake and speed; complete switches deck then shared history/listening via finishBlend. Pause freezes, seek/change context/changed up-next aborts, failure preserves outgoing. Copy mentions aligning beats; no matching beat/tempo algorithm was found. Android settings hide crossfade/Automix, and Android engine bypasses deck pipeline.
- **Silence:** shared headTrimTarget/tailReached use analysis; tail polling500ms. Analysis through `track_analysis`/Symphonia, bounded duration10..1200s, analysis cache100. Android native continuous skipSilence exists but has no TS setter call. Leading/trailing trim vs Media3 continuous skipping are not interchangeable undocumented behaviors.
- **Leveling:** `loudness.ts` targets quiet−19/normal−14/loud−11 LUFS, fallback−9; gain bounded0.05..1 (no boost), off unity,2s glide when learned during playback. Stream loudness if available, else analysis. Shared Android `setVolume` forwards directly and does not apply shared leveling pipeline; setting efficacy unresolved.
- **EQ/headroom:** shared ten bands32/64/125/250/500/1k/2k/4k/8k/16kHz; browser filters Q1.41, shelf endpoints, response-peak sampling and headroom only at current boosted effective level, limiter−0.5dB/20:1. Native desktop applies mpv EQ. Android nearest log-frequency device band averaging, maximum positive device gain headroom; no TS autoHeadroom argument reaches Android. Hardware unavailable yields appliedBands0. Measure/output-capability proposal required for iOS DSP; AVPlayer basic loading is insufficient.
- **Sleep:** shared minutes clamp1..720, absolute Date.now deadline or end-of-song;250ms JS tick, linear final10s fade, pause/set playing false at deadline then restore volume after500ms. End-of-song takes priority over repeat-one and cancels timer in handleEnded. Timer not persisted. Native Android sleep has deadline-only active ticker,250ms, writes absolute player.volume during fade (not multiplied by base/EQ), pause then500ms restore; endOfSong uses pause-at-end, not the shared JS countdown fade. No TS native setter/consumer connected. Preserve discrepancy, don't claim background timer works merely because native class exists.

**Tests:** `src/lib/audio.playback.test.ts`, `audio.test.ts`, `loudness.test.ts`, `eq*.test.ts`, `src/stores/settings.eq.test.ts`, `sleepTimer.test.ts` in lib/stores, `PlayerBar.sleep.test.tsx`, Rust `analysis/tests.rs`, `KT/EqualizerMappingTest.kt`, `SleepTimerTest.kt`.

## P8. Smallest controlled-audio proving case

This is a **proposed acceptance fixture/procedure**, not an existing bundled test track or implementation.

1. Create/obtain a rights-controlled deterministic **45-second PCM WAV**, audible at conservative level with a known timestamp marker; record SHA256, format, duration and expected marker times in QA evidence. Longer than30s avoids default local nonmusic-duration filter; WAV avoids depending on external catalogue/probes/keys. No bundled fixture was found in this survey. `src/lib/devSong.ts` points to a public YouTube video and is **not controlled audio**.
2. Use actual Local Music → folder/file selection into an approved iOS-accessible location; retain existing library metadata/ID and invoke normal row → `usePlayer.playQueue` → `audio.playStream` → mobile bridge. Do not call an unrelated demo native player directly or fabricate catalogue metadata to pass a screen test. Initial adapter may use a sandbox copy if that policy is explicitly documented; the ID/path decision is Services-owned.
3. One item is the minimal proof: play, audible output, correct duration, position advances in seconds, pause does not drift, seek10s (native10000ms), resume, natural completion once, same UI/native source ID. Pause while source load is delayed must not auto-start.
4. Expand to a **second distinct controlled file** to satisfy advance/background gate: normal next/previous, queue reorder/remove, repeat off/all/one, A→B late events, lock and app switch past natural transition; system controls and route/interruption tests. Need native/shared ownership decision P6 before claiming this works without JS.
5. Then use controlled HTTPS range-served audio for UA/header/range/403/expiry/network failure injection. Only afterward connect existing YouTube/JioSaavn/add-on pipeline and codec matrix. Separate decoder/host failures from upstream service availability.

Owners: Media accountable; Services for authorized file source; Platform for host/plugin; React for reused UI; QA for hashes/traces/audio/device evidence. Minimal proof is not full source resolution or full feature parity.

## S1. Persistence and secrets

### JSON state

`src/lib/persist.ts::persistStorage` calls `persist_read/write {name,owner}` with default **guest**. removeItem writes JSON null, not filesystem delete. Rust `persist.rs` stores `<app root>/data/<sanitized owner>/<sanitized name>.json`; only ASCII alphanumeric/_/- retained, empty→guest/store. Missing/unreadable/malformed JSON reads null/None; this is not a recovery of missing user data. Writes max16MiB, temporary sibling→rename, backoffs40/80/120/160ms then copy fallback; clean temp afterward. Copy fallback is not full atomicity/durability under power loss; no transaction across stores is established.

App root `HUSHIO_DATA_DIR` override, else Linux data_dir/hushio, other targets app_data_dir. `.hushio-install` marker distinct from stores. Schemas/migrations: settingsv5, libraryv7, playerv3, stats/journalv1. JS wrapper does not switch owner to Google subject on sign-in. Retain this instead of inventing per-account partitions.

Settings device-only list: downloadDir, localMusicFolder, audioSinkId, lyricsOffset, closeToTray, libraryLayout, sidebarLayout, imageCacheMb. `syncableSettings` removes these and add-on sources; manual backup has separate policy (S6). Shared library deletionSync metadata is active; Rust dormant merge modules are not evidence of active cloud merging.

### Secure storage boundary

`google_auth.rs::SecretStore/KeyringSlot`, `secrets.rs::Vault/KeyStore` expose read/write/clear with errors, not bool-success stubs. Desktop uses keyring service `com.hushio.app`; non-desktop calls `android::secret_*`, which errors off Android. iOS Keychain adapter and target access policy are **not present**.

Android `K/SecretVault.kt`: noBackupFilesDir/secrets.bin, per-record AES-256/GCM,12-byte IV +128-bit tag, AndroidKeyStore alias hushio-secrets, no user-auth requirement; synchronized access, temp/rename file update. `SecretRecords/SecurePlugin` parse/bridge errors must remain errors. Not a portable ciphertext format for iOS.

Credential slots include google-refresh-token, spotify-refresh-token, TV slot from `yt_innertube_auth::TV_TOKEN_SLOT`, lastfm-session, listenbrainz-token, `network-share:{serverId}`. Do not expose their values through account summaries/logs/backup.

**Feature policy differs:** Google OAuth production permits memory-only fallback only on Linux; other targets reject sign-in if persistent secret storage fails. In contrast `secrets.rs::keep_secret` returns plaintext fallback for network/scrobble JSON when vault refuses write; resolve_secret reads vault then fallback, migration removes plaintext only after successful write. Tests explicitly cover refusing store retaining password. Do not promise universal encryption or silently adopt plaintext on iOS: Services/Lead must choose/document an adaptation without pretending baseline had a stricter policy.

**Tests:** TS `persist.test.ts`, `storageGuard.test.ts`, `stores/settings.test.ts`, `library.test.ts`; Rust `persist.rs` inline (corruption/traversal/size/owners), auth keyring failure tests; `network.rs::a_refusing_key_store_keeps_the_password_in_the_file`, `KT/SecretRecordsTest.kt`.

## S2. Download jobs, files and cancellation

Source: `src/lib/downloads.ts`, `stores/library.ts::DownloadItem`; `R/downloads.rs`, `downloads/tags.rs`, `R/lib.rs::download_start/download_cancel/download_delete_file`; `K/MediaStorePlugin.kt`.

- UI record keyed by trackID, statuses waiting/queued/downloading/done/failed; progress0..1, downloaded/total **bytes**, done path filesystem or content URI. Native events `download:event {type,id,downloaded?,total?,path?,reason?}` types queued/start/progress/done/failed/expired/cancelled. Ignore events for records no longer present. Native queued is emitted on acceptance; done only after finish/publication.
- startDownload rejects duplicate pending, informs already-done; queue sets record before URL resolution. Wi-Fi-only waits only when network classification **cellular**, not unknown/offline. Waiting cancel removes record without native job. Release on settings/network changes starts waiting jobs.
- Quality standard128/high192/lossless uncapped, always fresh resolver/mp4Only true (not guaranteed). Native command requires HTTPS and approved target dir/export path; validate native ID and absolute path. Android ignores explicit dir for actual transfer location and uses app cache before publication.
- Two native transfer slots; cancel token usable waiting for slot, network request/chunk, retry delay and cover;4 transfer attempts, stall20s per request/chunk, linear1.5s×attempt delay. Native byte events throttled250ms, TS applies latest per ID every500ms; discard buffered progress on terminal event.
- Partials: first nonresume starts0, later attempts use part length. Range bytes=from-; append only response206 and from>0, otherwise truncate/restart. Early body end when known size fails/retries.403/410→expired, URL expiring within5min after slot acquisition→expired. Preserve partial only for expired outcome; otherwise cleanup. On resumed request expiry becomes failed; user-facing expired message fixed.
- TS allows **one expired-link re-resolution** per job. Resume partial only if previous itag defined and new itag/clen equal previous; otherwise start fresh. Second expired event→failed/toast. No global automatic success or unbounded retry.
- Finish: detect WebM→webm without normal tags; otherwise M4A tags/title/artist/optional album/cover (cover15s/max5MiB), tag-write failure logged but download can finish. Sanitized stem≤120 chars, unique destination; filesystem rename or Android publish→content URI. Android publication requires Android10+, input cache file/valid display name/audio MIME, creates pending Music/Hushio MediaStore row then copies/unsets pending; failure removes row.
- cancel API returns whether job exists; native cancel completion emits cancelled except app quitting; abandon cancels/removes partials and suppresses cancelled event on exit. TS cancel waits for bridge then removes record. **Race gap:** no generation guard around frontend URL resolution before enqueue; cancel while resolving can return false yet resolution later submits. ID-keyed terminal events also cannot distinguish a new same-ID job. Reproduce and coordinate rather than asserting cancellation is complete.
- Relaunch reconciliation queries native queue; persisted queued/downloading not native-active→failed; waiting left intact. This is not persistent native background download resumption. iOS background URLSession/task policy unverified; Rust async task is not an OS background entitlement.
- remove-from-list and delete-file differ. `removeDownload` invokes `download_delete_file`, swallowing error, then removes record. Baseline Rust only actually deletes content:// via Android; filesystem branch returns Ok without removal. Direct row remove-from-list can intentionally leave file. Don't claim disk deletion from record disappearance (D09).
- Auto-liked download only valid11-char YouTube IDs and setting on. Playlist-added auto download only if existing downloadable members nonempty and all already done. Bulk filters duplicate/local IDs, confirms **>25**, roughly0.04GB/song copy. `isDownloadable` only excludes local:, broader than actual resolver support for net:/addon:.

**Required tests:** start/queue/cancel during resolution, slot wait, transfer, retry, tagging and publication; duplicate same-ID new job, expiry rendition mismatch, ignored Range, lost network, sandbox exhaustion, offline reopen, intentional list removal vs disk delete. Existing `src/lib/downloads.test.ts`, `stores/library.downloads.test.ts`, `views/DownloadsView.test.tsx`, `R/downloads/tests.rs`, tags tests and `KT/MediaStoreRowsTest.kt` are starting evidence only.

## S3. Auth, browser handoff, cancellation and credentials

### Google

`R/google_auth.rs::GoogleAuth/OAuthConfig/Browser`, `src/stores/auth.ts`, bridge/google-auth-changed:

- Build-time `HUSHIO_GOOGLE_CLIENT_ID`, optional `HUSHIO_GOOGLE_CLIENT_SECRET`; empty clientID→configured false and sign-in error before browser. Scopes **openid email profile youtube**, explicitly no Drive. Full YouTube scope must be granted. No new auth model inferred from legacy Drive files.
- PKCE64 unreserved-character verifier, S256 challenge;32 random-byte base64url state. Access offline, prompt select_account consent. One pending flow only,5min deadline, HTTP30s. Browser-open failure distinct from network/expired grant/missing refresh/denied scope errors.
- Desktop binds ephemeral127.0.0.1 callback `/callback`; ignores wrong paths/state mismatch and keeps waiting; GET/request buffer8192; code nonempty≤512 bytes, provider error description≤300 chars. Android reversed clientID scheme + `:/oauth2redirect`; custom tab only HTTPS; Android manifest/auth redirect validation supplies routing. Rust app-redirect reader validates state but does not itself validate every URI scheme/path; native route layer matters.
- Token exchange then userinfo/id_token payload identity fallback; refresh token mandatory; stored session includes identity/refresh, access token in memory. JWT payload parsing here is not a general JWT signature verification routine; don't reuse it as arbitrary trust validation.
- cancel token select covers **redirect waiting phase**, not every subsequent exchange/userinfo/persist await. Once callback received, late cancel/sign-out race needs tests; do not promise universal network cancellation (D10).
- Access refresh leeway60s; resume retry on transient failures preserves session, loop retries after30s; rejected grant forgets local session. Token rotation persists. Sign-out cancels pending wait, attempts revoke if token present and forgets locally even on revoke failure. Account change event and sync resume emitted by `lib.rs` after successful sign-in; UI account summaries contain no token.
- iOS browser session/registered redirect/client type and Keychain need a real adapter; falling back to desktop loopback because platform !=android is not verified mobile auth.

### Spotify

`R/spotify_auth.rs::SpotifyAuth`, `src/lib/spotifyLibrary.ts`:

- Build-time clientID; PKCE/read scopes `playlist-read-private playlist-read-collaborative user-library-read`; no playback scope/Spotify audio engine. Android redirect `hushio-spotify:/callback`, other current path loopback;5min sign-in,30s HTTP. Read profile/name and persistent refresh session; refresh/reject behavior in auth source. No dedicated frontend Spotify cancel command was found; don't invent one as existing behavior.
- Library reads authorized Spotify playlists/liked songs, paginates and converts to import targets for matching; status unavailable/private/rate-limited/API changed errors remain explicit. Public Spotify/Apple import readers can work without this connection.

### Other account paths

YouTube TV/device code has separate token/verification/poll/cancel/disconnect flow (`yt_innertube_auth.rs`, `YouTubeMusicPrompt`, S9). Last.fm browser token→approval→finish; ListenBrainz user token validate/connect; optional Last.fm API constants and Discord clientID unconfigured states must remain real. Never commit client secrets/user tokens or fake configured=true to make onboarding pass.

**Tests:** extensive inline Rust Google tests (PKCE/state/forged callback/cancel/scope/missing refresh/keyring failure/refresh rotation/revoke/network); inline Spotify and TV tests; `src/stores/auth.test.ts`, `components/GoogleAccountCard.test.tsx`, Onboarding/session tests, `lib/spotifyLibrary.test.ts`, `KT/RedirectUriTest.kt`.

## S4. User files, sandbox authorization and local library

- `R/reveal.rs::Folders` approves app root/default/export/picked/library roots. `resolve` rejects nonabsolute paths/`..`, canonicalizes existing ancestor and appends missing tail; broken symlink rejected, containment against canonical roots prevents ordinary symlink escape. Desktop picks remember approved dirs and asset scope; mobile `folder_pick` currently calls Android tree picker only. `content://.../tree/...` authorization is exact approved tree URI, not arbitrary URI-prefix trust.
- Android SAF picker retains read permission; cancel→`{uri:null}`, denied persist permission→permission_not_granted. `scan_tree` validates tree URI then background Thread; no scan-cancel command. Native sidecar LRC read bounded1MiB. Mobile watcher functions are no-ops; frontend startup rescan/event rescan coalescing is distinct from desktop notify watchers.
- Rust local library owner **local**, stores local-library/opened-files; max200 folders, max200 opened files; recurse depth8; default filter min30s plus source filename/path rules; playable extensions mp3/m4a/aac/flac/ogg/oga/opus/wav/webm; WMA/AIFF listed unplayable. These source lists aren't iOS codec certification.
- Lofty tags/art/fallback title/artist/album; tag strings bounded200, names80, art≤8MiB; art served from local-art via validated filename, custom localart protocol. Folder displayName is cosmetic, remove folder leaves files, missing status separate; opened-file forget is metadata removal.
- Library file input may supply native file paths or scoped document URLs; iOS sandbox/security-scoped access/bookmark persistence/copy policy unknown. Do not write Android content URIs to iOS and declare parity. Local ID lowercased path hash means copy/move identity and old references need an explicit migration decision (P1).
- Local registered loopback file serving/approved path checks are P5. iOS custom scheme/CSP/artwork URLs must be tested (`L/localLibrary.ts::artUrl/networkTrackUrl` differs Windows/Android vs other platforms). File existence is not retained permission after app relaunch.

**Required scenarios:** cancel/deny pick, revoke permission, external provider offline, rename/move/delete, unreadable/corrupt tags/art, Unicode/case paths, short-filter behavior, reopen and rescan; range-seek actual local bytes. Tests `localLibrary` store/lib/view, Rust `local_library/tests.rs`, `watch/tests.rs`, `tree_library.rs`, `reveal.rs`, `playlist_cover.rs`, `KT/AudioRulesTest.kt`, `MediaStoreRowsTest.kt`.

## S5. Network sources, add-ons and request security

`R/network.rs::Service`, `network/webdav.rs`, `network/smb.rs`, `src/stores/network.ts`:

- Kind webDav/smb, max20 definitions, nonempty trimmed display name, generated ID from hash(name+url+host) if missing. Public summary omits password, includes server URL/host/share/path/username. Definition JSONv1 under guest/network-servers; secret slot network-share:id; migrate plaintext only if vault write succeeds (S1).
- Network track identity net:server:path. Titles from filename `Artist - Title`, album empty; recognize source audio extensions. Listing returns audio file rows, filters directories from track list; do not assume a hierarchical file browser is implemented simply because internal Entry has is_dir.
- WebDAV Basic auth when credentials present; URL joining/XML parse rules preserved. **Listing sends POST** with Depth1 and DAV propfind XML, not actual PROPFIND; possible source defect D08. Client timeout30s listing and60s read; range read forwards bounds.
- SMB `smb` Rust client share_connect credentials, UNC host/share, path conversion,64KiB read chunks, list/read creates/closes client/resources per request. read collects requested range into Vec; no unbounded-stream guarantee or universal cancel exposed.
- netmusic custom protocol/loopback route serve network bytes and ranges; preserve404/416/errors/MIME/IDs. iOS local-network permission, TLS/cleartext/ATS settings, SMB dependency build/runtime and large reads remain unverified. Don't silently force public HTTPS for LAN servers or allow arbitrary credentials in JS URLs.

Add-ons (`src/lib/addons/registry.ts/client.ts/resolve.ts`): HTTPS manifest URLs, reject credentials/private-host patterns at registry layer, required search/stream resources, max10 providers and bounded manifest/schema strings. HTTP timeout6s, max response sizes manifest64KiB/search512KiB/stream16KiB; search cap200; stream URL≤2048 HTTPS without username/password; reject encrypted or nonempty HLS/DASH manifest mode and unsupported format. This is validation, not a complete DNS/rebinding/redirect security audit. Health test is search query only, not proof of playability. Sources see artist/title queries; source ranking/enabled flags and local settings preserved. Search all-settled allows partial success; every provider rejected→error. Direct `addon:` playback gap is P1/D04.

Global network path is Tauri plugin-http (including final broad HTTPS allow capability), Rust reqwest with rustls and custom loopback/media schemes. CSP/opener/capabilities in `src-tauri/tauri.conf.json`, `capabilities/default.json` govern different access layers; no claim that the explicit hostname list is the whole allowlist because it includes `https://*/*`. iOS adapters must preserve header/auth/TLS behavior, cancellation semantics actually supported, and honest offline errors; no fabricated catalogue/provider answers.

**Tests:** `src/stores/network.test.ts`, Rust network/webdav/smb tests; `src/lib/addons/*.test.ts`, `searchScope.test.ts`, `ytFetch.test.ts`, Rust stream gates. Real server/provider/iOS validation outstanding.

## S6. Import/export and backup format

- `ImportPage` uses browser file inputs accept csv/txt/m3u8/m3u/json, multiple file text reads; link/list→`importStage`, stage max10, source matching max5000 songs. Public Spotify playlist/album/track and short links; public Apple playlist/album; YouTube playlists/mixes and Takeout formats retain source IDs where available. These are metadata imports, not new source audio engines.
- `importMatch.ts`: normalized title bigram similarity≥0.85, exact version marks, artist overlap if both known, duration gap≤15s; score bonuses duration≤3s/≤8s, matching album, preferred/detected language with conflicting-language penalty. Never match videos. Query variants then cache success/miss by source Spotify ID or normalized title/artist/duration plus preferred language. Four workers; cleanup stops further jobs/results, doesn't cancel in-flight network.
- Playlist JSON `{format:"hushio-playlist",version:1,name,tracks}`, M3U8 `#EXTM3U/#PLAYLIST/#EXTINF` with rounded seconds/−1 unknown and YouTube Music links; both filter to actual YouTube IDs. Text song list includes all track labels. Do not manufacture public links for local/network/add-on IDs.
- Backup `importBackup.ts`: `{app:"hushio",version:1,exportedAt,settings?,library?:{state,version},player?:{state,version},listening?:{state,version},recentSearches?}`. library exportv7 includes liked/history/followedArtists/savedAlbums/pinnedSingles/playlists/folders/libraryOrder; excludes downloads and deletionSync. Player backup envelopev0 includes queue/index/volume/muted/shuffle/repeat/unshuffled/playingFrom/autoplayCount, **not position/duration/smartShuffle**. Restore player patch applies only validated queue/index/volume/muted/shuffle and any string repeat; exported fields are not all restored.
- Device settings keys excluded; add-on sources included in manual backup but imported disabled. Listening buckets exported through Rust; recent searches max50. No credentials or media bytes intentionally exported. However playlists may carry coverPath and tracks local IDs, which do not make files portable or sanitize all legacy references.
- Import picker≤64MiB; parser rejects invalid JSON/wrong app/noninteger-or-newer version/malformed section envelope. Restore patches accepted fields across multiple stores; not a transaction and not comprehensive per-field validation. Replay import async errors toast; reload after900ms. UI copy says replace library/history but absent/invalid fields are not globally zeroed. Browser cancel handling does not guarantee a resolved promise on every input-dialog cancel implementation.
- DOM `downloadBlob` object URL/anchor and clipboard/share/image generation need real iOS output adapters if WebView doesn't save; success toast in JS isn't proof user received a file.

**Tests:** `src/lib/import*.test.ts[x]`, `playlistFiles.test.ts`, `downloadText.test.ts`, `components/ImportPage.test.tsx`, `ImportMatched.test.tsx`, `src/lib/spotifyLibrary.test.ts`, Rust stats import tests. Required round trips include malformed/partial backup, cross-device local references, denied/cancelled picker, disabled imported providers and persistent real output files.

## S7. Listening, journal, scrobbling and rich presence

`src/lib/listening.ts` emits bridge `playback_event {type:start|resume|pause|progress|stop,track?,deltaMs?,history?}`. Wire track duration seconds; deltaMs wall-clock **milliseconds** (not seek delta, not playback-rate-scaled). Resume starts accrual, tick sends when≥5000ms, pause/stop accrue then clear playing/session; episodes accrue zero. pauseListeningHistory adds history:false rather than suppressing all events.

Rust `lib.rs::playback_event` fans same event to scrobble, Discord and stats. **Scrobble `apply` does not inspect history flag**; history pause is not a scrobble-disable switch. Stats handles history flag. Scrobble skips episode/unnamed tracks, min known duration30s, threshold min(duration/2,240s), unknown240s; one per current play after accumulated delta reaches threshold, now-playing on start/resume. Retryable failures queue cap500, batches50, retry loop300s; service enable/connection/config gate actual deliveries. Love/unlove from library toggle is separate from listening threshold. Vault fallback S1 applies. Last.fm unconfigured never represents connected success.

Stats/journal have separate source caps and play-count rules (`R/stats.rs`, `stats/tests.rs`): stats monthly bucketsv1, retention36months, tracks600/names400, summary50, journal600/60days. Journal entries `{track,at,heard}` keys `{at,id}`; not identical to library's ID-deduped max200 recently played. Replay period and image/chart calculations remain shared. seek doesn't add listened milliseconds. Wall clock under suspension and native-to-shared reconciliation are unresolved P6/D17; a burst of elapsed time on wake is not automatically correct proof of background accounting.

Discord native desktop IPC/clientID optional, separate availability state and enable flag; source-backed desktop integration candidate inapplicable on iOS, no placeholder connection. Replay image card generation1080×1920 with image timeout8s, copy via native clipboard image and save Blob; output must be verified.

**Tests:** `src/lib/listening.test.ts`, `stores/player.listening.test.ts`, `stores/historyPause.test.ts`, `lib/replay*.test.ts`, ReplayView/ReplayStories/ReplayShareSheet tests, `R/stats/tests.rs`, `R/scrobble/tests.rs`, Discord tests.

## S8. Lyrics providers, timing, override and cancellation

`src/lib/lyrics.ts::requestLyrics` caches promise by **track ID only** (not duration/provider selection), max20; miss/failure normalized null and retry-after30s, no text→evict cached request; memory trim clears. `useTrackLyrics` rejects stale display updates on cleanup. New provider selection does not inherently invalidate an existing ID cache; verify UI invalidation rather than assume it.

Rust `lyrics::Service`: explicit user override first, then local sidecar/embedded, then cache, then provider sweep. Cached word-synced result stays fresh; other cached outcomes600s, cap400. Start nonlazy provider jobs concurrently but inspect in fixed provider priority: BetterLyrics, Portato, PaxSenix, LRCLIB, KuGou, SimpMusic, LyricsPlus, Unison, YouTubeCaptions, Genius (lazy). Each awaited job has12s ceiling; not necessarily one global12s total. First fitting **synced lines** wins (not necessarily word-synced); keep first plain fallback, lazy Genius only if needed; abort remaining spawned jobs when winner found. Last line must be≤duration+15s, and for songs≥90s not end before30% of duration. Word/line/end times are **seconds**; source parsers handle provider-specific units.

Local LRC matched same stem ignoring case, max1MiB; embedded supported through Lofty/SYLT non-Android path; Android content sidecar via plugin. Custom search/pick/reset through Rust choice module persists overrides; result carries `custom`, `source`, `wordSynced`, synced/plain. Source-supplied translation/roman/bg/word/gap fields displayed where supported; no new translation API assumed. Device lyrics offset±3s rounded0.05 by store, UI settings slider step0.25; synced toggle/blur/roman/text-size/shared line-follow/seek rules preserved. UI should not display old lyrics after rapid track/seek replacement.

**Tests:** `src/lib/lyrics*.test.ts`, `romanize.test.ts`, `src/stores/lyricsNudge.test.ts`, `components/LyricsChoice.test.tsx`, `SyncedLyrics*.test.tsx`, phone lyrics tests and inline Rust lyrics/provider/choice/parser tests. Provider service availability and native locked-screen lyric timing unverified.

## S9. YouTube sync jobs and background retries

`src/lib/ytSync.ts`, `stores/sync.ts`, Rust `sync_queue.rs::Queue/Engine`, `yt_data_api.rs`, `yt_innertube_auth.rs`:

- Durable guest/sync-queue JSON stores jobs and local→YouTube links; kinds create/rename/add/remove/delete/like/unlike, job UUID/attempts/notBefore/createdAt/state. On load running→pending. Validate playlist/video/name presence; YouTube like validates video ID. Pending rename collapses to last; opposite add/remove and like/unlike cancel; source queue preserves job order/dependency on created/linked playlist.
- Native status event yt-sync-progress: state idle/running/paused_sign_in/error, done/total/playlistName/backend official|unofficial/quotaUsedToday/quotaLimit/failedJobs/lastError/lastSyncedAt/pulledPlaylists. yt-playlist-linked carries localPlaylistId/ytPlaylistId. Do not conflate pull count/linking with whole-library cloud backup; not all library fields sync.
- Engine serial run, stop/resume for erase, persistence between jobs; pace250ms; max5 attempts,1/2/4/8s delays. Network/auth/quota halt releases current job **without spending a normal retry attempt** as specified by error classification. Exhausted job marked failed while later job can continue; gone404 linked playlist handling drops its jobs/notes local remains.
- Official default; unlimited chooses unofficial; actual official quota error switches fallback without normal retry cost. Generic403 without quota reason is not a quota fallback. Unofficial requires TV token and risk/consent copy already in UI; absence pauses with connect message. Quota reset Pacific midnight through API quota code.
- `lib.rs::spawn_sync` schedules Android WorkManager retry on offline; `K/SyncScheduler/SyncWorker/SyncNative/SyncBackoff` executes Rust retry when Android app services available. Non-Android schedule_retry stub returns Ok with no scheduling. iOS cannot inherit WorkManager or infer background scheduling from this success.
- Sign-out stops authenticated sync but keeps local state. Remote import/link/unlink and pending mutations must retain IDs and cannot fake completion when credentials/network missing. TV code cancellation is distinct from stopping durable library jobs. Exact iOS background scheduling capability and reconciliation outstanding.

**Tests:** `src/lib/ytSync.test.ts`, `stores/sync.test.ts`, YouTubePlaylists/YouTubeMusicPrompt tests; Rust queue tests `queued_jobs_survive_a_restart_and_in_flight_jobs_come_back_pending`, `opposite_changes_cancel_and_renames_keep_the_last_name`, offline/backoff/quota/unlimited tests; `KT/SyncBackoffTest.kt`. Dormant Drive modules not registered; no Drive feature inferred.

## S10. Erase/disconnect and destructive side effects

`src/lib/disconnect.ts::runErase`, `stores/erase.ts::bridgeSteps/resetStoresAfterErase`, `components/EraseDialog.tsx`, `R/disconnect.rs`:

- Options distinguish account remote stage, computer/local stage and reset; delete linked YouTube playlists and delete downloads independently selected. Account stage: stopSync→optional deleteYoutubePlaylists→revokeTokens. A failure stops subsequent steps and returns stage/message; not success. Local stage: stop if needed→remove keyring except reset→wipeLocal. Reset executes stop→wipe then resumeSync, including failure outcome path. No general rollback transaction; partial remote deletion remains partial.
- Remote deletion enumerates only linked YouTube playlist IDs from persisted local library; already-gone404 counts deleted. Revoke Google then TV; remove-keyring Google/TV. Do not imply this removes every external account token (Spotify path needs separate audit).
- Native wipe validates selected download paths through Folders; erases stats/scrobble/Discord/network/crash services then removes supplied filesystem files and app-root contents **except install marker**. Missing download file ignored; other IO error stops. Raw Android content URI vs std::fs deletion is an unresolved platform mismatch; iOS scoped paths similarly need adapter policy.
- After successful UI flow reset shared stores, pause audio, reload auth, reset session; notify desktop PiP session erased. This is not atomic with pending writes/downloads/background jobs; lifecycle races need tests. API does not authorize wiping arbitrary Files paths or remote liked songs simply because “erase” was chosen.
- Phone baseline gap: App returns PhoneShell before mounting EraseDialog; PhoneShell/PhoneMenuSheet do not mount it. Settings opens erase store but no active dialog mount was found. Must reproduce/fix only through assigned React owner and explicit source-defect distinction, not report iOS erase verified from unit tests alone.

**Tests:** `src/lib/disconnect.test.ts`, `stores/erase.test.ts`, `components/EraseDialog.test.tsx`, Rust disconnect tests (downloads kept unless selected, reset local-only,404 remote semantics). Required: dialog reachable, cancel non-destructive, per-stage failure and retry/skip choices, no unintended remote deletion, approved files only, credentials correctly cleared, stale writes don't resurrect erased state.

## Handoff: unresolved gates

- Agree P3 identity and P6 background ownership before media adapter acceptance. Current source does not provide a complete suspension-safe native queue contract.
- Approve iOS file reference/ID policy, Keychain failure policy and OAuth redirects; verify target codecs and advanced DSP before enabling settings.
- Reproduce D04/D05/D08/D09/D10/D12/D17 baseline discrepancies; retain defects separately from port regressions. No source claim substitutes for runtime evidence.
- Complete frontend/Rust/Kotlin checks and physical-device tests. The only extraction test attempt timed out (atlas); no iOS row is implemented or verified by these documents.

## Resolution log — decisions that now bind this contract

This contract was extracted from the baseline **before** any iOS implementation. Where the
port has since resolved one of its open gates, the resolution lives in `DECISIONS.md` and is
listed here so nothing in this document is silently reinterpreted.

| Gate in this document | Resolution | Effect |
|---|---|---|
| §P3 "Required iOS proof / interface decision" (contracts C-1/C-2: agree how active playback occurrence and generation are represented before claiming stale-event safety) | **ADR-007 Decision 1 + 2** (`DECISIONS.md`) | No generation field. One additive optional field is authorised: `player-ended` may carry `{id}`; a missing `id` must be treated as unattributable. Staleness is filtered natively (iOS drops emissions from a replaced `AVPlayerItem`) and in the shared engine (`applySnapshot` / `player-ended` / `player-error` identity guards). |
| §P6 "Required agreement for iOS" (native/shared background ownership) | **ADR-007 Decision 3** | Native owns transport for the single installed item only (start/pause/seek/volume/speed/completion/interruption/route/sleep-deadline). Native never advances, re-orders, repeats, shuffles or rewrites the queue. Consequence: with the WebView suspended a finished track stays finished; iOS does not claim background-advance parity. |
| §P7 sleep timer | **ADR-007 Decision 3 + `ADVANCED_AUDIO.md`** | A native pause at the deadline is permitted because it cannot desynchronise the queue. EQ / crossfade / skip-silence / leveling remain unimplemented and keep rejecting with a real code. |
| §S3/§S1 OAuth + Keychain | `HUMAN_STEPS.md` H1/H2 | Flow and URL schemes are wired; client IDs and a signing identity are owner-supplied inputs, not code gaps. |

Anything not listed above is still an open question and must be treated as such.
