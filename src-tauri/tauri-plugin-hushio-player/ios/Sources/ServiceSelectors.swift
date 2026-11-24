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

// MARK: - camelCase aliases (service bridges)
// Tauri's mobile IPC has been observed delivering camelCase command names
// (playerSetSpeed) to this plugin even though the JS bridge sends snake_case
// (player_set_speed). Accept both spellings so a naming difference between the two
// sides can never break a command: each alias simply forwards to the real selector,
// and records that it was used in the diagnostics file.

  @objc public func authAwait(_ invoke: Invoke) {
    HushioDiag.append("alias", "authAwait -> auth_await")
    auth_await(invoke)
  }

  @objc public func authOpen(_ invoke: Invoke) {
    HushioDiag.append("alias", "authOpen -> auth_open")
    auth_open(invoke)
  }

  @objc public func mediaStoreDelete(_ invoke: Invoke) {
    HushioDiag.append("alias", "mediaStoreDelete -> media_store_delete")
    media_store_delete(invoke)
  }

  @objc public func mediaStorePublish(_ invoke: Invoke) {
    HushioDiag.append("alias", "mediaStorePublish -> media_store_publish")
    media_store_publish(invoke)
  }

  @objc public func notificationRequest(_ invoke: Invoke) {
    HushioDiag.append("alias", "notificationRequest -> notification_request")
    notification_request(invoke)
  }

  @objc public func notificationSettings(_ invoke: Invoke) {
    HushioDiag.append("alias", "notificationSettings -> notification_settings")
    notification_settings(invoke)
  }

  @objc public func notificationState(_ invoke: Invoke) {
    HushioDiag.append("alias", "notificationState -> notification_state")
    notification_state(invoke)
  }

  @objc public func pickTree(_ invoke: Invoke) {
    HushioDiag.append("alias", "pickTree -> pick_tree")
    pick_tree(invoke)
  }

  @objc public func readSidecarLrc(_ invoke: Invoke) {
    HushioDiag.append("alias", "readSidecarLrc -> read_sidecar_lrc")
    read_sidecar_lrc(invoke)
  }

  @objc public func scanTree(_ invoke: Invoke) {
    HushioDiag.append("alias", "scanTree -> scan_tree")
    scan_tree(invoke)
  }

  @objc public func secureClear(_ invoke: Invoke) {
    HushioDiag.append("alias", "secureClear -> secure_clear")
    secure_clear(invoke)
  }

  @objc public func secureGet(_ invoke: Invoke) {
    HushioDiag.append("alias", "secureGet -> secure_get")
    secure_get(invoke)
  }

  @objc public func secureSet(_ invoke: Invoke) {
    HushioDiag.append("alias", "secureSet -> secure_set")
    secure_set(invoke)
  }

}
