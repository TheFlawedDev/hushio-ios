//
//  PlayerSnapshot.swift
//  Hushio iOS player plugin — wire types
//
//  Baseline: 2122110f9b41436723f368d3e1fb4d8a2a4276c2
//  Contract: docs/ios-port/BEHAVIOR_CONTRACTS.md §1.1/§1.2 (P1 "Mobile queue item wire
//  model", P2 "Playback and queue commands", "Player events and consumers").
//
//  These types mirror, field for field, the JSON that the Android plugin sends and
//  receives (K/PlayerPayloads.kt::PlayerSnapshot.toPayload, K/QueueItem.kt) and the
//  TypeScript wire types (src/lib/androidPlayback.ts::PlayerSnapshot/PlayerQueueItem).
//
//  Rules encoded here:
//   * Time is ALWAYS integral milliseconds (`Int64`). No seconds conversion happens for the
//     wire or for engine state. src/lib/audio.ts and src/stores/player.ts divide/multiply by
//     1000 on the TypeScript side; converting here as well would double-convert. The only
//     seconds values in the whole engine are the ones MediaPlayer itself requires
//     (`MPMediaItemPropertyPlaybackDuration`, `MPNowPlayingInfoPropertyElapsedPlaybackTime`
//     and `MPChangePlaybackPositionCommandEvent.positionTime`), and those conversions are
//     commented where they happen.
//   * `positionMs` / `durationMs` are coerced to >= 0 exactly like Kotlin `toPayload()`
//     (`coerceAtLeast(0L)`), because Media3 reports C.TIME_UNSET for unknown duration.
//   * `id` is nullable (`null` = no current item), never the empty string.
//   * `repeat` is a string enum off/all/one. `repeat` is a Swift keyword, so the
//     property is named `repeatMode` and mapped back to the key "repeat" by CodingKeys.
//   * Nothing here imports Tauri: the Swift plugin adapter passes the dictionary from
//     `payload()` to `trigger(...)`, and Codable exists only so a future JSON bridge (or a
//     unit test) can round-trip the same shape.
//
//  NOTHING IN THIS DIRECTORY HAS BEEN COMPILED. See IOS_INTEGRATION.md §5.
//

import Foundation

/// Wire enum for `PlayerSnapshot.repeat` — order and spelling match the Android
/// `PlayerPayloads.repeatName` names and the TS `PlayerRepeat` union.
public enum PlayerRepeat: String, Codable, CaseIterable, Sendable {
    case off
    case all
    case one
}

/// Full player state payload. Field names and JSON keys are the wire contract; do not
/// add fields here without a lead-approved change to `src/lib/bridge.ts` /
/// `src/lib/androidPlayback.ts` (BEHAVIOR_CONTRACTS §1.3, DECISIONS "Shared-interface
/// coordination"). The unresolved native identity/generation question (P3) is
/// deliberately NOT encoded as a new wire field.
public struct PlayerSnapshot: Codable, Equatable, Sendable {
    /// Mirrors Android `playWhenReady`: the user's *intent* to be playing, not
    /// "audio is currently advancing". Buffering playback can therefore report
    /// `playing == true` and `buffering == true` at the same time (P1).
    public var playing: Bool
    /// True while the item is loading / stalled, mirroring
    /// `playbackState == STATE_BUFFERING`.
    public var buffering: Bool
    /// Current playhead in milliseconds, clamped >= 0.
    public var positionMs: Int64
    /// Decoded native duration in milliseconds, clamped >= 0. `0` means unknown.
    /// The wire `PlayerQueueItem.durationMs` is NOT a substitute for this value (P1).
    public var durationMs: Int64
    /// Current queue occurrence index. `0` for the idle/empty queue, matching both the
    /// TS idle snapshot and Media3's `currentMediaItemIndex` on an empty player. The
    /// Kotlin mirror's internal "no current item" value is -1 and is not a wire value.
    public var index: Int
    /// Current item identity, `nil` when there is no current item.
    public var id: String?
    /// Playback speed multiplier (unitless), 0.5...2.0 by contract.
    public var speed: Double
    /// Mapped to the JSON key `repeat`.
    public var repeatMode: PlayerRepeat
    public var shuffle: Bool

    public init(
        playing: Bool,
        buffering: Bool,
        positionMs: Int64,
        durationMs: Int64,
        index: Int,
        id: String?,
        speed: Double,
        repeatMode: PlayerRepeat,
        shuffle: Bool
    ) {
        self.playing = playing
        self.buffering = buffering
        self.positionMs = positionMs
        self.durationMs = durationMs
        self.index = index
        self.id = id
        self.speed = speed
        self.repeatMode = repeatMode
        self.shuffle = shuffle
    }

    /// Zero snapshot: false/false, zero times and index, nil id, speed 1, repeat off,
    /// shuffle false. Identical to `IDLE_SNAPSHOT` in src/lib/androidPlayback.ts.
    public static let idle = PlayerSnapshot(
        playing: false,
        buffering: false,
        positionMs: 0,
        durationMs: 0,
        index: 0,
        id: nil,
        speed: 1,
        repeatMode: .off,
        shuffle: false
    )

    enum CodingKeys: String, CodingKey {
        case playing
        case buffering
        case positionMs
        case durationMs
        case index
        case id
        case speed
        case repeatMode = "repeat"
        case shuffle
    }

    /// JSON-ready dictionary for the Swift plugin adapter's
    /// `trigger("player-state", payload)`. `nil` id becomes `NSNull()` so the key is
    /// present-but-null, exactly like `JSObject.put(key, JSONObject.NULL)` on Android.
    ///
    /// Clamping is applied here as well as at construction so a hand-built snapshot can
    /// never emit a negative time on the wire.
    public func payload() -> [String: Any] {
        var object: [String: Any] = [
            "playing": playing,
            "buffering": buffering,
            "positionMs": max(0, positionMs),
            "durationMs": max(0, durationMs),
            "index": index,
            "speed": speed,
            "repeat": repeatMode.rawValue,
            "shuffle": shuffle,
        ]
        object["id"] = id ?? NSNull()
        return object
    }
}

/// One queue item as sent by `player_set_queue` / `player_set_url`.
/// Mirrors `src/lib/androidPlayback.ts::PlayerQueueItem` and `K/QueueItem.kt`, minus the
/// Kotlin-only optional `album` field (the TS `PlayMeta` never sends album).
public struct PlayerQueueItem: Codable, Equatable, Sendable {
    /// Library/source identity (`local:`, `net:`, `jiosaavn:`, `addon:`, YouTube ids...).
    /// Not a URL and not a queue-occurrence id. Duplicates are possible (P1).
    public var id: String
    public var title: String
    public var artist: String
    /// Advertised duration in milliseconds from shared metadata
    /// (`Math.round(track.duration * 1000)`); display/fallback only.
    public var durationMs: Int64
    /// Resolved URL. Empty string is sendable per the TS type (local items are created
    /// with `url: ""`), but see `playbackURL` for how the engine treats that.
    public var url: String
    /// Per-stream request headers. Production sends `User-Agent: MEDIA_USER_AGENT`.
    /// On iOS these are replayed by `HushioResourceLoader`, not passed to AVURLAsset.
    public var headers: [String: String]
    public var liked: Bool
    /// Absolute epoch milliseconds, `nil` for local items.
    public var expiresAtEpochMs: Int64?
    /// Native local source. Kotlin `playbackUri()` prefers this over `url`.
    /// On iOS this must be a `file://` URL or a path the Services adapter has already
    /// made accessible; `content://` is an Android scheme and is not playable here
    /// (P1, S4). `nil` vs empty differs from `url` — see `playbackURL`.
    public var contentUri: String?
    public var artworkUrl: String?

    public init(
        id: String,
        title: String = "",
        artist: String = "",
        durationMs: Int64 = 0,
        url: String = "",
        headers: [String: String] = [:],
        liked: Bool = false,
        expiresAtEpochMs: Int64? = nil,
        contentUri: String? = nil,
        artworkUrl: String? = nil
    ) {
        self.id = id
        self.title = title
        self.artist = artist
        self.durationMs = durationMs
        self.url = url
        self.headers = headers
        self.liked = liked
        self.expiresAtEpochMs = expiresAtEpochMs
        self.contentUri = contentUri
        self.artworkUrl = artworkUrl
    }

    /// Non-nil only when there is something an `AVURLAsset` can actually open.
    ///
    /// Documented adaptation (see IOS_INTEGRATION.md §4.1): Android's `playbackUri()`
    /// returns `contentUri ?: url` and only tests `== null`, so an empty-string `url`
    /// counts as "present" there and then fails deep inside ExoPlayer. AVFoundation
    /// cannot construct a usable asset from an empty string at all, so this engine
    /// treats empty as absent and asks the TS store for a URL via
    /// `player-stream-needed`. That is a deliberate, documented deviation, not parity.
    public var playbackURL: URL? {
        guard let text = playbackURLString else { return nil }
        // The Services adapter may hand over an absolute sandbox path instead of a
        // `file://` URL. `URL(string:)` would treat that as a relative URL and fail, so
        // absolute paths are converted explicitly.
        if text.hasPrefix("/") { return URL(fileURLWithPath: text) }
        return URL(string: text)
    }

    /// Raw URI string form of `playbackURL`, kept because the header cache is keyed by
    /// the string identity exactly like Kotlin `headersByUrl`.
    public var playbackURLString: String? {
        if let contentUri, !contentUri.isEmpty { return contentUri }
        return url.isEmpty ? nil : url
    }

    /// Kotlin `StreamPolicy.isExpired`: `expiresAtMs != null && nowMs >= expiresAtMs`.
    public func isExpired(nowMs: Int64) -> Bool {
        guard let expiresAtEpochMs else { return false }
        return nowMs >= expiresAtEpochMs
    }
}
