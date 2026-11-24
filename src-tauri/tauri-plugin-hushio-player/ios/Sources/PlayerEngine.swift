//
//  PlayerEngine.swift
//  Hushio iOS player plugin — AVFoundation playback engine
//
//  Baseline: 2122110f9b41436723f368d3e1fb4d8a2a4276c2
//  Contracts: docs/ios-port/BEHAVIOR_CONTRACTS.md P1/P2/P3/P5/P6,
//             docs/ios-port/SOURCE_ATLAS.md §3, docs/ios-port/MASTER_PLAN.md Phase C.
//
//  STATUS: SOURCE ONLY. This file has never been compiled, linked or run. The Xcode
//  license and the iOS Rust targets are user-blocked (docs/ios-port/BLOCKERS.md B001/
//  B002), so `tauri ios init`, `xcodebuild` and any Swift build were impossible. Every
//  Apple/Tauri API named here was taken from the documentation listed in
//  IOS_INTEGRATION.md §5; unverified assumptions are marked `UNVERIFIED:` in comments.
//
//  SCOPE
//  -----
//  One `AVPlayer`, one active item, the command surface of §1.1, the events of §1.3 and
//  the lock-screen/remote-control projection. It deliberately does NOT own queue
//  semantics: repeat/shuffle/autoplay/wrap/next-track decisions stay in the shared
//  TypeScript store (`src/stores/player.ts`), and native multi-item advancement is the
//  unresolved C-1/C-2 contract. The engine accepts a queue array (up to 500 items,
//  matching `QueueMirror` capacity) but only ever loads the *active index*.
//
//  UNITS
//  -----
//  Milliseconds (`Int64`) for the wire and for all engine state. The TS side owns the
//  seconds conversion (`androidPosition()/1000`, `Math.round(seconds * 1000)` on seek).
//  Seconds appear only where the MediaPlayer framework demands them (now-playing
//  duration/elapsed, `MPChangePlaybackPositionCommandEvent.positionTime`), each marked
//  inline with a `// SECONDS` comment.
//
//  THREADING
//  ---------
//  All public methods and all callbacks are main-thread confined. Notification and KVO
//  callbacks are funnelled through `onMain(_:)`. The plugin adapter must call these
//  methods from the main thread (Tauri marshals commands onto the main run loop).
//  UNVERIFIED: Swift 6 strict-concurrency checking has not been evaluated; the plugin
//  Swift package should build in Swift 5 language mode until that is measured.
//
//  STALE EVENTS (P3/D03)
//  ---------------------
//  Native snapshots are keyed only by the current item id, which cannot distinguish
//  A -> B -> A. The authoritative stale filter is the TypeScript
//  `androidEngine.ts::playGeneration` guard; this file must never pretend to provide
//  stronger identity than the wire contract carries. What the engine *can* do without
//  changing the wire shape is refuse to let a late AVFoundation callback from a replaced
//  `AVPlayerItem` touch current state: every observer checks `item === observedItem`.
//  It must never adopt a newer item on its own.
//

import AVFoundation
import Foundation
import MediaPlayer
import UniformTypeIdentifiers

/// Typed engine failures. `wireCode` is what the thin Swift plugin adapter should use
/// as the Tauri rejection code, chosen to stay inside the code space the Android layer
/// already produces where a semantic equivalent exists (`unknown_item`,
/// `player_not_ready`) and to be explicitly new (`not_implemented`, `not_supported`)
/// where Android has no equivalent.
///
/// The TS bridge only logs `player-error.code` (`src/lib/androidEngine.ts::report`,
/// `console.warn`) and never branches on the string, so new codes are safe to *log*;
/// new *rejections* still need the lead's acknowledgement because a rejected command
/// promise is observable to the caller (see IOS_INTEGRATION.md §4.2).
public enum PlayerEngineError: Error, Equatable, CustomStringConvertible {
    /// Mirrors Kotlin `invoke.reject("unknown_item")` for `player_set_url`/`player_set_like`.
    case unknownItem
    /// Command exists on the wire but has no iOS implementation (EQ today).
    case notImplemented(String)
    /// Command is Android-only and meaningless on iOS (`player_exit`).
    case inapplicable(String)
    case invalidArgument(String)
    /// Mirrors Kotlin `invoke.reject("player_not_ready")` (service/player never attached).
    case playerNotReady

    public var wireCode: String {
        switch self {
        case .unknownItem: return "unknown_item"
        case .notImplemented: return "not_implemented"
        case .inapplicable: return "not_supported"
        case .invalidArgument: return "invalid_argument"
        case .playerNotReady: return "player_not_ready"
        }
    }

    public var description: String {
        switch self {
        case .unknownItem: return "unknown_item"
        case .notImplemented(let detail), .inapplicable(let detail), .invalidArgument(let detail):
            return detail
        case .playerNotReady: return "player_not_ready"
        }
    }
}

/// Stream-needed reasons. Same strings as Kotlin `StreamPolicy.REASON_*`, carried
/// verbatim on `player-stream-needed {index,id,reason}`.
public enum PlayerStreamReason: String {
    case missing
    case expired
    case http403 = "http_403"
}

/// Route-change reasons as emitted on `player-route`. Android emits "becoming_noisy" and
/// "device_removed"; iOS has no "becoming noisy" concept, so only device removal is
/// produced here (documented gap, IOS_INTEGRATION.md §4.4).
public enum PlayerRouteReason: String {
    case deviceRemoved = "device_removed"
}

/// Remote/notification actions on `player-action`, matching the Android action strings.
public enum PlayerRemoteAction: String {
    case play
    case pause
    case next
    case previous
}

/// The playback engine. One instance per app process; the Rust plugin owns its lifetime
/// (IOS_INTEGRATION.md §2).
public final class PlayerEngine {

    // MARK: - Contract constants

    /// `QueueMirror` capacity; `replaceQueue` truncates to this count (P2).
    public static let queueCapacity = 500
    /// Kotlin `RESTART_AFTER_MS` for native "previous".
    public static let restartAfterMs: Int64 = 3_000
    /// `StreamPolicy.MISSING_URL_WAIT_MS`.
    public static let missingURLWaitMs: Int64 = 15_000
    /// `StreamPolicy.RetryPolicy.DELAYS_MS`.
    public static let retryDelaysMs: [Int64] = [1_000, 2_000, 4_000]
    /// `PlayerMath.MIN_SPEED` / `MAX_SPEED`.
    public static let minSpeed: Double = 0.5
    public static let maxSpeed: Double = 2.0
    /// Shared default volume (P1). The engine starts at 1.0 like the Android player and
    /// waits for `player_set_volume` from the store, which sends the shared value (0.8 by
    /// default). Recorded here so the constant is not re-invented by the adapter.
    public static let defaultVolume: Double = 0.8
    /// Android artwork ceiling/timeouts (`ARTWORK_MAX_DIMENSION_PX`, 15s).
    public static let artworkMaxDimension: CGFloat = 512
    public static let artworkTimeout: TimeInterval = 15
    /// Sleep timer cadence/fade window/restore delay, mirroring Kotlin `SLEEP_TICK_MS`,
    /// `SleepTimer.FADE_MS` and `VOLUME_RESTORE_MS` (P7).
    public static let sleepTickMs: Int = 250
    public static let sleepFadeMs: Int64 = 10_000
    public static let sleepVolumeRestoreMs: Int = 500

    // MARK: - Callbacks (the `player-*` event surface, BEHAVIOR_CONTRACTS §1.3)

    /// `player-state`: emitted on every change of playing/buffering/positionMs/
    /// durationMs/index/id and at most once per second while time advances. Always the
    /// *full* snapshot, never a delta.
    public var onSnapshot: ((PlayerSnapshot) -> Void)?
    /// `player-ended`: emitted on AVPlayerItemDidPlayToEndTime for the current item.
    /// Carries the ended item's id when it is attributable (ADR-007 Decision 1 — the one
    /// authorised additive field), or nil when it is not; the adapter then emits `{}`.
    public var onEnded: ((String?) -> Void)?
    /// `player-stream-needed`: `{index, id, reason}`.
    public var onStreamNeeded: ((String, PlayerStreamReason) -> Void)?
    /// `player-error`: `{index, id, code, message, recoverable}`. The index is implicit
    /// (current index) because the adapter reads it from `state()`.
    public var onError: ((_ id: String, _ code: String, _ message: String, _ recoverable: Bool) -> Void)?
    /// `player-action`: play/pause/next/previous driven by lock screen / headset /
    /// Control Center. The TS store owns the queue decision; native must not advance.
    public var onRemoteAction: ((PlayerRemoteAction) -> Void)?
    /// `player-route`: `{reason}`. Android already pauses before emitting; the engine
    /// does the same. No surveyed TS listener exists (P2), so this is informational.
    public var onRouteChange: ((PlayerRouteReason) -> Void)?

    // MARK: - Player + queue state

    private let player: AVPlayer
    private var queue: [PlayerQueueItem] = []
    /// -1 = no current item (Kotlin `QueueMirror.NONE`); never exposed as a wire index.
    private var currentIndex: Int = -1

    /// `playWhenReady` equivalent: the user's intent. Mutated by play/pause, by
    /// `awaitURL` (mirrors Kotlin `player.pause()` inside `awaitUrl`), and by
    /// interruption/route handling.
    private var playRequested = false
    /// Requested speed multiplier, kept separate because `AVPlayer.rate` drops to 0
    /// while paused/buffering and would otherwise lose the setting.
    private var desiredRate: Double = 1
    private var baseVolume: Double = 1
    /// Decoded duration in ms; 0 = unknown. `AVPlayerItem.duration` is not readable
    /// before `.readyToPlay`, so it is sampled on status changes and on the tick.
    private var knownDurationMs: Int64 = 0

    /// Per-playback-URI header memory, mirroring Kotlin `headersByUrl`. Two purposes:
    /// the resource loader reads headers for the active URI, and `setUrl` can drop the
    /// stale entry for the URI it replaces.
    private var headersByURL: [String: [String: String]] = [:]

    /// URL wait state, mirroring Kotlin `awaitingUrlId` / `resumeAfterUrl`.
    private var awaitingURLItemId: String?
    private var resumeAfterURL = false
    private var missingURLTimeout: DispatchWorkItem?
    /// Stream retry state, mirroring `StreamPolicy.RetryPolicy`.
    private var retryAttempt = 0
    private var retryWorkItem: DispatchWorkItem?

    private var lastEmitted: PlayerSnapshot?
    private var lastNowPlayingSignature: String?
    /// Remembers the user's intent across a transient audio interruption so the engine can
    /// resume natively (Android's Media3 focus handling does the equivalent).
    private var resumeAfterInterruption = false

    // MARK: - Sleep timer state (P7)

    /// Absolute epoch-millisecond deadline; `nil` = no deadline-mode sleep. Kept
    /// independent of `sleepEndOfSong` exactly like Kotlin `SleepTimer.endsAtMs`.
    private var sleepDeadlineEpochMs: Int64?
    /// Pause when the current item completes (no fade). Consumed on the ended callback.
    private var sleepEndOfSong = false
    /// The active 250 ms deadline ticker, self-rescheduling like the Kotlin runnable.
    private var sleepTickerWorkItem: DispatchWorkItem?
    /// The one-shot 500 ms volume restore scheduled after the deadline fires.
    private var sleepRestoreWorkItem: DispatchWorkItem?

    // MARK: - Observation state

    private var observedItem: AVPlayerItem?
    private var itemStatusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var timeObserverToken: Any?
    private var notificationTokens: [NSObjectProtocol] = []
    /// Retained for the lifetime of the current item: `AVAssetResourceLoader.delegate`
    /// is a weak reference, so losing this object silently breaks header replay.
    private var resourceLoaderDelegate: HushioResourceLoader?
    private var remoteCommandTargets: [(command: MPRemoteCommand, token: Any)] = []
    private var audioSessionConfigured = false

    // MARK: - Artwork state

    private let artworkSession: URLSession
    private var artworkCache: [String: MPMediaItemArtwork] = [:]
    private var artworkTasks: [String: URLSessionDataTask] = [:]
    private var artworkGeneration = 0

    // MARK: - Init / teardown

    public init(player: AVPlayer = AVPlayer()) {
        self.player = player
        self.player.actionAtItemEnd = .pause
        // Keep the default. Documented so nobody "fixes" it later: stalling waits are
        // what produce `timeControlStatus == .waitingToPlayAtSpecifiedRate`, which is
        // this engine's buffering signal.
        self.player.automaticallyWaitsToMinimizeStalling = true
        self.player.volume = Float(baseVolume)

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = PlayerEngine.artworkTimeout
        configuration.timeoutIntervalForResource = PlayerEngine.artworkTimeout
        self.artworkSession = URLSession(configuration: configuration)

        configureAudioSession()
        installAudioSessionObservers()
        installPlaybackObservers()
        installRemoteCommands()
    }

    deinit {
        if let timeObserverToken {
            player.removeTimeObserver(timeObserverToken)
        }
        artworkTasks.values.forEach { $0.cancel() }
        artworkSession.invalidateAndCancel()
    }

    /// Stops playback, removes every observer and gives the audio session back.
    /// `player_exit` is Android-only (it finishes the Activity); iOS equivalent is
    /// handled by the Rust/Tauri layer, not by this engine.
    public func invalidate() {
        cancelPendingWork()
        cancelSleepTicker()
        cancelSleepRestore()
        sleepDeadlineEpochMs = nil
        sleepEndOfSong = false
        playRequested = false
        player.pause()
        player.replaceCurrentItem(with: nil)
        cancelArtworkLoads()
        if let timeObserverToken {
            player.removeTimeObserver(timeObserverToken)
            self.timeObserverToken = nil
        }
        itemStatusObservation = nil
        timeControlObservation = nil
        notificationTokens.forEach { NotificationCenter.default.removeObserver($0) }
        notificationTokens.removeAll()
        remoteCommandTargets.forEach { $0.command.removeTarget($0.token) }
        remoteCommandTargets.removeAll()
        resourceLoaderDelegate = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        deactivateAudioSession()
        lastEmitted = nil
        queue.removeAll()
        currentIndex = -1
    }

    // MARK: - Audio session (BEHAVIOR_CONTRACTS P6 "Required agreement for iOS")

    /// Category `.playback` + mode `.moviePlayback`.
    ///
    /// `.playback` keeps audio alive with the Ring/Silent switch silenced and when the
    /// screen locks; continuing in the background additionally requires the `audio`
    /// value in `UIBackgroundModes` (see IOS_INTEGRATION.md §3).
    /// `.moviePlayback` is only legal with `.playback` and applies route-specific signal
    /// processing — used here because the Android service plays long-form audio in the
    /// same session shape.
    ///
    /// No category options are set: `.playback` alone is non-mixable, matching the
    /// Android behaviour of taking audio focus for music.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
            audioSessionConfigured = true
        } catch {
            audioSessionConfigured = false
            reportSessionFailure("setCategory(.playback, .moviePlayback)", error)
        }
    }

    /// Activation is lazy (first play / queue install) and then kept for the playback
    /// lifetime, mirroring the Android foreground service keeping its audio focus while
    /// the queue exists. Deactivating on every pause would churn the route and can make
    /// the lock-screen transport flicker.
    @discardableResult
    private func activateAudioSession() -> Bool {
        if !audioSessionConfigured {
            configureAudioSession()
        }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            return true
        } catch {
            reportSessionFailure("setActive(true)", error)
            return false
        }
    }

    /// Only for teardown. `.notifyOthersOnDeactivation` mirrors releasing audio focus so
    /// the previously interrupted app may resume (Apple documents this option as valid
    /// only on deactivation).
    private func deactivateAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setActive(
                false,
                options: [.notifyOthersOnDeactivation]
            )
        } catch {
            // Deactivation returns isBusy when audio objects are still running; this is
            // not fatal for teardown and Android has no equivalent diagnostic.
            reportSessionFailure("setActive(false)", error)
        }
    }

    private func reportSessionFailure(_ step: String, _ error: Error) {
        let id = currentQueueItem()?.id ?? ""
        onError?(id, "audio_session", "AVAudioSession \(step) failed: \(error.localizedDescription)", true)
    }

    // MARK: - Commands (BEHAVIOR_CONTRACTS §1.1 / P2)

    /// `player_set_queue {items, startIndex, startPositionMs}` -> accepted count.
    ///
    /// Mirrors Kotlin `replaceQueue`: cancels URL wait/retry, truncates at 500, clamps the
    /// index, replaces the item list, prepares at `startPositionMs` and then **pauses**
    /// (callers send `player_play` separately).
    ///
    /// C-1/C-2 (OPEN, documented blocker): only the active index is loaded into the
    /// `AVPlayer`. Items at other indices are retained for identity lookups
    /// (`setUrl`/`state`) but there is no native advancement between them. Active TS
    /// sends one item (`src/lib/androidEngine.ts::androidPlayStream` ->
    /// `playerSetQueue([item], 0, startPositionMs)`), so a singleton queue is the
    /// supported shape today. Multi-item queues must not be used to claim
    /// background advancement.
    @discardableResult
    public func setQueue(_ items: [PlayerQueueItem], startIndex: Int, startPositionMs: Int64) -> Int {
        cancelPendingWork()
        headersByURL.removeAll()
        queue = Array(items.prefix(PlayerEngine.queueCapacity))
        queue.forEach(rememberHeaders)

        if queue.isEmpty {
            currentIndex = -1
            observedItem = nil
            itemStatusObservation = nil
            player.replaceCurrentItem(with: nil)
            knownDurationMs = 0
            playRequested = false
            resumeAfterURL = false
            lastNowPlayingSignature = nil
            emitSnapshot(force: true)
            return 0
        }

        currentIndex = min(max(startIndex, 0), queue.count - 1)
        activateAudioSession()
        // Kotlin: player.prepare(); player.pause() — a queue install never starts audio.
        // Cleared before loading so `loadCurrentItem` cannot apply a stale rate.
        playRequested = false
        player.pause()
        loadCurrentItem(seekToMs: max(0, startPositionMs))
        emitSnapshot(force: true)
        return queue.count
    }

    /// `player_play`. Resolves even when nothing can start, exactly like Android
    /// ("resolve void" is command acceptance, not evidence audio started, P2).
    public func play() {
        guard let item = currentQueueItem() else {
            emitSnapshot()
            return
        }
        if let reason = unusableReason(for: item) {
            // Kotlin `ensureUsable()` pauses and asks TS for a stream instead of playing.
            awaitURL(item, reason: reason)
            return
        }
        activateAudioSession()
        // AVPlayer does not restart an item that already reached its end; Media3's
        // `play()` after STATE_ENDED replays from the default position. Without this the
        // user's play-after-ended would silently do nothing.
        // UNVERIFIED: the exact Media3 rewind semantics were not extracted; this is the
        // minimal behaviour that avoids a dead control.
        if knownDurationMs > 0, currentPositionMs() >= knownDurationMs {
            player.seek(
                to: CMTime(value: 0, timescale: 1000),
                toleranceBefore: .zero,
                toleranceAfter: .zero
            )
        }
        playRequested = true
        applyRate()
        emitSnapshot(force: true)
    }

    /// `player_pause`.
    public func pause() {
        playRequested = false
        player.pause()
        emitSnapshot(force: true)
    }

    /// `player_toggle` -> resulting `playing` intent.
    public func toggle() -> Bool {
        if playRequested {
            pause()
            onRemoteAction?(.pause)
        } else {
            play()
            onRemoteAction?(.play)
        }
        return playRequested
    }

    /// `player_seek {positionMs}`.
    ///
    /// Clamp mirrors `PlayerMath.clampSeek(position, duration)` =
    /// `coerceIn(0, max(0, duration))`. Baseline quirk preserved deliberately: when the
    /// native duration is unknown Media3 reports a negative C.TIME_UNSET, so the upper
    /// bound collapses to 0 and the seek lands at zero. Android's `seekTo` also emits
    /// state immediately.
    public func seek(_ positionMs: Int64) {
        let clamped = clampSeek(positionMs)
        player.seek(
            to: CMTime(value: clamped, timescale: 1000),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
        emitSnapshot(force: true)
    }

    /// `player_set_speed {speed}` — clamped 0.5...2.0, NaN -> 1 (PlayerMath.clampSpeed).
    /// Does not start playback when paused; mirrors Media3 where `playbackParameters`
    /// only affects a playing player.
    public func setSpeed(_ speed: Double) {
        desiredRate = clampSpeed(speed)
        if playRequested {
            applyRate()
        }
        emitSnapshot(force: true)
    }

    /// `player_set_volume {volume}` — clamped 0...1, NaN -> 1 (PlayerMath.clampVolume).
    /// Android additionally applies EQ headroom; there is no EQ here, so this is the
    /// plain player volume (documented gap, IOS_INTEGRATION.md §4.3).
    public func setVolume(_ volume: Double) {
        baseVolume = clampVolume(volume)
        player.volume = Float(baseVolume)
        emitSnapshot()
    }

    /// `player_set_eq` — MUST fail loudly.
    ///
    /// iOS has no 10-band equalizer on `AVPlayer`: there is no device/hardware EQ API
    /// comparable to Android's `android.media.audiofx.Equalizer`, and `AVPlayer` exposes
    /// only `volume`/`isMuted`. Faking `appliedBands > 0` would be a placeholder success
    /// response, which the port rules forbid. The proposal (AVAudioEngine +
    /// AVAudioUnitEQ, which means giving up AVPlayer for playback) is written up in
    /// IOS_INTEGRATION.md §4.3 and is not implemented.
    ///
    /// Note for the caller: `src/lib/androidEngine.ts::androidSetEq` already does
    /// `playerSetEq(...).catch(report("eq"))`, so a rejection is logged and swallowed
    /// today; no UI gate depends on `appliedBands`.
    public func setEq(enabled: Bool, gainsDb: [Double]) throws -> Int {
        throw PlayerEngineError.notImplemented(
            "player_set_eq: AVPlayer has no equalizer; AVAudioEngine + AVAudioUnitEQ proposal pending"
        )
    }

    // MARK: - Sleep timer (P7)

    /// `player_set_sleep_timer {endsAtEpochMs:number|null, endOfSong:boolean}`.
    ///
    /// Mirrors Kotlin `PlayerService.setSleepTimer` + `SleepTimer`:
    ///  * deadline mode — a 250 ms main-queue ticker fades `player.volume` linearly to 0
    ///    over the final 10 seconds, then pauses and restores the pre-fade volume after
    ///    500 ms;
    ///  * a deadline already in the past is an immediate pause (zero-length fade);
    ///  * `endOfSong` — pause when the current item completes, no fade, and no queue
    ///    advance (ADR-007 Decision 3: native owns transport only);
    ///  * `{nil, false}` cancels and restores any fade that was in progress.
    ///
    /// This is transport-only: it never emits queue/advance events. A non-finite deadline
    /// is rejected (`invalid_argument`) rather than silently clamped, because ±∞/NaN is
    /// not a meaningful transport deadline.
    public func setSleepTimer(endsAtEpochMs: Double?, endOfSong: Bool) throws {
        if let deadline = endsAtEpochMs {
            guard deadline.isFinite else {
                throw PlayerEngineError.invalidArgument(
                    "player_set_sleep_timer: endsAtEpochMs must be a finite epoch-millisecond number"
                )
            }
            sleepDeadlineEpochMs = Int64(deadline.rounded())
        } else {
            sleepDeadlineEpochMs = nil
        }
        sleepEndOfSong = endOfSong

        cancelSleepTicker()
        cancelSleepRestore()

        if sleepDeadlineEpochMs != nil {
            startSleepTicker()
        } else {
            // Cancel (`{nil, false}`) or end-of-song mode: any faded volume is restored.
            restoreSleepVolume()
        }
    }

    /// Linear fade target, exactly Kotlin `SleepTimer.volumeFor`:
    /// `min(1, max(0, remainingMs / FADE_MS))`.
    private static func sleepVolume(forRemainingMs remaining: Int64) -> Double {
        let fraction = Double(remaining) / Double(PlayerEngine.sleepFadeMs)
        return min(1, max(0, fraction))
    }

    private func startSleepTicker() {
        cancelSleepTicker()
        runSleepTick()
    }

    private func cancelSleepTicker() {
        sleepTickerWorkItem?.cancel()
        sleepTickerWorkItem = nil
    }

    /// One 250 ms step, mirroring the Kotlin `sleepTicker` runnable: evaluate against the
    /// deadline, then reschedule while a deadline is still active. The fade writes the
    /// absolute `player.volume`, exactly like Android (not multiplied by `baseVolume`).
    private func runSleepTick() {
        guard let deadline = sleepDeadlineEpochMs else { return }
        let remaining = deadline - PlayerEngine.nowMs()
        if remaining <= 0 {
            fireSleep()
            return
        }
        if remaining < PlayerEngine.sleepFadeMs {
            player.volume = Float(PlayerEngine.sleepVolume(forRemainingMs: remaining))
        }
        let work = DispatchWorkItem { [weak self] in
            self?.runSleepTick()
        }
        sleepTickerWorkItem = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(PlayerEngine.sleepTickMs),
            execute: work
        )
    }

    /// Deadline reached: pause (transport only) and restore the pre-fade volume after
    /// 500 ms. Pausing an already-paused player is a no-op, and the restore still runs so
    /// a fade that began while paused can never leave the volume desynchronised.
    private func fireSleep() {
        cancelSleepTicker()
        sleepDeadlineEpochMs = nil
        sleepEndOfSong = false
        playRequested = false
        player.pause()
        scheduleSleepRestore()
        emitSnapshot()
    }

    private func cancelSleepRestore() {
        sleepRestoreWorkItem?.cancel()
        sleepRestoreWorkItem = nil
    }

    private func scheduleSleepRestore() {
        cancelSleepRestore()
        let work = DispatchWorkItem { [weak self] in
            self?.restoreSleepVolume()
        }
        sleepRestoreWorkItem = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(PlayerEngine.sleepVolumeRestoreMs),
            execute: work
        )
    }

    /// Restores the player volume to the engine's current `baseVolume` (the pre-fade
    /// volume; there is no EQ headroom here, so this is exactly `player_set_volume`).
    private func restoreSleepVolume() {
        sleepRestoreWorkItem = nil
        player.volume = Float(baseVolume)
    }

    /// `player_set_url {id,url,headers,expiresAtEpochMs}` -> `false` = unknown_item.
    ///
    /// Mirrors Kotlin `setUrl`: locate the FIRST item with the id (duplicate ids are
    /// possible, P1), replace its URL/headers/expiry, drop the stale header entry, clear
    /// a matching URL wait, rebuild the item if it is current, and resume only when the
    /// engine itself paused for a URL (`resumeAfterURL`).
    ///
    /// Not preserved position: `src/lib/androidEngine.ts::refreshUrl` calls `playerSetUrl`
    /// without any seek, so a stream refresh is expected to continue from the current
    /// playhead. This engine therefore re-seeks to the pre-replacement position.
    /// UNVERIFIED: what Media3's `replaceMediaItem` does to the position of the current
    /// item is not documented in the baseline extraction; if Android restarts at 0 this
    /// is a behavioural difference to reconcile (IOS_INTEGRATION.md §4.5).
    @discardableResult
    public func setUrl(
        id: String,
        url: String,
        headers: [String: String],
        expiresAtEpochMs: Int64?
    ) -> Bool {
        guard let index = queue.firstIndex(where: { $0.id == id }) else {
            return false
        }
        let previous = queue[index]
        if let oldURI = previous.playbackURLString {
            headersByURL.removeValue(forKey: oldURI)
        }
        var updated = previous
        updated.url = url
        updated.headers = headers
        updated.expiresAtEpochMs = expiresAtEpochMs
        queue[index] = updated
        rememberHeaders(updated)

        let isCurrent = index == currentIndex
        if awaitingURLItemId == id {
            awaitingURLItemId = nil
            cancelMissingURLTimeout()
        }
        if isCurrent {
            activateAudioSession()
            loadCurrentItem(seekToMs: currentPositionMs())
            if resumeAfterURL {
                resumeAfterURL = false
                playRequested = true
            }
            if playRequested {
                applyRate()
            }
        }
        emitSnapshot(force: true)
        return true
    }

    /// `player_get_state` — current state without emitting.
    public func state() -> PlayerSnapshot {
        guard queue.indices.contains(currentIndex) else { return .idle }
        let item = queue[currentIndex]
        return PlayerSnapshot(
            playing: playRequested,
            buffering: isBuffering,
            positionMs: currentPositionMs(),
            durationMs: knownDurationMs,
            index: currentIndex,
            id: item.id,
            speed: desiredRate,
            // The engine has no native repeat/shuffle: the shared store owns those
            // decisions (P4) and native queue advancement is C-1/C-2. Reporting the
            // constant values keeps the snapshot honest instead of echoing a setting
            // that has no effect here.
            repeatMode: .off,
            shuffle: false
        )
    }

    /// `player_set_like`. Android reports `unknown_item` for an unknown id. Likes are a
    /// shared-library concern (`src/stores/library.ts`); this only updates the retained
    /// queue copy so a later snapshot/metadata refresh does not resurrect the old value.
    @discardableResult
    public func setLike(id: String, liked: Bool) -> Bool {
        guard let index = queue.firstIndex(where: { $0.id == id }) else {
            return false
        }
        queue[index].liked = liked
        if index == currentIndex {
            refreshNowPlaying(force: true)
        }
        return true
    }

    // MARK: - Internal playback control

    private func currentQueueItem() -> PlayerQueueItem? {
        guard queue.indices.contains(currentIndex) else { return nil }
        return queue[currentIndex]
    }

    private func rememberHeaders(_ item: PlayerQueueItem) {
        guard let uri = item.playbackURLString, !item.headers.isEmpty else { return }
        headersByURL[uri] = item.headers
    }

    /// Kotlin `ensureUsable()` reduced to a reason: a missing URI or an expired link
    /// means "ask TS for a fresh stream instead of playing".
    private func unusableReason(for item: PlayerQueueItem) -> PlayerStreamReason? {
        guard item.playbackURL != nil else { return .missing }
        if item.isExpired(nowMs: PlayerEngine.nowMs()) { return .expired }
        return nil
    }

    /// Rebuilds and installs the item at `currentIndex`.
    ///
    /// `seekToMs` is applied after installation; a zero value is not seeked at all so a
    /// fresh load keeps AVPlayer's default start (mirrors Media3's
    /// `setMediaItems(..., startPositionMs)` with 0).
    private func loadCurrentItem(seekToMs: Int64) {
        guard let item = currentQueueItem() else {
            observedItem = nil
            itemStatusObservation = nil
            player.replaceCurrentItem(with: nil)
            knownDurationMs = 0
            return
        }
        guard let url = item.playbackURL else {
            observedItem = nil
            itemStatusObservation = nil
            player.replaceCurrentItem(with: nil)
            knownDurationMs = 0
            awaitURL(item, reason: .missing)
            return
        }

        cancelRetry()
        resourceLoaderDelegate = nil

        // Precise duration parsing: Apple documents that `false` is sufficient for plain
        // playback because AVPlayer can seek approximately without full precision, and that
        // `true` costs loading time. Local files get precise timing (cheap, and VBR/FLAC
        // durations are what the UI shows); network streams keep the default so the first
        // buffer is not delayed by full-file parsing.
        let asset: AVURLAsset
        if url.isFileURL {
            // Local library items: the Services adapter must hand us a reachable file URL
            // (sandbox copy or resolved security-scoped bookmark).
            asset = AVURLAsset(
                url: url,
                options: [AVURLAssetPreferPreciseDurationAndTimingKey: true]
            )
        } else {
            let headers = item.headers
            if headers.isEmpty {
                asset = AVURLAsset(url: url)
            } else {
                // AVURLAsset cannot attach HTTP headers through public API. Replay them
                // through a resource loader instead (see HushioResourceLoader below).
                let loader = HushioResourceLoader(headers: headers)
                resourceLoaderDelegate = loader
                guard let streamingURL = HushioResourceLoader.streamingURL(for: url) else {
                    failCurrent(item, code: "invalid_url", message: "Cannot build streaming URL for \(url.absoluteString)", recoverable: false)
                    return
                }
                asset = AVURLAsset(url: streamingURL)
                // `nil` lets AVFoundation use its own serial queue for the delegate. The
                // loader's shared state is lock-guarded because URLSession delivers on a
                // different queue.
                asset.resourceLoader.setDelegate(loader, queue: nil)
            }
        }

        let playerItem = AVPlayerItem(asset: asset)
        // Android requests `PlaybackParameters(speed, 1f)`: pitch unchanged. `.spectral`
        // is the music-quality pitch-preserving algorithm; `.varispeed` would shift pitch.
        playerItem.audioTimePitchAlgorithm = .spectral

        observedItem = playerItem
        itemStatusObservation = playerItem.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            self?.onMain { self?.handleItemStatus(item) }
        }
        player.replaceCurrentItem(with: playerItem)
        knownDurationMs = 0

        if seekToMs > 0 {
            player.seek(
                to: CMTime(value: seekToMs, timescale: 1000),
                toleranceBefore: .zero,
                toleranceAfter: .zero
            )
        }
        if playRequested {
            applyRate()
        }
    }

    /// Applies the requested rate. Setting `AVPlayer.rate` is the only way to start
    /// playback at a non-default rate on iOS 15 (`defaultRate` is newer); rate 0 pauses.
    private func applyRate() {
        guard playRequested else {
            player.pause()
            return
        }
        guard let item = player.currentItem, item.status != .failed else { return }
        player.rate = Float(clampedDesiredRate())
    }

    private func clampedDesiredRate() -> Double {
        guard desiredRate.isFinite else { return 1 }
        return min(max(desiredRate, PlayerEngine.minSpeed), PlayerEngine.maxSpeed)
    }

    /// `StreamPolicy.isExpired` check plus pause + `player-stream-needed`, mirroring
    /// Kotlin `awaitUrl`: remember whether playback was wanted, pause, ask TS, and arm the
    /// 15s missing-URL timeout (only for `.missing`, exactly like Android).
    private func awaitURL(_ item: PlayerQueueItem, reason: PlayerStreamReason) {
        if awaitingURLItemId == item.id { return }
        awaitingURLItemId = item.id
        resumeAfterURL = playRequested
        playRequested = false
        player.pause()
        emitSnapshot(force: true)
        onStreamNeeded?(item.id, reason)
        if reason == .missing {
            scheduleMissingURLTimeout(itemId: item.id)
        }
    }

    private func scheduleMissingURLTimeout(itemId: String) {
        cancelMissingURLTimeout()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.awaitingURLItemId == itemId else { return }
            self.awaitingURLItemId = nil
            self.resumeAfterURL = false
            self.onError?(
                itemId,
                "url_missing",
                "No stream URL arrived in 15 seconds",
                false
            )
            // Kotlin additionally advances to the next native item when it has one.
            // With a singleton active queue (C-1/C-2) there is nothing to advance to, so
            // the engine stays on the current item and leaves the decision to TS.
            self.playRequested = false
            self.player.pause()
            self.emitSnapshot(force: true)
        }
        missingURLTimeout = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(Int(PlayerEngine.missingURLWaitMs)),
            execute: work
        )
    }

    private func cancelMissingURLTimeout() {
        missingURLTimeout?.cancel()
        missingURLTimeout = nil
    }

    /// `clearUrlWait()`: cancels the missing-URL timeout, the retry and resets the retry
    /// ladder. Queue replacement and `setUrl` both do this on Android.
    private func cancelPendingWork() {
        awaitingURLItemId = nil
        resumeAfterURL = false
        cancelMissingURLTimeout()
        cancelRetry()
        retryAttempt = 0
    }

    private func cancelRetry() {
        retryWorkItem?.cancel()
        retryWorkItem = nil
    }

    /// Retry ladder 1s/2s/4s then a recoverable failure, mirroring `StreamPolicy.RetryPolicy`
    /// and `PlayerService.retryStream`.
    private func retryStream(_ item: PlayerQueueItem, code: String, message: String) {
        guard retryAttempt < PlayerEngine.retryDelaysMs.count else {
            failCurrent(item, code: code, message: message, recoverable: true)
            return
        }
        let delay = PlayerEngine.retryDelaysMs[retryAttempt]
        retryAttempt += 1
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  let current = self.currentQueueItem(),
                  current.id == item.id
            else { return }
            // Re-prepare at the position we stopped at rather than restarting the track.
            self.loadCurrentItem(seekToMs: self.currentPositionMs())
        }
        retryWorkItem = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(Int(delay)),
            execute: work
        )
    }

    /// `failCurrent`: pause, then report. Android emits `player-error` after pausing.
    private func failCurrent(
        _ item: PlayerQueueItem,
        code: String,
        message: String,
        recoverable: Bool
    ) {
        playRequested = false
        player.pause()
        onError?(item.id, code, message, recoverable)
        emitSnapshot(force: true)
    }

    // MARK: - Observations

    private func installPlaybackObservers() {
        // Playing/buffering transitions. `.waitingToPlayAtSpecifiedRate` is the AVPlayer
        // equivalent of Media3's buffering-while-playing state.
        timeControlObservation = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] _, _ in
            self?.onMain { self?.emitSnapshot() }
        }

        // 1s cadence while time advances, matching Android `STATE_TICK_MS` (Android's ticker
        // only runs while `isPlaying`, i.e. while the timebase moves).
        // UNVERIFIED: periodic observers are documented as firing while the player's
        // timebase progresses; a fully stalled or paused player is not guaranteed to tick,
        // which is why every command also emits explicitly.
        timeObserverToken = player.addPeriodicTimeObserver(
            forInterval: CMTime(value: 1, timescale: 1),
            queue: .main
        ) { [weak self] _ in
            self?.tick()
        }

        // End of item. Registered once, filtered by identity so a late notification from
        // a replaced item can never report an end for the current one (P3).
        observe(
            AVPlayerItem.didPlayToEndTimeNotification,
            object: nil
        ) { [weak self] note in
            guard let self, let item = note.object as? AVPlayerItem else { return }
            // Apple documents that this notification can arrive on a thread other than the
            // registering one, so hop to main before touching state.
            self.onMain {
                self.handleItemEnded(item)
            }
        }
    }

    private func installAudioSessionObservers() {
        // Interruptions arrive on the main thread (Apple documents: posted on the main
        // thread), but the handler funnels through onMain anyway.
        observe(AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance()) { [weak self] note in
            self?.handleInterruption(note)
        }
        // Route changes are posted on a secondary thread (Apple docs) -> must hop to main.
        observe(AVAudioSession.routeChangeNotification, object: AVAudioSession.sharedInstance()) { [weak self] note in
            self?.handleRouteChange(note)
        }
        // Media services can be reset by the system (daemon crash, audio config change).
        // Android has no equivalent; iOS requires re-activating the session.
        observe(AVAudioSession.mediaServicesWereResetNotification, object: AVAudioSession.sharedInstance()) { [weak self] _ in
            self?.onMain {
                guard let self else { return }
                self.audioSessionConfigured = false
                self.configureAudioSession()
                self.playRequested = false
                self.player.pause()
                self.onError?(
                    self.currentQueueItem()?.id ?? "",
                    "audio_services_reset",
                    "Audio services were reset; paused and reconfigured the session",
                    true
                )
                self.emitSnapshot(force: true)
            }
        }
        observe(AVAudioSession.mediaServicesWereLostNotification, object: AVAudioSession.sharedInstance()) { [weak self] _ in
            self?.onMain {
                guard let self else { return }
                self.audioSessionConfigured = false
                self.playRequested = false
                self.player.pause()
                self.onError?(
                    self.currentQueueItem()?.id ?? "",
                    "audio_services_lost",
                    "Audio services are unavailable",
                    true
                )
                self.emitSnapshot(force: true)
            }
        }
    }

    private func observe(
        _ name: Notification.Name,
        object: Any?,
        using block: @escaping (Notification) -> Void
    ) {
        let token = NotificationCenter.default.addObserver(
            forName: name,
            object: object,
            queue: nil,
            using: block
        )
        notificationTokens.append(token)
    }

    private func onMain(_ body: @escaping () -> Void) {
        if Thread.isMainThread {
            body()
        } else {
            DispatchQueue.main.async(execute: body)
        }
    }

    private func tick() {
        refreshDuration()
        // Expiry is only checked when playback is (re)requested (Kotlin `ensureUsable`
        // runs from `setPlaying(true)`/`setUrl`), never on a timer.
        emitSnapshot()
    }

    private func handleItemStatus(_ item: AVPlayerItem) {
        // Stale guard: a callback for a replaced item is dropped, never adopted.
        guard item === observedItem else { return }
        switch item.status {
        case .readyToPlay:
            retryAttempt = 0
            refreshDuration()
            if playRequested {
                applyRate()
            }
        case .failed:
            refreshDuration()
            handleItemFailure(item)
        case .unknown:
            break
        @unknown default:
            break
        }
        emitSnapshot()
    }

    private func handleItemEnded(_ item: AVPlayerItem) {
        guard item === observedItem else { return }
        refreshDuration()
        // The ended identity is the current queue item's id (native owns a single
        // installed item and never advances). An empty id is reported as nil so the
        // adapter emits `{}` instead of `{id: ""}` (ADR-007 Decision 1).
        let endedId: String? = {
            guard let id = currentQueueItem()?.id, !id.isEmpty else { return nil }
            return id
        }()
        if sleepEndOfSong {
            // End-of-song sleep: pause at completion, no fade, never advance (ADR-007
            // Decision 3). Unlike a natural end — where playWhenReady stays true like
            // Media3's STATE_ENDED — the player is now genuinely stopped.
            sleepEndOfSong = false
            playRequested = false
            player.pause()
        }
        // Media3 keeps playWhenReady == true in STATE_ENDED, and Android reports
        // `playing` from playWhenReady. Preserve that: the snapshot after a natural end
        // still says playing == true; the TS `handleEnded` path decides what happens next
        // (repeat-one, advance, autoplay). This engine never restarts or advances by
        // itself, because that is shared queue logic (P4/C-1/C-2).
        onEnded?(endedId)
        emitSnapshot(force: true)
    }

    /// Maps an `AVPlayerItem` failure onto the Android failure policy
    /// (`StreamPolicy.classify`): 403 -> stream-needed http_403, file-not-found ->
    /// file_missing (not recoverable), transient network -> 1/2/4s retries then a
    /// recoverable error, everything else -> a non-recoverable error.
    ///
    /// DEVICE-VERIFIED CODES: none. AVFoundation does not expose an HTTP status on
    /// `AVPlayerItem.error`; `AVPlayerItemErrorLogEvent.errorStatusCode` is read as a
    /// best-effort source and is marked UNVERIFIED.
    private func handleItemFailure(_ item: AVPlayerItem) {
        guard let queued = currentQueueItem() else { return }
        let nsError = item.error as NSError?
        let message = nsError?.localizedDescription ?? "Playback failed"
        let status = PlayerEngine.httpStatus(from: item)

        if queued.isExpired(nowMs: PlayerEngine.nowMs()) {
            awaitURL(queued, reason: .expired)
            return
        }
        if status == 403 {
            awaitURL(queued, reason: .http403)
            return
        }
        let noSuchFile = CocoaError.Code.fileNoSuchFile.rawValue
        if let url = queued.playbackURL, url.isFileURL,
           nsError?.code == noSuchFile || nsError?.code == NSURLErrorFileDoesNotExist {
            failCurrent(queued, code: "file_missing", message: message, recoverable: false)
            return
        }
        if PlayerEngine.isTransientNetworkError(nsError) {
            retryStream(queued, code: "av_network", message: message)
            return
        }
        let code = nsError.map { "av_\($0.domain)_\($0.code)" } ?? "av_failed"
        failCurrent(queued, code: code, message: message, recoverable: false)
    }

    private static func httpStatus(from item: AVPlayerItem) -> Int? {
        // AVPlayerItemErrorLog lists the HTTP-level failures for this item, newest last.
        // UNVERIFIED: the log is only populated after a failure and may be empty for
        // local files; never treat a missing entry as success.
        guard let event = item.errorLog()?.events.last else { return nil }
        return event.errorStatusCode > 0 ? event.errorStatusCode : nil
    }

    private static func isTransientNetworkError(_ error: NSError?) -> Bool {
        guard let error, error.domain == NSURLErrorDomain else { return false }
        let retryable: Set<Int> = [
            NSURLErrorTimedOut,
            NSURLErrorCannotFindHost,
            NSURLErrorCannotConnectToHost,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorNotConnectedToInternet,
            NSURLErrorDNSLookupFailed,
            NSURLErrorResourceUnavailable,
            NSURLErrorSecureConnectionFailed,
        ]
        return retryable.contains(error.code)
    }

    // MARK: - Audio session event handling

    /// `.began` -> pause and remember intent; `.ended` + `.shouldResume` -> resume **only**
    /// if the engine itself wanted to play when the interruption started.
    ///
    /// This is the iOS counterpart of the Android audio-focus path
    /// (`PlayerEvents.emit("player-focus")` -> TS `wantsPlayback`). The engine resumes
    /// natively so a suspended WebView cannot lose a transient-interruption resume.
    /// UNVERIFIED: Apple documents `AVAudioSessionInterruptionWasSuspendedKey` for
    /// interruptions caused by the system deactivating the session while the process was
    /// suspended; its presence is logged into the message only and does not by itself
    /// grant a resume.
    private func handleInterruption(_ note: Notification) {
        onMain { [weak self] in
            guard let self, let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw)
            else { return }
            switch type {
            case .began:
                // `AVAudioSessionInterruptionWasSuspendedKey` (present when the system
                // deactivated the session because the process was suspended) does not
                // change the policy: pause, and only resume on `.ended` + `.shouldResume`.
                self.resumeAfterInterruption = self.playRequested
                self.playRequested = false
                self.player.pause()
                self.emitSnapshot(force: true)
            case .ended:
                let rawOptions = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0
                let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
                let shouldResume = options.contains(.shouldResume) && self.resumeAfterInterruption
                self.resumeAfterInterruption = false
                guard shouldResume, let item = self.currentQueueItem() else {
                    self.emitSnapshot(force: true)
                    return
                }
                if let reason = self.unusableReason(for: item) {
                    self.awaitURL(item, reason: reason)
                    return
                }
                self.activateAudioSession()
                self.playRequested = true
                self.applyRate()
                self.emitSnapshot(force: true)
            @unknown default:
                break
            }
        }
    }

    /// `.oldDeviceUnavailable` (headphones unplugged, Bluetooth disconnected) -> pause,
    /// like Android's audio-device callback. Nothing auto-resumes: a route coming back
    /// does not imply user intent.
    ///
    /// `.newDeviceAvailable` / `.categoryChange` / `.override` / `.wakeFromSleep` /
    /// `.noSuitableRouteForCategory` are intentionally ignored. Android's
    /// "becoming_noisy" (ACTION_AUDIO_BECOMING_NOISY) has no iOS equivalent and is not
    /// synthesized from `secondaryAudioShouldBeSilencedHint`.
    private func handleRouteChange(_ note: Notification) {
        onMain { [weak self] in
            guard let self,
                  let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
            else { return }
            guard reason == .oldDeviceUnavailable else { return }
            self.playRequested = false
            self.player.pause()
            self.emitSnapshot(force: true)
            self.onRouteChange?(.deviceRemoved)
        }
    }

    // MARK: - Snapshot emission

    /// Emits the full snapshot when anything in it changed (or when forced by a command).
    ///
    /// Stale-event note (P3/D03): the wire payload carries the item id but no generation.
    /// Same-id replacement (A -> B -> A) is indistinguishable here; the authoritative
    /// filter is the TS `playGeneration` guard. The native side must therefore never
    /// substitute an item, restart playback or "correct" the store on its own.
    private func emitSnapshot(force: Bool = false) {
        let next = state()
        if !force, let last = lastEmitted, last == next { return }
        lastEmitted = next
        onSnapshot?(next)
        refreshNowPlaying(force: force)
    }

    private func currentPositionMs() -> Int64 {
        PlayerEngine.milliseconds(from: player.currentTime())
    }

    private var isBuffering: Bool {
        guard let item = player.currentItem else { return false }
        switch item.status {
        case .unknown:
            // Loading. Media3 reports STATE_BUFFERING here regardless of playWhenReady,
            // so a paused-but-loading queue install also reports buffering: true.
            return true
        case .failed:
            return false
        case .readyToPlay:
            if player.timeControlStatus == .waitingToPlayAtSpecifiedRate { return true }
            return item.isPlaybackBufferEmpty
        @unknown default:
            return false
        }
    }

    /// `AVPlayerItem.duration` is only meaningful once the item is ready; until then it is
    /// indefinite and is reported as 0 (= unknown) like Media3's C.TIME_UNSET clamp.
    private func refreshDuration() {
        guard let item = player.currentItem else {
            knownDurationMs = 0
            return
        }
        knownDurationMs = PlayerEngine.milliseconds(from: item.duration)
    }

    // MARK: - Remote command center

    private func installRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        addTarget(center.playCommand) { [weak self] _ in
            guard let self, self.currentQueueItem() != nil else { return .noSuchContent }
            // Android's ForwardingPlayer emits "play" from play()/setPlayWhenReady(true).
            self.onRemoteAction?(.play)
            self.play()
            return .success
        }
        addTarget(center.pauseCommand) { [weak self] _ in
            guard let self, self.currentQueueItem() != nil else { return .noSuchContent }
            // Android only emits "pause" from the toggle path, but the contract lists
            // pause among player-action values and the TS handler ignores it, so the
            // remote pause is reported here as well.
            self.onRemoteAction?(.pause)
            self.pause()
            return .success
        }
        addTarget(center.togglePlayPauseCommand) { [weak self] _ in
            guard let self, self.currentQueueItem() != nil else { return .noSuchContent }
            // Kotlin `togglePlayPause()` emits the action that was applied.
            _ = self.toggle()
            return .success
        }
        addTarget(center.nextTrackCommand) { [weak self] _ in
            guard let self, self.currentQueueItem() != nil else { return .noSuchContent }
            // Never advances natively: `src/stores/player.ts::next(true)` owns the queue
            // decision (BEHAVIOR_CONTRACTS §1.3, P4, C-1/C-2).
            self.onRemoteAction?(.next)
            return .success
        }
        addTarget(center.previousTrackCommand) { [weak self] _ in
            guard let self, self.currentQueueItem() != nil else { return .noSuchContent }
            // Kotlin `previousOrRestart()`: >3000ms restarts in place, otherwise asks TS.
            if self.currentPositionMs() > PlayerEngine.restartAfterMs {
                self.seek(0)
            } else {
                self.onRemoteAction?(.previous)
            }
            return .success
        }
        addTarget(center.changePlaybackPositionCommand) { [weak self] event in
            guard let self, self.currentQueueItem() != nil else { return .noSuchContent }
            guard let change = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            // MPChangePlaybackPositionCommandEvent.positionTime is in SECONDS.
            let ms = Int64((change.positionTime * 1000).rounded())
            // MediaSession seek maps straight onto player.seekTo on Android; no
            // player-action is emitted for a seek there, and none is emitted here.
            self.seek(ms)
            return .success
        }

        // Like/unlike is an Android MediaSession custom command; there is no standard
        // iOS equivalent wired to the shared library yet (IOS_INTEGRATION.md §4.6).
    }

    private func addTarget(
        _ command: MPRemoteCommand,
        handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus
    ) {
        let token = command.addTarget(handler: handler)
        command.isEnabled = true
        remoteCommandTargets.append((command, token))
    }

    // MARK: - Now Playing (lock screen / Control Center / AirPlay sender UI)

    /// `MPNowPlayingInfoCenter` projection of the current item.
    ///
    /// Apple documents that elapsed time and rate are interpolated by the system, so the
    /// elapsed value does not need frequent updates; a signature guard keeps us from
    /// rewriting the dictionary on every 1s tick.
    private func refreshNowPlaying(force: Bool) {
        guard let item = currentQueueItem() else {
            if lastNowPlayingSignature != nil {
                lastNowPlayingSignature = nil
                MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            }
            return
        }
        let snapshot = lastEmitted ?? state()
        let signature = [
            item.id,
            item.title,
            item.artist,
            String(snapshot.durationMs),
            String(snapshot.playing),
            String(snapshot.speed),
            String(snapshot.index),
            item.artworkUrl ?? "",
        ].joined(separator: "\u{1F}")
        let unchanged = signature == lastNowPlayingSignature
        if unchanged, !force { return }
        lastNowPlayingSignature = signature

        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = item.title
        info[MPMediaItemPropertyArtist] = item.artist
        info[MPNowPlayingInfoPropertyMediaType] = NSNumber(value: MPNowPlayingInfoMediaType.audio.rawValue)
        info[MPNowPlayingInfoPropertyExternalContentIdentifier] = item.id
        if snapshot.durationMs > 0 {
            // MediaPlayer durations are SECONDS; the wire stays in milliseconds.
            info[MPMediaItemPropertyPlaybackDuration] = Double(snapshot.durationMs) / 1000
        }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(snapshot.positionMs) / 1000
        info[MPNowPlayingInfoPropertyPlaybackRate] = snapshot.playing ? snapshot.speed : 0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = snapshot.speed
        if let artworkString = item.artworkUrl, let artworkURL = URL(string: artworkString) {
            info[MPNowPlayingInfoPropertyAssetURL] = artworkURL
            if let artwork = artworkCache[artworkString] {
                info[MPMediaItemPropertyArtwork] = artwork
            } else {
                loadArtwork(urlString: artworkString, url: artworkURL)
            }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    /// Native artwork fetch, mirroring the Android session's `CacheBitmapLoader`
    /// (15s timeouts, 512px ceiling). UNVERIFIED: URLSession cannot be given the
    /// `ARTWORK_USER_AGENT` header the Android loader sets; some providers may reject the
    /// default UA. This is a documented gap, not a claim of parity.
    private func loadArtwork(urlString: String, url: URL) {
        guard artworkTasks[urlString] == nil else { return }
        artworkGeneration += 1
        let generation = artworkGeneration
        var request = URLRequest(url: url)
        request.timeoutInterval = PlayerEngine.artworkTimeout
        let task = artworkSession.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            self.onMain {
                defer { self.artworkTasks.removeValue(forKey: urlString) }
                guard generation == self.artworkGeneration,
                      let data,
                      let http = response as? HTTPURLResponse,
                      (200...299).contains(http.statusCode),
                      let artwork = PlayerEngine.makeArtwork(data: data)
                else { return }
                self.artworkCache[urlString] = artwork
                if self.currentQueueItem()?.artworkUrl == urlString {
                    self.refreshNowPlaying(force: true)
                }
            }
        }
        artworkTasks[urlString] = task
        task.resume()
    }

    private func cancelArtworkLoads() {
        artworkGeneration += 1
        artworkTasks.values.forEach { $0.cancel() }
        artworkTasks.removeAll()
        artworkCache.removeAll()
    }

    private static func makeArtwork(data: Data) -> MPMediaItemArtwork? {
        #if canImport(UIKit)
        guard let image = UIImage(data: data) else { return nil }
        let maxDimension = artworkMaxDimension
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxDimension ? maxDimension / longest : 1
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let rendered: UIImage
        if scale < 1 {
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = 1
            rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
        } else {
            rendered = image
        }
        return MPMediaItemArtwork(boundsSize: rendered.size) { _ in rendered }
        #else
        _ = data
        return nil
        #endif
    }

    // MARK: - Clamping helpers (PlayerMath parity)

    private func clampSeek(_ positionMs: Int64) -> Int64 {
        let upper = max(0, knownDurationMs)
        return min(max(0, positionMs), upper)
    }

    private func clampSpeed(_ speed: Double) -> Double {
        guard speed.isFinite else { return 1 }
        return min(max(speed, PlayerEngine.minSpeed), PlayerEngine.maxSpeed)
    }

    private func clampVolume(_ volume: Double) -> Double {
        guard volume.isFinite else { return 1 }
        return min(max(volume, 0), 1)
    }

    static func milliseconds(from time: CMTime) -> Int64 {
        guard time.isNumeric else { return 0 }
        let seconds = CMTimeGetSeconds(time)
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return Int64((seconds * 1000).rounded())
    }

    static func nowMs() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1000).rounded())
    }
}

// MARK: - HTTP header replay

/// `AVURLAsset` has no public API for HTTP request headers, and the
/// `AVURLAssetHTTPHeaderFieldsKey` option is UNVERIFIED (undocumented). This loader is the
/// documented-API route: the asset URL is rewritten to a custom scheme and every
/// `AVAssetResourceLoadingRequest` is answered by our own `URLSession` request carrying
/// the queue item's headers plus a `Range` header matching the requested byte window.
///
/// This is the component that has to preserve the P5/S5 invariants:
///  * per-stream request headers (production sends `User-Agent: MEDIA_USER_AGENT`),
///  * byte ranges (`Range: bytes=...`) so a seek does not re-download from zero,
///  * honest HTTP failures, so a 403 can become `player-stream-needed {reason: http_403}`.
///
/// Threading: AVFoundation calls the asset-loader delegate on its own serial queue and
/// URLSession calls its delegate on another; all shared state below is guarded by `lock`.
///
/// Known limitations (all unverified on device):
///  * No cache: every requested window is a fresh request (correct, but chatty).
///  * HLS (`.m3u8`) cannot be served this way - segment URLs would also need rewriting.
///    Progressive audio only.
///  * Codec support is whatever AVFoundation decodes; WebM/Opus/FLAC support is a separate
///    capability question (P5) and is not claimed here.
///  * Servers that ignore `Range` (200 from byte zero) are handled by dropping the bytes
///    the player already has.
final class HushioResourceLoader: NSObject, AVAssetResourceLoaderDelegate {

    static let secureScheme = "hushio-https"
    static let insecureScheme = "hushio-http"

    private let headers: [String: String]
    private let session: URLSession
    private let forwarder: SessionForwarder
    private let lock = NSLock()

    private struct Pending {
        let request: AVAssetResourceLoadingRequest
        var skipBytes: Int64
        /// -1 = deliver to the end of the resource.
        var remainingBytes: Int64
    }

    private var pendingByRequest: [ObjectIdentifier: Pending] = [:]
    private var requestKeyByTask: [Int: ObjectIdentifier] = [:]
    private var tasksByRequest: [ObjectIdentifier: URLSessionDataTask] = [:]

    init(headers: [String: String]) {
        self.headers = headers
        let forwarder = SessionForwarder()
        self.forwarder = forwarder
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 60
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        // `delegate:` cannot be `self` before `super.init()`, so a small forwarder holds
        // the URLSession delegate identity and relays to this object.
        self.session = URLSession(configuration: configuration, delegate: forwarder, delegateQueue: nil)
        super.init()
        forwarder.loader = self
    }

    deinit {
        tasksByRequest.values.forEach { $0.cancel() }
        session.invalidateAndCancel()
    }

    // MARK: URL rewriting

    /// `https://host/path` -> `hushio-https://host/path`. Keeping the original scheme in the
    /// scheme name avoids re-encoding the path, so query strings, signed parameters and
    /// unicode path segments survive untouched (P5: do not normalize stream URLs).
    static func streamingURL(for url: URL) -> URL? {
        guard let scheme = url.scheme?.lowercased() else { return nil }
        let mapped: String
        switch scheme {
        case "https": mapped = secureScheme
        case "http": mapped = insecureScheme
        default: return nil
        }
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.scheme = mapped
        return components.url
    }

    static func originalURL(for url: URL) -> URL? {
        guard let scheme = url.scheme?.lowercased() else { return nil }
        let restored: String
        switch scheme {
        case secureScheme: restored = "https"
        case insecureScheme: restored = "http"
        default: return nil
        }
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.scheme = restored
        return components.url
    }

    // MARK: AVAssetResourceLoaderDelegate

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOf request: AVAssetResourceLoadingRequest
    ) -> Bool {
        guard let streamingURL = request.request.url,
              let url = HushioResourceLoader.originalURL(for: streamingURL)
        else { return false }

        var urlRequest = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 30
        )
        for (field, value) in headers {
            urlRequest.setValue(value, forHTTPHeaderField: field)
        }

        let dataRequest = request.dataRequest
        let offset = dataRequest?.requestedOffset ?? 0
        let wantsAll = dataRequest?.requestsAllDataToEndOfResource ?? true
        let requestedLength = dataRequest?.requestedLength ?? 0
        var remaining: Int64 = -1
        if !wantsAll, requestedLength > 0 {
            remaining = Int64(requestedLength)
            urlRequest.setValue(
                "bytes=\(offset)-\(offset + remaining - 1)",
                forHTTPHeaderField: "Range"
            )
        } else if offset > 0 {
            urlRequest.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range")
        }

        let key = ObjectIdentifier(request)
        let task = session.dataTask(with: urlRequest)
        let taskID = task.taskIdentifier
        lock.lock()
        pendingByRequest[key] = Pending(request: request, skipBytes: 0, remainingBytes: remaining)
        requestKeyByTask[taskID] = key
        tasksByRequest[key] = task
        lock.unlock()
        task.resume()
        return true
    }

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        didCancel loadingRequest: AVAssetResourceLoadingRequest
    ) {
        let key = ObjectIdentifier(loadingRequest)
        lock.lock()
        tasksByRequest[key]?.cancel()
        tasksByRequest.removeValue(forKey: key)
        pendingByRequest.removeValue(forKey: key)
        lock.unlock()
    }

    // MARK: Response handling (called by SessionForwarder)

    fileprivate func handle(
        response: URLResponse,
        taskID: Int,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        lock.lock()
        guard let key = requestKeyByTask[taskID], var pending = pendingByRequest[key] else {
            lock.unlock()
            completionHandler(.cancel)
            return
        }
        guard let http = response as? HTTPURLResponse else {
            lock.unlock()
            pending.request.finishLoading(
                with: NSError(
                    domain: "HushioResourceLoader",
                    code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Non-HTTP response"]
                )
            )
            discard(key: key)
            completionHandler(.cancel)
            return
        }
        guard (200...299).contains(http.statusCode) else {
            // 403/404/5xx surface as a load failure; PlayerEngine classifies them into
            // stream-needed (403) or player-error (other).
            lock.unlock()
            pending.request.finishLoading(
                with: NSError(
                    domain: "HushioResourceLoader",
                    code: http.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode)"]
                )
            )
            discard(key: key)
            completionHandler(.cancel)
            return
        }

        // A request that only asks for content information (no dataRequest) must be
        // completed as soon as the headers are known. Leaving it to the task completion
        // handler would not answer AVFoundation until the *entire* body had downloaded,
        // which stalls the item until its load timeout and surfaces as
        // `player-error av_AVFoundationErrorDomain_-11800` (observed as "Couldn't play").
        var contentInfoOnly = false
        if let information = pending.request.contentInformationRequest {
            information.isByteRangeAccessSupported = true
            if let mime = http.mimeType {
                information.contentType = UTType(mimeType: mime)?.identifier ?? mime
            }
            if let total = HushioResourceLoader.totalLength(from: http) {
                information.contentLength = total
            }
            contentInfoOnly = pending.request.dataRequest == nil
        }

        // A server that ignored the Range header answers 200 from byte zero. Drop the
        // leading bytes the player already has so the stream stays aligned.
        let requestedOffset = pending.request.dataRequest?.requestedOffset ?? 0
        if http.statusCode == 200, requestedOffset > 0 {
            pending.skipBytes = requestedOffset
        }
        pendingByRequest[key] = pending
        lock.unlock()

        if contentInfoOnly {
            // Answer the probe now and stop the transfer: nothing consumes its body.
            pending.request.finishLoading()
            discard(key: key)
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    fileprivate func handle(data: Data, taskID: Int) {
        lock.lock()
        guard let key = requestKeyByTask[taskID], var pending = pendingByRequest[key] else {
            lock.unlock()
            return
        }
        guard !pending.request.isCancelled else {
            lock.unlock()
            pending.request.finishLoading()
            discard(key: key)
            return
        }

        var chunk = data
        if pending.skipBytes > 0 {
            let drop = min(Int64(chunk.count), pending.skipBytes)
            pending.skipBytes -= drop
            chunk = chunk.dropFirst(Int(drop))
        }
        if pending.remainingBytes >= 0 {
            let allowed = min(Int64(chunk.count), pending.remainingBytes)
            if allowed <= 0 {
                pendingByRequest[key] = pending
                lock.unlock()
                pending.request.finishLoading()
                discard(key: key)
                return
            }
            if allowed < Int64(chunk.count) {
                chunk = chunk.prefix(Int(allowed))
            }
            pending.remainingBytes -= allowed
        }
        let finished = pending.remainingBytes == 0
        pendingByRequest[key] = pending
        lock.unlock()

        if !chunk.isEmpty {
            pending.request.dataRequest?.respond(with: chunk)
        }
        if finished {
            pending.request.finishLoading()
            discard(key: key)
        }
    }

    fileprivate func handle(completion taskID: Int, error: Error?) {
        lock.lock()
        guard let key = requestKeyByTask[taskID], let pending = pendingByRequest[key] else {
            lock.unlock()
            return
        }
        lock.unlock()
        if let error {
            if !pending.request.isCancelled {
                pending.request.finishLoading(with: error)
            }
        } else {
            pending.request.finishLoading()
        }
        discard(key: key)
    }

    private func discard(key: ObjectIdentifier) {
        lock.lock()
        pendingByRequest.removeValue(forKey: key)
        if let task = tasksByRequest.removeValue(forKey: key) {
            requestKeyByTask.removeValue(forKey: task.taskIdentifier)
        }
        lock.unlock()
    }

    /// Total resource length from `Content-Range: bytes a-b/total`, else the response's
    /// expected length (which for a ranged response is only the chunk).
    static func totalLength(from response: HTTPURLResponse) -> Int64? {
        if let contentRange = response.value(forHTTPHeaderField: "Content-Range"),
           let slash = contentRange.lastIndex(of: "/") {
            let total = String(contentRange[contentRange.index(after: slash)...])
            if let value = Int64(total), value > 0 { return value }
        }
        let expected = response.expectedContentLength
        return expected > 0 ? expected : nil
    }
}

/// Relays `URLSession` delegate callbacks to `HushioResourceLoader`.
///
/// Needed only because `URLSession(configuration:delegate:delegateQueue:)` cannot take
/// `self` before `super.init()` in Swift. `URLSession` holds its delegate strongly, and
/// this object holds the loader weakly, so there is no retain cycle.
final class SessionForwarder: NSObject, URLSessionDataDelegate {
    weak var loader: HushioResourceLoader?

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let loader else {
            completionHandler(.cancel)
            return
        }
        loader.handle(
            response: response,
            taskID: dataTask.taskIdentifier,
            completionHandler: completionHandler
        )
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        loader?.handle(data: data, taskID: dataTask.taskIdentifier)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionDataTask,
        didCompleteWithError error: Error?
    ) {
        loader?.handle(completion: task.taskIdentifier, error: error)
    }
}
