// Single-plugin service selectors.
//
// `PluginApi::register_ios_plugin` blocks until the webview answers on the main thread.
// Registering the six service bridges as their own plugins (one per Android bridge name)
// deadlocked startup: the window appeared but the WKWebView never painted. Verified by
// bisect — one registration renders the whole phone UI, seven leave it blank.
//
// So the shipping shape is: ONE registered plugin (`init_plugin_hushio_player`) that
// exposes the player selectors (HushioPlayerPlugin.swift) plus the service selectors
// below. `Tauri.PluginManager.invoke` resolves `Selector("\(command):")` on that single
// instance, so every command name stays exactly as the shared Rust facade expects.
//
// The service implementations themselves stay in HushioServicePlugins.swift, unchanged.

import Foundation
import Tauri

/// One instance of each service bridge, owned by the single registered plugin.
enum HushioServiceBridges {
  static let secure = HushioSecurePlugin()
  static let audio = HushioAudioPlugin()
  static let media = HushioMediaPlugin()
  static let auth = HushioAuthPlugin()
  static let permission = HushioPermissionPlugin()
  static let sync = HushioSyncPlugin()
}

extension HushioPlayerPlugin {
  // MARK: - hushio-secure

  @objc public func secure_get(_ invoke: Invoke) {
    HushioServiceBridges.secure.secure_get(invoke)
  }

  @objc public func secure_set(_ invoke: Invoke) {
    HushioServiceBridges.secure.secure_set(invoke)
  }

  @objc public func secure_clear(_ invoke: Invoke) {
    HushioServiceBridges.secure.secure_clear(invoke)
  }

  // MARK: - hushio-audio

  @objc public func pick_tree(_ invoke: Invoke) {
    HushioServiceBridges.audio.pick_tree(invoke)
  }

  @objc public func scan_tree(_ invoke: Invoke) {
    HushioServiceBridges.audio.scan_tree(invoke)
  }

  @objc public func read_sidecar_lrc(_ invoke: Invoke) {
    HushioServiceBridges.audio.read_sidecar_lrc(invoke)
  }

  // MARK: - hushio-media

  @objc public func media_store_publish(_ invoke: Invoke) {
    HushioServiceBridges.media.media_store_publish(invoke)
  }

  @objc public func media_store_delete(_ invoke: Invoke) {
    HushioServiceBridges.media.media_store_delete(invoke)
  }

  // MARK: - hushio-auth

  @objc public func auth_open(_ invoke: Invoke) {
    HushioServiceBridges.auth.auth_open(invoke)
  }

  @objc public func auth_await(_ invoke: Invoke) {
    HushioServiceBridges.auth.auth_await(invoke)
  }

  // MARK: - hushio-permission

  @objc public func notification_state(_ invoke: Invoke) {
    HushioServiceBridges.permission.notification_state(invoke)
  }

  @objc public func notification_request(_ invoke: Invoke) {
    HushioServiceBridges.permission.notification_request(invoke)
  }

  @objc public func notification_settings(_ invoke: Invoke) {
    HushioServiceBridges.permission.notification_settings(invoke)
  }

  // MARK: - hushio-sync

  @objc public func schedule(_ invoke: Invoke) {
    HushioServiceBridges.sync.schedule(invoke)
  }
}
