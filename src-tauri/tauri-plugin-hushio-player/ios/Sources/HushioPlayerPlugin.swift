// Hushio iOS player plugin — the Tauri bridge between the shared TS/Rust wire contract
// and the AVFoundation `PlayerEngine`.
//
// WIRE NAMES ARE THE SELECTOR NAMES: `Tauri.PluginManager.invoke` builds
// `Selector("\(invoke.command):")` from the command string sent by the frontend
// (`.tauri/tauri-api/Sources/Tauri/Tauri.swift`), so every `@objc` method below is named
// exactly like the JS command in `src/lib/bridge.ts` (`player_set_queue`, …). Renaming a
// Swift method silently breaks that command — see BEHAVIOR_CONTRACTS.md §1.1.
//
// Contract sources: docs/ios-port/BEHAVIOR_CONTRACTS.md (§1.1 commands, §1.2 types,
// §1.3 events), ios/IOS_INTEGRATION.md. Not every Android command has an iOS
// implementation yet; unsupported ones reject with a real error (never a fake success).

import AVFoundation
import Foundation
import Tauri
import UIKit
import WebKit

// MARK: - Wire argument DTOs

/// `player_set_queue` payload. Milliseconds are decoded as `Double` so a fractional
/// value from JS (`Math.round` is not applied everywhere) cannot fail decoding.
private struct SetQueueArgs: Decodable {
  let items: [WireQueueItem]
  let startIndex: Int?
  let startPositionMs: Double?
}

private struct WireQueueItem: Decodable {
  let id: String
  let title: String?
  let artist: String?
  let durationMs: Double?
  let url: String?
  let headers: [String: String]?
  let liked: Bool?
  let expiresAtEpochMs: Double?
  let contentUri: String?
  let artworkUrl: String?

  func toQueueItem() -> PlayerQueueItem {
    PlayerQueueItem(
      id: id,
      title: title ?? "",
      artist: artist ?? "",
      durationMs: Int64((durationMs ?? 0).rounded()),
      url: url ?? "",
      headers: headers ?? [:],
      liked: liked ?? false,
      expiresAtEpochMs: expiresAtEpochMs.map { Int64($0.rounded()) },
      contentUri: contentUri,
      artworkUrl: artworkUrl
    )
  }
}

private struct IdArgs: Decodable { let id: String }
private struct SeekArgs: Decodable { let positionMs: Double }
private struct SpeedArgs: Decodable { let speed: Double }
private struct VolumeArgs: Decodable { let volume: Double }
private struct EqArgs: Decodable { let enabled: Bool; let gainsDb: [Double] }
private struct LikeArgs: Decodable { let id: String; let liked: Bool }
private struct UrlArgs: Decodable {
  let id: String
  let url: String
  let headers: [String: String]?
  let expiresAtEpochMs: Double?
}
private struct KeepAwakeArgs: Decodable { let on: Bool }

// MARK: - Plugin

final class HushioPlayerPlugin: Plugin {
  /// One engine per app process; it owns the AVPlayer, audio session and remote commands.
  private let engine = PlayerEngine()

  override func load(webview: WKWebView) {
    engine.onSnapshot = { [weak self] snapshot in
      self?.emit("player-state", Self.snapshotPayload(snapshot))
    }
    engine.onEnded = { [weak self] in
      self?.emit("player-ended", [:])
    }
    engine.onStreamNeeded = { [weak self] id, reason in
      // TS `StreamNeeded` is `{ id: string; reason: string }` — emit exactly that shape.
      self?.emit("player-stream-needed", ["id": id, "reason": reason.rawValue])
    }
    engine.onError = { [weak self] id, code, message, recoverable in
      self?.emit("player-error", [
        "id": id, "code": code, "message": message, "recoverable": recoverable,
      ])
    }
    engine.onRemoteAction = { [weak self] action in
      self?.emit("player-action", ["action": action.rawValue])
    }
    engine.onRouteChange = { [weak self] reason in
      self?.emit("player-route", ["reason": reason.rawValue])
    }
  }

  // MARK: - Events

  /// `trigger` is an instance method on `Plugin` (it fans out to the channels registered
  /// by the JS `addPluginListener`), so events are emitted from the plugin instance.
  private func emit(_ event: String, _ payload: JSObject) {
    trigger(event, data: payload)
  }

  /// Wire shape of `PlayerSnapshot` (BEHAVIOR_CONTRACTS §1.2). `id` is written as
  /// `NSNull()` when absent so the key is present-but-null, matching Android's
  /// `JSObject.put("id", JSONObject.NULL)` — TS treats a missing key differently
  /// from `null` in `androidEngine.androidPlay()`.
  private static func snapshotPayload(_ snapshot: PlayerSnapshot) -> JSObject {
    var object: JSObject = [
      "playing": snapshot.playing,
      "buffering": snapshot.buffering,
      "positionMs": Int(max(0, snapshot.positionMs)),
      "durationMs": Int(max(0, snapshot.durationMs)),
      "index": snapshot.index,
      "speed": snapshot.speed,
      "repeat": snapshot.repeatMode.rawValue,
      "shuffle": snapshot.shuffle,
    ]
    object["id"] = snapshot.id ?? NSNull()
    return object
  }

  // MARK: - Helpers

  private func args<T: Decodable>(_ type: T.Type, _ invoke: Invoke) throws -> T {
    let raw = invoke.getRawArgs()
    guard let data = raw.data(using: .utf8) else {
      throw PlayerEngineError.invalidArgument("payload is not utf8")
    }
    return try JSONDecoder().decode(T.self, from: data)
  }

  /// Runs a command body on the main thread (AVPlayer/UIKit/Now-Playing work is
  /// main-thread affine) and resolves or rejects there.
  private func onMain(_ invoke: Invoke, _ body: @escaping () throws -> JsonObject?) {
    DispatchQueue.main.async {
      do {
        if let result = try body() {
          invoke.resolve(result)
        } else {
          invoke.resolve()
        }
      } catch let error as PlayerEngineError {
        invoke.reject(error.wireCode)
      } catch {
        invoke.reject("\(error)")
      }
    }
  }

  // MARK: - Playback commands

  @objc public func player_set_queue(_ invoke: Invoke) {
    onMain(invoke) {
      let parsed = try self.args(SetQueueArgs.self, invoke)
      let items = parsed.items.map { $0.toQueueItem() }
      let accepted = self.engine.setQueue(
        items,
        startIndex: max(0, parsed.startIndex ?? 0),
        startPositionMs: Int64((parsed.startPositionMs ?? 0).rounded())
      )
      return ["accepted": accepted]
    }
  }

  @objc public func player_play(_ invoke: Invoke) {
    onMain(invoke) {
      self.engine.play()
      return nil
    }
  }

  @objc public func player_pause(_ invoke: Invoke) {
    onMain(invoke) {
      self.engine.pause()
      return nil
    }
  }

  @objc public func player_toggle(_ invoke: Invoke) {
    onMain(invoke) { ["playing": self.engine.toggle()] }
  }

  @objc public func player_seek(_ invoke: Invoke) {
    onMain(invoke) {
      let parsed = try self.args(SeekArgs.self, invoke)
      self.engine.seek(Int64(parsed.positionMs.rounded()))
      return nil
    }
  }

  @objc public func player_set_speed(_ invoke: Invoke) {
    onMain(invoke) {
      let parsed = try self.args(SpeedArgs.self, invoke)
      self.engine.setSpeed(parsed.speed)
      return nil
    }
  }

  @objc public func player_set_volume(_ invoke: Invoke) {
    onMain(invoke) {
      let parsed = try self.args(VolumeArgs.self, invoke)
      self.engine.setVolume(parsed.volume)
      return nil
    }
  }

  /// AVPlayer has no equalizer. `AVAudioUnitEQ` under an `AVAudioEngine` is the
  /// documented proposal (IOS_INTEGRATION §4.3, contract C3) — it is not implemented, so
  /// this rejects explicitly instead of pretending the gains were applied.
  @objc public func player_set_eq(_ invoke: Invoke) {
    onMain(invoke) {
      let parsed = try self.args(EqArgs.self, invoke)
      let _ = try self.engine.setEq(enabled: parsed.enabled, gainsDb: parsed.gainsDb)
      return nil
    }
  }

  @objc public func player_set_url(_ invoke: Invoke) {
    onMain(invoke) {
      let parsed = try self.args(UrlArgs.self, invoke)
      let found = self.engine.setUrl(
        id: parsed.id,
        url: parsed.url,
        headers: parsed.headers ?? [:],
        expiresAtEpochMs: parsed.expiresAtEpochMs.map { Int64($0.rounded()) }
      )
      if !found {
        throw PlayerEngineError.unknownItem
      }
      return nil
    }
  }

  @objc public func player_set_like(_ invoke: Invoke) {
    onMain(invoke) {
      let parsed = try self.args(LikeArgs.self, invoke)
      if !self.engine.setLike(id: parsed.id, liked: parsed.liked) {
        throw PlayerEngineError.unknownItem
      }
      return nil
    }
  }

  @objc public func player_get_state(_ invoke: Invoke) {
    onMain(invoke) {
      let snapshot = self.engine.state()
      var object: JsonObject = [
        "playing": snapshot.playing,
        "buffering": snapshot.buffering,
        "positionMs": Int(max(0, snapshot.positionMs)),
        "durationMs": Int(max(0, snapshot.durationMs)),
        "index": snapshot.index,
        "speed": snapshot.speed,
        "repeat": snapshot.repeatMode.rawValue,
        "shuffle": snapshot.shuffle,
      ]
      object["id"] = snapshot.id ?? NSNull()
      return object
    }
  }

  // MARK: - Platform commands

  /// Safe areas on iOS come from CSS `env(safe-area-inset-*)` in the WKWebView;
  /// `src/lib/insets.ts::startInsets` already returns before calling this on iOS.
  /// Rejecting is honest: there is no native inset value to report here.
  @objc public func player_get_insets(_ invoke: Invoke) {
    invoke.reject("insets_are_css_env_on_ios")
  }

  /// `src/lib/wakeLock.ts` is Android-gated today, but this is a real, cheap mapping.
  @objc public func player_keep_awake(_ invoke: Invoke) {
    onMain(invoke) {
      let parsed = try self.args(KeepAwakeArgs.self, invoke)
      UIApplication.shared.isIdleTimerDisabled = parsed.on
      return nil
    }
  }

  @objc public func player_haptic_tick(_ invoke: Invoke) {
    onMain(invoke) {
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      return nil
    }
  }

  /// `player_exit` finishes the Android Activity. iOS apps are suspended, not finished by
  /// the app, and the passive back-gesture path never reaches it — reject rather than
  /// pretend it exited.
  @objc public func player_exit(_ invoke: Invoke) {
    invoke.reject("not_supported")
  }

  /// Status-bar appearance is view-controller owned on iOS; the Android
  /// `WindowInsetsController` mapping has no direct equivalent here.
  @objc public func player_set_system_bars(_ invoke: Invoke) {
    invoke.reject("not_supported")
  }

  /// Android launch intents (`LaunchIntents.kt`). URL/document launch handling on iOS is a
  /// Phase D/iOS-registration concern (`CFBundleURLTypes`), not implemented here.
  @objc public func player_take_launch(_ invoke: Invoke) {
    invoke.reject("not_supported")
  }

  // MARK: - Commands with no iOS implementation yet (explicit, never silent)

  // The active TS engine sends a singleton queue (BEHAVIOR_CONTRACTS §2, D02) so these are
  // not called today. Each rejects so that wiring them later fails loudly instead of
  // silently doing nothing.

  @objc public func player_append(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func player_insert_next(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func player_remove_at(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func player_move(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func player_next(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func player_previous(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func player_set_repeat(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func player_set_shuffle(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func player_set_skip_silence(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func player_set_sleep_timer(_ invoke: Invoke) { invoke.reject("not_supported") }

  // Google Cast is an Android SDK integration (K/CastBridge.kt). There is no Cast
  // framework in this build; AirPlay is not the same feature and is not offered.
  @objc public func cast_open(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func cast_load(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func cast_play_pause(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func cast_seek(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func cast_status(_ invoke: Invoke) { invoke.reject("not_supported") }
  @objc public func cast_stop(_ invoke: Invoke) { invoke.reject("not_supported") }
}

@_cdecl("init_plugin_hushio_player")
public func initPlugin() -> Plugin {
  return HushioPlayerPlugin()
}
