// Hushio iOS service bridge plugins — the Tauri `Plugin` layer that exposes the
// existing service classes (`ServicesEngine.swift`, `DocumentPicker.swift`) under the
// same command names and payload shapes as the Android bridges in
// `src-tauri/src/android.rs`.
//
// WIRE NAMES ARE THE SELECTOR NAMES. `Tauri.PluginManager.invoke` builds
// `Selector("\(invoke.command):")` from the JS command string verbatim, so every
// `@objc` method below is named exactly like the Android command (`secure_get`, …).
// See HushioPlayerPlugin.swift for the same mechanism.
//
// Each bridge is a `Plugin` subclass registered under its own plugin name:
//   hushio-secure     HushioSecurePlugin     secure_get/secure_set/secure_clear
//   hushio-audio      HushioAudioPlugin      pick_tree/scan_tree/read_sidecar_lrc
//   hushio-media      HushioMediaPlugin      media_store_publish/media_store_delete
//   hushio-auth       HushioAuthPlugin       auth_open/auth_await
//   hushio-permission HushioPermissionPlugin notification_state/notification_request/notification_settings
//   hushio-sync       HushioSyncPlugin       schedule
//
// This file owns no other files. It delegates all real work to the existing service
// classes and only adapts their return shapes onto the wire shapes the shared Rust
// bridge (`src-tauri/src/android.rs`) expects.

import Foundation
import BackgroundTasks
import Tauri
import WebKit

// MARK: - Wire argument DTOs

private struct KeyArgs: Decodable {
  let key: String
}

private struct KeyValueArgs: Decodable {
  let key: String
  let value: String
}

private struct UriArgs: Decodable {
  let uri: String
}

private struct PublishArgs: Decodable {
  let path: String
  let displayName: String
}

private struct AuthOpenArgs: Decodable {
  let url: String
}

// MARK: - Shared helpers

/// Decode the raw command payload exactly like HushioPlayerPlugin's `args(_:_:)`.
private func parse<T: Decodable>(_ type: T.Type, from invoke: Invoke) throws -> T {
  let raw = invoke.getRawArgs()
  guard let data = raw.data(using: .utf8) else {
    throw PlayerEngineError.invalidArgument("payload is not utf8")
  }
  return try JSONDecoder().decode(T.self, from: data)
}

/// Run `body` on the main thread (UIKit/AVFoundation/keychain-presentation work is
/// main-thread affine; every `invoke.resolve`/`reject` for an async completion must
/// also land on the main thread).
private func onMain(_ body: @escaping () -> Void) {
  if Thread.isMainThread {
    body()
  } else {
    DispatchQueue.main.async { body() }
  }
}

/// Resolve with an explicit empty JSON object (wire shape `{}`).
private func resolveEmpty(_ invoke: Invoke) {
  invoke.resolve(JsonObject())
}

/// Flatten the optional string the keychain service returns into either the Swift
/// `String` or an explicit `NSNull` (Rust reads this as `Option<String>`; a missing key
/// and `null` are not interchangeable on the shared side).
private func optionalString(_ value: Any?) -> Any {
  if let value = value, let string = value as? String {
    return string
  }
  return NSNull()
}

/// Convert any numeric box (`NSNumber`/`Int`/`Int64`/`UInt64`/`Double`) to an
/// `NSNumber` so JSONSerialization always emits a real JSON number.
private func jsonNumber(_ value: Any?) -> NSNumber {
  if let number = value as? NSNumber { return number }
  if let number = value as? Int { return NSNumber(value: number) }
  if let number = value as? Int64 { return NSNumber(value: number) }
  if let number = value as? UInt64 { return NSNumber(value: number) }
  if let number = value as? Double { return NSNumber(value: number) }
  return NSNumber(value: 0)
}

/// Map one scanner row onto the exact Kotlin `TreeItem` wire keys
/// (`uri/name/size/mtime/title/artist/album/genre/durationMs`). Missing optional
/// strings are omitted; required numeric fields are always present as numbers.
private func treeItem(_ raw: [String: Any]) -> JsonObject {
  var item = JsonObject()
  item["uri"] = raw["uri"] as? String ?? ""
  item["name"] = raw["name"] as? String ?? ""
  item["size"] = jsonNumber(raw["size"])
  item["mtime"] = jsonNumber(raw["mtime"])
  item["title"] = raw["title"] as? String ?? ""
  if let value = raw["artist"], let artist = value as? String {
    item["artist"] = artist
  }
  if let value = raw["album"], let album = value as? String {
    item["album"] = album
  }
  if let value = raw["genre"], let genre = value as? String {
    item["genre"] = genre
  }
  item["durationMs"] = jsonNumber(raw["durationMs"])
  return item
}

// MARK: - hushio-secure

final class HushioSecurePlugin: Plugin {
  private let secure = SecurePlugin()

  /// `secure_get {key}` -> `{value: String|null}`. `null` is written explicitly so the
  /// Rust bridge decodes `Option<String>` correctly.
  @objc public func secure_get(_ invoke: Invoke) {
    onMain {
      let args: KeyArgs
      do {
        args = try parse(KeyArgs.self, from: invoke)
      } catch {
        invoke.reject("invalid_argument")
        return
      }
      switch self.secure.secureGet(["key": args.key]) {
      case .success(let payload):
        var result = JsonObject()
        result["value"] = optionalString(payload["value"])
        invoke.resolve(result)
      case .failure(let code):
        invoke.reject(code)
      }
    }
  }

  @objc public func secure_set(_ invoke: Invoke) {
    onMain {
      let args: KeyValueArgs
      do {
        args = try parse(KeyValueArgs.self, from: invoke)
      } catch {
        invoke.reject("invalid_argument")
        return
      }
      switch self.secure.secureSet(["key": args.key, "value": args.value]) {
      case .success:
        resolveEmpty(invoke)
      case .failure(let code):
        invoke.reject(code)
      }
    }
  }

  @objc public func secure_clear(_ invoke: Invoke) {
    onMain {
      let args: KeyArgs
      do {
        args = try parse(KeyArgs.self, from: invoke)
      } catch {
        invoke.reject("invalid_argument")
        return
      }
      switch self.secure.secureClear(["key": args.key]) {
      case .success:
        resolveEmpty(invoke)
      case .failure(let code):
        invoke.reject(code)
      }
    }
  }
}

// MARK: - hushio-audio

final class HushioAudioPlugin: Plugin {
  private let documents = DocumentPickerController()

  /// `pick_tree {}` -> `{uri: String|null}`. The folder reference is the iOS
  /// security-scoped bookmark reference produced by `DocumentPickerController`.
  @objc public func pick_tree(_ invoke: Invoke) {
    onMain {
      self.documents.pickTree { result in
        onMain {
          switch result {
          case .success(let reference):
            var payload = JsonObject()
            payload["uri"] = reference ?? NSNull()
            invoke.resolve(payload)
          case .failure(let code):
            invoke.reject(code)
          }
        }
      }
    }
  }

  /// `scan_tree {uri}` -> `{items: [TreeItem...]}`. TreeItem keys are camelCase and
  /// match `src-tauri/src/tree_library.rs::TreeItem` exactly.
  @objc public func scan_tree(_ invoke: Invoke) {
    let args: UriArgs
    do {
      args = try parse(UriArgs.self, from: invoke)
    } catch {
      invoke.reject("invalid_argument")
      return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      let result = self.documents.scanTree(reference: args.uri)
      onMain {
        switch result {
        case .success(let rawItems):
          var payload = JsonObject()
          payload["items"] = rawItems.map { treeItem($0) }
          invoke.resolve(payload)
        case .failure(let code):
          invoke.reject(code)
        }
      }
    }
  }

  /// `read_sidecar_lrc {uri}` -> `{text: String|null}`.
  @objc public func read_sidecar_lrc(_ invoke: Invoke) {
    let args: UriArgs
    do {
      args = try parse(UriArgs.self, from: invoke)
    } catch {
      invoke.reject("invalid_argument")
      return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      let text = self.documents.readSidecarLrc(fileReference: args.uri)
      onMain {
        var payload = JsonObject()
        payload["text"] = text ?? NSNull()
        invoke.resolve(payload)
      }
    }
  }
}

// MARK: - hushio-media

final class HushioMediaPlugin: Plugin {
  private let media = MediaExportController()

  /// `media_store_publish {path, displayName}` -> `{uri: String}`. iOS has no
  /// MediaStore; the service exports via `UIDocumentPickerViewController(forExporting:)`
  /// and returns a best-effort exported-file reference.
  @objc public func media_store_publish(_ invoke: Invoke) {
    onMain {
      let args: PublishArgs
      do {
        args = try parse(PublishArgs.self, from: invoke)
      } catch {
        invoke.reject("invalid_argument")
        return
      }
      self.media.publishDownload(path: args.path, displayName: args.displayName) { result in
        onMain {
          switch result {
          case .success(let uri):
            var payload = JsonObject()
            payload["uri"] = uri
            invoke.resolve(payload)
          case .failure(let code):
            invoke.reject(code)
          }
        }
      }
    }
  }

  /// `media_store_delete {uri}` -> `{}`.
  @objc public func media_store_delete(_ invoke: Invoke) {
    onMain {
      let args: UriArgs
      do {
        args = try parse(UriArgs.self, from: invoke)
      } catch {
        invoke.reject("invalid_argument")
        return
      }
      switch self.media.mediaDelete(reference: args.uri) {
      case .success:
        resolveEmpty(invoke)
      case .failure(let code):
        invoke.reject(code)
      }
    }
  }
}

// MARK: - hushio-auth

final class HushioAuthPlugin: Plugin {
  private let auth = AuthPlugin()
  private var pendingAuthInvoke: Invoke?
  private var pendingAuthFailure: String?
  private var authAwaitTimer: Timer?
  private var authAwaitDeadline: Date?

  /// `auth_open {url}` -> `{}`. Rejects `invalid_url` for a non-HTTPS URL. The command
  /// resolves when the authentication session has been presented; the redirect outcome
  /// is surfaced through `auth_await`, never through a second response here.
  @objc public func auth_open(_ invoke: Invoke) {
    onMain { [weak self] in
      guard let self = self else { return }
      let args: AuthOpenArgs
      do {
        args = try parse(AuthOpenArgs.self, from: invoke)
      } catch {
        invoke.reject("invalid_argument")
        return
      }
      guard let url = URL(string: args.url), url.scheme?.lowercased() == "https" else {
        invoke.reject("invalid_url")
        return
      }

      self.pendingAuthFailure = nil
      self.auth.authOpen(args.url) { [weak self] reason in
        onMain {
          self?.pendingAuthFailure = reason
          self?.drainAuthAwait()
        }
      }
      resolveEmpty(invoke)
    }
  }

  /// `auth_await {}` -> `{url: String}`. The service exposes `pendingRedirect()` but no
  /// wait loop, so this plugin applies the same 5-minute wait the shared Rust flow
  /// assumes (BEHAVIOR_CONTRACTS §S3): poll the pending redirect, consume it exactly
  /// once, and never fabricate a URL. If the session fails or the deadline passes with
  /// no redirect, reject.
  @objc public func auth_await(_ invoke: Invoke) {
    onMain { [weak self] in
      guard let self = self else { return }
      if let url = self.auth.pendingRedirect() {
        self.auth.clearPendingRedirect()
        var payload = JsonObject()
        payload["url"] = url
        invoke.resolve(payload)
        return
      }

      if let reason = self.pendingAuthFailure {
        self.pendingAuthFailure = nil
        invoke.reject(reason)
        return
      }

      guard self.pendingAuthInvoke == nil else {
        invoke.reject("auth_await_pending")
        return
      }

      self.pendingAuthInvoke = invoke
      self.authAwaitDeadline = Date().addingTimeInterval(5 * 60)
      self.authAwaitTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
        self?.drainAuthAwait()
      }
    }
  }

  private func drainAuthAwait() {
    guard let invoke = pendingAuthInvoke else { return }

    if let url = auth.pendingRedirect() {
      auth.clearPendingRedirect()
      finishAuthAwait()
      var payload = JsonObject()
      payload["url"] = url
      invoke.resolve(payload)
      return
    }

    if let reason = pendingAuthFailure {
      pendingAuthFailure = nil
      finishAuthAwait()
      invoke.reject(reason)
      return
    }

    if let deadline = authAwaitDeadline, Date() >= deadline {
      finishAuthAwait()
      invoke.reject("auth_await_timeout")
    }
  }

  private func finishAuthAwait() {
    authAwaitTimer?.invalidate()
    authAwaitTimer = nil
    pendingAuthInvoke = nil
    authAwaitDeadline = nil
  }
}

// MARK: - hushio-permission

final class HushioPermissionPlugin: Plugin {
  private let notifications = NotificationPlugin()

  /// `notification_state {}` -> `{state: String}`. State is derived from a real
  /// `UNAuthorizationStatus` (notDetermined/denied/authorized/provisional/ephemeral).
  @objc public func notification_state(_ invoke: Invoke) {
    notifications.notificationState { payload in
      onMain {
        var result = JsonObject()
        result["state"] = payload["state"] as? String ?? "notDetermined"
        invoke.resolve(result)
      }
    }
  }

  /// `notification_request {}` -> `{state: String}`. Re-reads the OS decision after any
  /// first-time authorization request; never fabricates "granted".
  @objc public func notification_request(_ invoke: Invoke) {
    notifications.notificationRequest { payload in
      onMain {
        var result = JsonObject()
        result["state"] = payload["state"] as? String ?? "notDetermined"
        invoke.resolve(result)
      }
    }
  }

  /// `notification_settings {}` -> `{}`. Opens the app's notification settings; a real
  /// failure to open settings rejects.
  @objc public func notification_settings(_ invoke: Invoke) {
    onMain {
      switch self.notifications.notificationSettings() {
      case .success:
        resolveEmpty(invoke)
      case .failure(let code):
        invoke.reject(code)
      }
    }
  }
}

// MARK: - hushio-sync

final class HushioSyncPlugin: Plugin {
  /// `BGTaskScheduler.shared.register` must run once, early, before a task can fire.
  /// `nil` = not attempted yet, `false` = the OS refused the identifier (see the
  /// `BGTaskSchedulerPermittedIdentifiers` entry in `Info.ios.plist`).
  private static var handlerRegistered: Bool?

  /// Register the launch handler when the webview is created. Without a registered
  /// handler the OS terminates the app when a submitted refresh task fires, so submitting
  /// without registering would be worse than not scheduling at all.
  ///
  /// The handler completes the task as **failed** on purpose: the durable YouTube sync queue
  /// lives in Rust and is driven by the app/WebView session, which a `BGAppRefreshTask`
  /// handler cannot start in this build. Reporting failure is the honest outcome; it must
  /// never claim success it did not achieve.
  override func load(webview: WKWebView) {
    guard HushioSyncPlugin.handlerRegistered == nil else { return }
    HushioSyncPlugin.handlerRegistered = BGTaskScheduler.shared.register(
      forTaskWithIdentifier: HushioSyncTask.identifier,
      using: nil
    ) { task in
      task.setTaskCompleted(success: false)
    }
  }

  /// `schedule {}` -> `{}`. BGTaskScheduler is best-effort on iOS; the service returns
  /// the real registration/submission outcome and this never fabricates success.
  @objc public func schedule(_ invoke: Invoke) {
    onMain {
      if HushioSyncPlugin.handlerRegistered == false {
        invoke.reject("bg_task_not_registered")
        return
      }
      switch HushioSyncTask.scheduleRetry() {
      case .success:
        resolveEmpty(invoke)
      case .failure(let message):
        invoke.reject(message)
      }
    }
  }
}

// Registration symbols intentionally absent: this file's classes are instantiated by
// `HushioServiceBridges` and exposed through the single registered plugin
// (`init_plugin_hushio_player`, see ServiceSelectors.swift). Registering them as separate
// iOS plugins deadlocks startup — see the note at the top of ServiceSelectors.swift.
