// Hushio iOS Services Engine — Phase D native service adapters.
//
// OWNERSHIP: Senior iOS Services Engineer. This file is a reusable Swift source for the
// iOS-side platform services that the shared Rust/TypeScript flow already calls on Android:
//   - Keychain secrets (Security.framework)
//   - Notifications (UserNotifications)
//   - OAuth sign-in browser session (AuthenticationServices)
//
// The file picker (DocumentPicker.swift) and its integration contract live in the sibling
// files owned by the same agent. Playback is owned by the Media Engineer.
//
// COMPILE STATUS: NOT COMPILED. The Xcode license and iOS Rust targets are user-blocked
// (PLATFORM_READINESS.md §1) and `tauri ios init` has not run, so there is no generated iOS
// host and no Swift toolchain against which this has been built. Every declaration below is
// source that is *intended* to compile later; it is NOT a claim that anything runs today.
//
// WIRE CONTRACT: the command names and payload keys below deliberately match the existing
// Android plugin surface (K/) so that the shared Rust `android.rs`-shaped bridge (the `ios.rs`
// equivalent, owned by the Rust agent) can call the same `run_mobile_plugin` command names
// with the same JSON. See SERVICES_INTEGRATION.md for the full mapping table.
//
// Swift command names are the *camelCase Kotlin command names* (secure_get, pick_tree, …),
// not the TS `secret_read`/`pick_tree` Rust-command wrappers; the Rust bridge owns that
// translation. Refer to the Kotlin classes SecurePlugin / PermissionPlugin / AuthPlugin /
// SyncPlugin for the source of truth of each name.

import Foundation
import Security
import UserNotifications
import AuthenticationServices
import BackgroundTasks
import UIKit

// MARK: - 1. Keychain secrets
//
// Contract: BEHAVIOR_CONTRACTS.md §S1 "Secure storage boundary" + §4.1 of the services
// prompt. This class is the iOS Keychain *primitive only*. It does NOT reimplement the
// Rust `secrets.rs` policy (D11): Rust's `keep_secret` decides, on a vault `Err`, whether a
// network/scrobble secret falls back to plaintext in the data JSON. For Google OAuth, the
// `google_auth.rs` path *rejects* sign-in when persistent secret storage fails (except the
// Linux memory-only fallback, which does not apply to iOS). This Swift class therefore must
// surface a real error (via `reject`) whenever SecItem fails, so the Rust layer's D11 policy
// — not this file — chooses the fallback. We never fake success.
//
// Storage encoding: a single kSecClassGenericPassword item per key with
//   service = "<bundle-id>.hushio"   (matches Android's per-app secret vault intent)
//   account = <key>                 (the credential slot, e.g. "google-refresh-token")
//   value   = UTF-8 secret
// This is a 1:1 slot mapping, NOT the Android `secrets.bin` AES-256-GCM blob format. The two
// formats are not portable between platforms (contract S1); keychain items are protected by
// the device keychain/Data Protection at rest, which is the iOS-equivalent protection level,
// but it is not the same ciphertext format and must not be treated as cross-platform data.

final class HushioKeychain {
    /// Bundle-id-derived service string. Falls back to a stable literal if the bundle
    /// identifier is unavailable (e.g. in a unit-test host without an app bundle).
    static func service() -> String {
        let bundleId = Bundle.main.bundleIdentifier ?? "com.hushio.app.iosdev"
        return bundleId + ".hushio"
    }

    static func read(key: String) -> Result<String?, String> {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service(),
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return .success(nil)
        }
        guard status == errSecSuccess else {
            return .failure("keychain_status_\(status)")
        }
        guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            // Non-UTF8 data in a slot we wrote as UTF-8 should not happen; surface as an
            // error rather than a fabricated nil/success.
            return .failure("keychain_decode")
        }
        return .success(value)
    }

    static func write(key: String, value: String) -> OSStatus {
        let data = Data(value.utf8)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service(),
            kSecAttrAccount as String: key,
        ]
        // Update if present, otherwise add.
        let updateStatus = SecItemUpdate(
            base as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updateStatus == errSecSuccess {
            return errSecSuccess
        }
        guard updateStatus == errSecItemNotFound else {
            return updateStatus
        }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(add as CFDictionary, nil)
    }

    static func clear(key: String) -> OSStatus {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service(),
            kSecAttrAccount as String: key,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return (status == errSecSuccess || status == errSecItemNotFound) ? errSecSuccess : status
    }
}

/// Key validation matching the Android `SecretRecords.isKey` allow-list so the credential
/// slot domain is identical across platforms. The Rust layer owns the actual slot names;
/// this gate mirrors Kotlin's and rejects anything else with the same `unknown_key` string.
enum SecretSlot {
    static let allowed: Set<String> = [
        "google-refresh-token",
        "spotify-refresh-token",
        "youtube-tv-token",
        "lastfm-session",
        "listenbrainz-token",
    ]
    static let sharePrefix = "network-share:"

    static func isKey(_ key: String) -> Bool {
        if allowed.contains(key) { return true }
        guard key.hasPrefix(sharePrefix) else { return false }
        let id = key.dropFirst(sharePrefix.count)
        return !id.isEmpty && id.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
    }
}

/// Namespace/class matching the Android `SecurePlugin` (`hushio-secure` bridge).
/// Commands: secure_get / secure_set / secure_clear.
final class SecurePlugin {
    // NOTE: the actual Tauri iOS plugin extends `Plugin` and methods are `@objc public func
    // name(_ invoke: Invoke) throws`. We keep this class implementable as either a thin
    // wrapper around the Tauri `Plugin` base or a plain service object; the Rust agent wires
    // it to `register_ios_plugin("com.hushio.player", "SecurePlugin")`. Command names and
    // payload keys are authoritative here.

    func secureGet(_ args: [String: Any]) -> Result<[String: Any], String> {
        guard let key = args["key"] as? String, SecretSlot.isKey(key) else {
            return .failure("unknown_key")
        }
        return HushioKeychain.read(key: key).map { value in
            ["value": value as Any]  // value is String? → NSNull when nil; matches Kotlin NULL
        }.mapError { _ in "secret_failed" }
    }

    func secureSet(_ args: [String: Any]) -> Result<[String: Any], String> {
        guard let key = args["key"] as? String, SecretSlot.isKey(key) else {
            return .failure("unknown_key")
        }
        guard let value = args["value"] as? String else {
            return .failure("secret_failed")
        }
        let status = HushioKeychain.write(key: key, value: value)
        guard status == errSecSuccess else { return .failure("secret_failed") }
        return .success([:])
    }

    func secureClear(_ args: [String: Any]) -> Result<[String: Any], String> {
        guard let key = args["key"] as? String, SecretSlot.isKey(key) else {
            return .failure("unknown_key")
        }
        let status = HushioKeychain.clear(key: key)
        guard status == errSecSuccess else { return .failure("secret_failed") }
        return .success([:])
    }
}

// MARK: - 2. Notifications
//
// Contract: BEHAVIOR_CONTRACTS.md §4.4 + §S6; blocker C-5/D18; lead addendum point 5.
// The current non-Android Rust stub returns the string "granted" (a fabricated success) for
// notification_state / notification_request. This iOS implementation MUST return the REAL
// UNAuthorizationStatus-derived state and must NEVER fabricate "granted". The wire `state`
// strings below deliberately use the Android NotificationPolicy vocabulary that the shared
// TS store already understands, but they are *derived from real authorization state*, not
// assumed.

enum NotificationState {
    /// Map a real UNAuthorizationStatus to the wire string consumed by the shared store,
    /// without inventing a granted state. `provisional` and `ephemeral` (app-clip) are real
    /// iOS statuses the TS store may not have a branch for; we pass the real value through
    /// rather than collapsing it to "granted".
    static func wire(for status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        @unknown default: return "notDetermined"  // future statuses: do not guess "granted"
        }
    }
}

/// Namespace/class matching the Android `PermissionPlugin` (`hushio-permission` bridge).
/// Commands: notification_state / notification_request / notification_settings.
final class NotificationPlugin {

    /// Primary API. `UNUserNotificationCenter.getNotificationSettings` is inherently
    /// asynchronous on iOS (unlike Android's synchronous permission check); the Tauri command
    /// must therefore resolve the `Invoke` from within this completion, not synchronously.
    func notificationState(_ completion: @escaping ([String: Any]) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            completion(["state": NotificationState.wire(for: settings.authorizationStatus)])
        }
    }

    func notificationRequest(_ completion: @escaping ([String: Any]) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .notDetermined:
                // Real request flow: request authorization; report the resulting REAL state.
                // Android requests POST_NOTIFICATIONS and pages through the system dialog the
                // same way; the result is the OS decision, not a fabricated grant.
                center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                    // Re-read the actual status so the reply reflects the OS truth, including
                    // the case where the user denies.
                    center.getNotificationSettings { final in
                        completion(["state": NotificationState.wire(for: final.authorizationStatus)])
                    }
                }
            case .denied, .authorized, .provisional, .ephemeral:
                // Already determined: do not re-prompt (mirrors Android's REQUEST short-circuit),
                // report the real existing status.
                completion(["state": NotificationState.wire(for: settings.authorizationStatus)])
            @unknown default:
                completion(["state": "notDetermined"])
            }
        }
    }

    func notificationSettings() -> Result<[String: Any], String> {
        // Open the app's notification settings in the Settings app. This mirrors Android's
        // ACTION_APP_NOTIFICATION_SETTINGS deep link. It does NOT imply any state; it only
        // navigates. Returns immediately (matches Kotlin's fire-and-forget resolve()).
        guard let url = URL(string: UIApplication.openSettingsURLString),
              UIApplication.shared.canOpenURL(url) else {
            return .failure("settings_unavailable")
        }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        return .success([:])
    }
}

// MARK: - 3. OAuth sign-in browser session
//
// Contract: BEHAVIOR_CONTRACTS.md §S3 "Auth" + services prompt item 4; D10 cancel-vs-race.
// Android uses a Chrome Custom Tab (AuthPlugin + AuthRedirect) with the reversed-client-ID
// scheme callback. iOS has no Custom Tab; the Apple-blessed equivalent is
// ASWebAuthenticationSession, which presents an in-app authentication view and delivers the
// callback URL back to a single continuation. The Rust/TS flow stays shared: `open_sign_in(url)`
// starts a session for the OAuth authorization URL, and `await_sign_in_redirect()` returns
// the full callback URL string (state+code). PKCE verifier/challenge, 32-byte base64url
// state, the 5-minute pending-flow deadline, and redirect/state validation all remain in
// Rust (`google_auth.rs` / `spotify_auth.rs`); this class does NOT parse or validate the
// redirect — it only transports the URL exactly as delivered.

/// Callback-scheme memo. Must match the scheme registered in CFBundleURLTypes in the
/// generated Info.plist. The Rust OAuth layer builds the `redirect_uri`, so this is only a
/// diagnostic/validation constant, not a source of truth.
enum HushioCallbackScheme {
    static let `default` = "com.hushio.app.iosdev"
}

final class AuthPlugin: NSObject {
    private var session: ASWebAuthenticationSession?

    /// Present the OAuth authorization URL and hold the session until the callback fires.
    /// `url` must be HTTPS (matches Kotlin's `invalid_url` reject otherwise).
    func authOpen(_ urlString: String, failure: @escaping (String) -> Void) {
        guard let url = URL(string: urlString), url.scheme?.lowercased() == "https" else {
            failure("invalid_url")
            return
        }
        // Cancel any in-flight session (mirrors AuthRedirect.cancel() in Kotlin) so a second
        // open_sign_in replaces the first rather than racing it.
        session?.cancel()
        session = nil

        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: HushioCallbackScheme.default,
            completionHandler: { [weak self] callbackURL, error in
                self?.session = nil
                if let error = error as NSError?,
                   error.domain == ASWebAuthenticationSessionErrorDomain,
                   error.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                    failure("cancelled")
                    return
                }
                if error != nil {
                    failure("cancelled")
                    return
                }
                guard let callbackURL = callbackURL else {
                    failure("cancelled")
                    return
                }
                // Deliver the full callback URL string (including scheme, query state/code).
                // Validation of state/PKCE happens in Rust's redirect reader; we do not trim
                // or reinterpret it here.
                UserDefaults.standard.set(callbackURL.absoluteString, forKey: "hushio.pendingRedirect")
                // The await_sign_in_redirect continuation consumes this via the shared store.
            })
        // iOS 12+ supports this; present from the key window's root view controller.
        session.presentationContextProvider = self
        self.session = session
        session.start()
    }

    /// Consume the last delivered redirect URL. Returns nil if no callback has arrived yet
    /// (the Rust await loop keeps waiting with its own 5-minute deadline — contract S3).
    func pendingRedirect() -> String? {
        return UserDefaults.standard.string(forKey: "hushio.pendingRedirect")
    }

    func clearPendingRedirect() {
        UserDefaults.standard.removeObject(forKey: "hushio.pendingRedirect")
    }
}

extension AuthPlugin: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Top-most key window; the app is foreground during sign-in. Uncompiled assumption:
        // the active UIWindowScene is reachable; on a plain app this is UIApplication's
        // connected scenes key window.
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let window = scenes.flatMap({ $0.windows }).first(where: { $0.isKeyWindow }) {
            return window
        }
        return scenes.first?.windows.first ?? ASPresentationAnchor()
    }
}

// MARK: - 4. Sync scheduling
//
// Contract: BEHAVIOR_CONTRACTS.md §S9 + services prompt item 5; lead addendum point 6.
// Android `schedule_retry` maps to WorkManager (SyncScheduler/SyncWorker), which can run on a
// periodic or opportunistic schedule. iOS has NO equivalent: BGTaskScheduler offers only
// BGAppRefreshTask/BGProcessingTask with the OS deciding *when* (often hours/days later, and
// only while the app is not force-quit). This class registers a BGAppRefreshTask with a
// descriptive identifier, but it MUST NOT report successful background scheduling as if it
// were WorkManager. The Rust `schedule_retry` wrapper returns Ok regardless (the non-Android
// stub returns Ok with no scheduling) — see SERVICES_INTEGRATION.md for the truthfulness note:
// the Rust layer must be updated (by the Rust agent) to distinguish "registered" from
// "guaranteed" and to not claim silent background sync.

enum HushioSyncTask {
    static let identifier = "com.hushio.app.iosdev.background-sync"

    /// Best-effort registration of a BGAppRefreshTask. Returns a real description of what
    /// happened; it is not a promise that any work will run.
    static func scheduleRetry() -> Result<[String: Any], String> {
        // BGTaskScheduler.submit requires the identifier to first be present in
        // Info.plist's BGTaskSchedulerPermittedIdentifiers. Registering here without that
        // plist key throws; we surface the real error rather than a fake Ok. The Rust agent
        // adds the plist key in SERVICES_INTEGRATION.md ordered steps.
        guard let plist = Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String],
              plist.contains(identifier) else {
            return .failure("bg_task_not_permitted")
        }
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)  // earliest 15 min; OS may defer
        do {
            try BGTaskScheduler.shared.submit(request)
            return .success(["scheduled": "best_effort"])
        } catch {
            return .failure("bg_task_submit_failed")
        }
    }
}

// MARK: - 5. In-app self-update (inapplicable on iOS)
//
// Android UpdatePlugin implements APK checksum download + install. On iOS there is no APK and
// no in-app install path; distribution is Xcode development signing (immediate target), then
// TestFlight/App Store (lead addendum point 6; PLATFORM_READINESS §6). We intentionally
// expose NO working-looking stub: the Rust `ios.rs` `update_*` commands must return a
// descriptive `not_supported`/`inapplicable` error (owned by the Rust agent), not a Swift
// class that pretends to check for updates. There is no UpdatePlugin class in this file.
