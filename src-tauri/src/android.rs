#[cfg(target_os = "android")]
mod bridge {
    use std::sync::OnceLock;

    use serde::Deserialize;
    use serde::de::DeserializeOwned;
    use serde_json::{Value, json};
    use tauri::plugin::PluginHandle;
    use tauri::{AppHandle, Manager, Wry};
    use tauri_plugin_hushio_player::AndroidBridges;

    use crate::tree_library::TreeItem;

    static APP: OnceLock<AppHandle<Wry>> = OnceLock::new();
    const NOT_READY: &str = "Android services are not ready yet.";

    #[derive(Clone, Copy)]
    pub enum Bridge {
        Secure,
        Media,
        Auth,
        Permission,
        Audio,
        Sync,
        Update,
    }

    #[derive(Deserialize)]
    struct PickedTree {
        uri: Option<String>,
    }

    #[derive(Deserialize)]
    struct TreeReply {
        items: Vec<TreeItem>,
    }

    #[derive(Deserialize)]
    struct SecretValue {
        value: Option<String>,
    }

    #[derive(Deserialize)]
    struct SidecarText {
        text: Option<String>,
    }

    #[derive(Deserialize)]
    struct PublishedUri {
        uri: String,
    }

    #[derive(Deserialize)]
    struct RedirectUrl {
        url: String,
    }

    pub fn init(app: &AppHandle<Wry>) {
        let _ = APP.set(app.clone());
    }

    pub fn app() -> Option<&'static AppHandle<Wry>> {
        APP.get()
    }

    pub fn schedule_retry() -> Result<(), String> {
        call::<Value>(Bridge::Sync, "schedule", json!({})).map(drop)
    }

    fn plugins() -> Result<tauri::State<'static, AndroidBridges<Wry>>, String> {
        let app = APP.get().ok_or_else(|| NOT_READY.to_owned())?;
        // `try_state`, not `state`: a missing manage must be a recoverable error, not an
        // abort. `AppHandle::state` panics and took the whole app down once already.
        app.try_state::<AndroidBridges<Wry>>()
            .ok_or_else(|| NOT_READY.to_owned())
    }

    fn pick<'a>(plugins: &'a AndroidBridges<Wry>, bridge: Bridge) -> Result<&'a PluginHandle<Wry>, String> {
        let slot = match bridge {
            Bridge::Secure => &plugins.secure,
            Bridge::Media => &plugins.media,
            Bridge::Auth => &plugins.auth,
            Bridge::Permission => &plugins.permission,
            Bridge::Audio => &plugins.audio,
            Bridge::Sync => &plugins.sync,
            Bridge::Update => &plugins.update,
        };
        slot.get().ok_or_else(|| NOT_READY.to_owned())
    }

    pub fn call<T: DeserializeOwned>(bridge: Bridge, command: &str, payload: Value) -> Result<T, String> {
        let plugins = plugins()?;
        pick(&plugins, bridge)?
            .run_mobile_plugin(command, payload)
            .map_err(|error| error.to_string())
    }

    pub async fn call_async<T: DeserializeOwned>(
        bridge: Bridge,
        command: &str,
        payload: Value,
    ) -> Result<T, String> {
        let plugins = plugins()?;
        pick(&plugins, bridge)?
            .run_mobile_plugin_async(command, payload)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn update(command: &str, payload: Value) -> Result<Value, String> {
        call_async(Bridge::Update, command, payload).await
    }

    pub async fn pick_tree() -> Result<Option<String>, String> {
        let reply: PickedTree = call_async(Bridge::Audio, "pick_tree", json!({})).await?;
        Ok(reply.uri)
    }

    pub fn scan_tree(uri: &str) -> Result<Vec<TreeItem>, String> {
        let reply: TreeReply = call(Bridge::Audio, "scan_tree", json!({ "uri": uri }))?;
        Ok(reply.items)
    }

    pub fn read_sidecar_lrc(uri: &str) -> Option<String> {
        call::<SidecarText>(Bridge::Audio, "read_sidecar_lrc", json!({ "uri": uri }))
            .ok()?
            .text
    }

    pub fn media_delete(uri: &str) -> Result<(), String> {
        call::<Value>(Bridge::Media, "media_store_delete", json!({ "uri": uri })).map(drop)
    }

    pub fn secret_read(key: &str) -> Result<Option<String>, String> {
        let reply: SecretValue = call(Bridge::Secure, "secure_get", json!({ "key": key }))?;
        Ok(reply.value)
    }

    pub fn secret_write(key: &str, value: &str) -> Result<(), String> {
        call::<Value>(Bridge::Secure, "secure_set", json!({ "key": key, "value": value })).map(drop)
    }

    pub fn secret_clear(key: &str) -> Result<(), String> {
        call::<Value>(Bridge::Secure, "secure_clear", json!({ "key": key })).map(drop)
    }

    pub async fn publish_download(path: &str, display_name: &str) -> Result<String, String> {
        let reply: PublishedUri = call_async(
            Bridge::Media,
            "media_store_publish",
            json!({ "path": path, "displayName": display_name }),
        )
        .await?;
        Ok(reply.uri)
    }

    pub fn open_sign_in(url: &str) -> Result<(), String> {
        call::<Value>(Bridge::Auth, "auth_open", json!({ "url": url })).map(drop)
    }

    pub async fn await_sign_in_redirect() -> Result<String, String> {
        let reply: RedirectUrl = call_async(Bridge::Auth, "auth_await", json!({})).await?;
        Ok(reply.url)
    }
}

#[cfg(all(target_os = "ios"))]
mod bridge {
    //! iOS implementation of the shared mobile bridge facade.
    //!
    //! Shared modules (`secrets.rs`, `google_auth.rs`, `spotify_auth.rs`, `downloads.rs`,
    //! `local_library`, `reveal.rs`, `tree_library.rs`, `lyrics`) all call
    //! `crate::android::*`. On iOS those calls land here and are forwarded to the Swift
    //! plugins registered under the same names Android uses (`hushio-secure`,
    //! `hushio-audio`, `hushio-media`, `hushio-auth`, `hushio-permission`, `hushio-sync`).
    //! Command names and payload shapes are identical, so no call site needs a branch.

    use std::sync::OnceLock;

    use serde::Deserialize;
    use serde::de::DeserializeOwned;
    use serde_json::{Value, json};
    use tauri::plugin::PluginHandle;
    use tauri::{AppHandle, Manager, Wry};
    use tauri_plugin_hushio_player::AndroidBridges;

    use crate::tree_library::TreeItem;

    // Notification reply shape declared at the module root; bring it into scope for the
    // `notification_*` wrappers below.
    use super::NotificationReply;

    static APP: OnceLock<AppHandle<Wry>> = OnceLock::new();
    const NOT_READY: &str = "iOS services are not ready yet.";

    #[derive(Clone, Copy)]
    pub enum Bridge {
        Secure,
        Media,
        Auth,
        Permission,
        Audio,
        Sync,
    }

    #[derive(Deserialize)]
    struct PickedTree {
        uri: Option<String>,
    }

    #[derive(Deserialize)]
    struct TreeReply {
        items: Vec<TreeItem>,
    }

    #[derive(Deserialize)]
    struct SecretValue {
        value: Option<String>,
    }

    #[derive(Deserialize)]
    struct SidecarText {
        text: Option<String>,
    }

    #[derive(Deserialize)]
    struct PublishedUri {
        uri: String,
    }

    #[derive(Deserialize)]
    struct RedirectUrl {
        url: String,
    }

    pub fn init(app: &AppHandle<Wry>) {
        let _ = APP.set(app.clone());
    }

    fn plugins() -> Result<tauri::State<'static, AndroidBridges<Wry>>, String> {
        let app = APP.get().ok_or_else(|| NOT_READY.to_owned())?;
        Ok(app.state::<AndroidBridges<Wry>>())
    }

    /// `PluginApi::register_ios_plugin` / `run_mobile_plugin` round-trips hop to the main
    /// thread and wait. A bridge call made while the main thread is still inside Tauri's
    /// `setup` therefore deadlocks: the window appears but the WKWebView never paints a
    /// frame (observed, and fixed by bounding every call).
    ///
    /// `BLOCKED` is set when a call times out and short-circuits every later call until one
    /// succeeds again, so startup pays the timeout at most once instead of once per probe.
    static BLOCKED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    const CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1500);

    fn mark_ok() {
        BLOCKED.store(false, std::sync::atomic::Ordering::Relaxed);
    }

    fn check_ready() -> Result<(), String> {
        if BLOCKED.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("iOS services are not ready yet.".to_owned());
        }
        Ok(())
    }

    /// Blocking bridge call with a hard ceiling, used by the synchronous shared call
    /// sites (secrets, tree scan, sign-in open, media delete) which run during startup.
    ///
    /// Deliberately does NOT use `block_on`: releasing a build can reach this from inside
    /// an existing Tokio runtime context and `Runtime::block_on` panics there (observed as
    /// a launch abort). Spawning the work and waiting on a channel with a timeout is safe
    /// from any thread.
    fn call_bounded<T: DeserializeOwned + Send + 'static>(
        command: &'static str,
        payload: Value,
    ) -> Result<T, String> {
        check_ready()?;
        let handle = handle()?;
        let (tx, rx) = std::sync::mpsc::channel();
        tauri::async_runtime::spawn(async move {
            let outcome = handle
                .run_mobile_plugin_async::<T>(command, payload)
                .await
                .map_err(|error| error.to_string());
            let _ = tx.send(outcome);
        });
        match rx.recv_timeout(CALL_TIMEOUT) {
            Ok(Ok(value)) => {
                mark_ok();
                Ok(value)
            }
            Ok(Err(error)) => Err(error),
            Err(_) => {
                BLOCKED.store(true, std::sync::atomic::Ordering::Relaxed);
                tracing::debug!("iOS bridge {command} timed out; deferring further calls");
                Err("timeout".to_owned())
            }
        }
    }

    /// Async bridge call with the same ceiling (no `block_on`, so it is safe inside a
    /// running runtime).
    async fn call_async_bounded<T: DeserializeOwned>(
        command: &'static str,
        payload: Value,
    ) -> Result<T, String> {
        check_ready()?;
        let handle = handle()?;
        match tokio::time::timeout(
            CALL_TIMEOUT,
            handle.run_mobile_plugin_async::<T>(command, payload),
        )
        .await
        {
            Ok(Ok(value)) => {
                mark_ok();
                Ok(value)
            }
            Ok(Err(error)) => Err(error.to_string()),
            Err(_) => {
                BLOCKED.store(true, std::sync::atomic::Ordering::Relaxed);
                Err("timeout".to_owned())
            }
        }
    }

    /// The single registered iOS plugin carries every bridge; `player` is its handle.
    /// Returns an owned clone so callers do not borrow the app state guard.
    fn handle() -> Result<PluginHandle<Wry>, String> {
        let app = APP.get().ok_or_else(|| NOT_READY.to_owned())?;
        let state = app
            .try_state::<AndroidBridges<Wry>>()
            .ok_or_else(|| NOT_READY.to_owned())?;
        state.player.get().cloned().ok_or_else(|| NOT_READY.to_owned())
    }

    pub async fn schedule_retry() -> Result<(), String> {
        call_async_bounded::<Value>("schedule", json!({})).await.map(drop)
    }

    pub async fn pick_tree() -> Result<Option<String>, String> {
        let reply: PickedTree = call_async_bounded("pick_tree", json!({})).await?;
        Ok(reply.uri)
    }

    pub fn scan_tree(uri: &str) -> Result<Vec<TreeItem>, String> {
        let reply: TreeReply = call_bounded("scan_tree", json!({ "uri": uri }))?;
        Ok(reply.items)
    }

    pub fn read_sidecar_lrc(uri: &str) -> Option<String> {
        call_bounded::<SidecarText>("read_sidecar_lrc", json!({ "uri": uri }))
            .ok()?
            .text
    }

    pub fn media_delete(uri: &str) -> Result<(), String> {
        call_bounded::<Value>("media_store_delete", json!({ "uri": uri })).map(drop)
    }

    pub fn secret_read(key: &str) -> Result<Option<String>, String> {
        let reply: SecretValue = call_bounded("secure_get", json!({ "key": key }))?;
        Ok(reply.value)
    }

    pub fn secret_write(key: &str, value: &str) -> Result<(), String> {
        call_bounded::<Value>("secure_set", json!({ "key": key, "value": value })).map(drop)
    }

    pub fn secret_clear(key: &str) -> Result<(), String> {
        call_bounded::<Value>("secure_clear", json!({ "key": key })).map(drop)
    }

    pub async fn publish_download(path: &str, display_name: &str) -> Result<String, String> {
        let reply: PublishedUri = call_async_bounded(
            "media_store_publish",
            json!({ "path": path, "displayName": display_name }),
        )
        .await?;
        Ok(reply.uri)
    }

    pub fn open_sign_in(url: &str) -> Result<(), String> {
        call_bounded::<Value>("auth_open", json!({ "url": url })).map(drop)
    }

    pub async fn await_sign_in_redirect() -> Result<String, String> {
        let reply: RedirectUrl = call_async_bounded("auth_await", json!({})).await?;
        Ok(reply.url)
    }

    /// Notification permission state from the Swift `notification_state` selector, which
    /// maps a real `UNAuthorizationStatus` (notDetermined/denied/authorized/provisional/
    /// ephemeral). Never synthesises `granted`: a bridge failure is returned as an error.
    pub fn notification_state() -> Result<String, String> {
        call_bounded::<NotificationReply>("notification_state", json!({}))
            .map(|reply| reply.state)
    }

    /// Re-reads the real OS decision after any first-time authorization prompt.
    pub async fn notification_request() -> Result<String, String> {
        call_async_bounded::<NotificationReply>("notification_request", json!({}))
            .await
            .map(|reply| reply.state)
    }

    /// Opens this app's notification settings; the Swift side rejects when it cannot.
    pub fn notification_settings() -> Result<(), String> {
        call_bounded::<Value>("notification_settings", json!({})).map(drop)
    }

    pub async fn update(command: &str, _payload: Value) -> Result<Value, String> {
        // In-app APK self-update is Android-only. iOS distribution is Xcode development
        // signing / TestFlight / App Store, so there is no update bridge to call.
        Err(format!("{command} is not supported on iOS"))
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[allow(dead_code)]
mod bridge {
    // Phase-B temporary dispatch point. On iOS this branch is superseded by crate::ios (see
    // src/ios.rs); the `Err("Android services are only available on Android.")` responses
    // below are NOT an iOS capability. Phase C/D replaces secrets/files/auth on iOS via the
    // Swift bridges registered in tauri-plugin-hushio-player, not via this module.
    const NOT_ANDROID: &str = "Android services are only available on Android.";

    pub fn init(_app: &tauri::AppHandle<tauri::Wry>) {}

    pub fn schedule_retry() -> Result<(), String> {
        Ok(())
    }

    pub async fn pick_tree() -> Result<Option<String>, String> {
        Err(NOT_ANDROID.to_owned())
    }

    pub fn scan_tree(_uri: &str) -> Result<Vec<crate::tree_library::TreeItem>, String> {
        Err(NOT_ANDROID.to_owned())
    }

    pub fn read_sidecar_lrc(_uri: &str) -> Option<String> {
        None
    }

    pub fn media_delete(_uri: &str) -> Result<(), String> {
        Err(NOT_ANDROID.to_owned())
    }

    pub fn secret_read(_key: &str) -> Result<Option<String>, String> {
        Err(NOT_ANDROID.to_owned())
    }

    pub fn secret_write(_key: &str, _value: &str) -> Result<(), String> {
        Err(NOT_ANDROID.to_owned())
    }

    pub fn secret_clear(_key: &str) -> Result<(), String> {
        Err(NOT_ANDROID.to_owned())
    }

    pub async fn publish_download(_path: &str, _display_name: &str) -> Result<String, String> {
        Err(NOT_ANDROID.to_owned())
    }

    pub fn open_sign_in(_url: &str) -> Result<(), String> {
        Err(NOT_ANDROID.to_owned())
    }

    pub async fn await_sign_in_redirect() -> Result<String, String> {
        Err(NOT_ANDROID.to_owned())
    }

    pub async fn update(_command: &str, _payload: serde_json::Value) -> Result<serde_json::Value, String> {
        Err(NOT_ANDROID.to_owned())
    }
}

pub use bridge::*;

#[tauri::command]
pub async fn update_check(current: String) -> Result<serde_json::Value, String> {
    bridge::update("update_check", serde_json::json!({ "current": current })).await
}

#[tauri::command]
pub async fn update_download(
    apk_name: String,
    apk_url: String,
    sums_url: String,
) -> Result<serde_json::Value, String> {
    bridge::update(
        "update_download",
        serde_json::json!({ "apkName": apk_name, "apkUrl": apk_url, "sumsUrl": sums_url }),
    )
    .await
}

#[tauri::command]
pub async fn update_install(path: String) -> Result<serde_json::Value, String> {
    bridge::update("update_install", serde_json::json!({ "path": path })).await
}

#[tauri::command]
pub async fn update_open_install_settings() -> Result<serde_json::Value, String> {
    bridge::update("update_open_install_settings", serde_json::json!({})).await
}

#[derive(serde::Deserialize)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct NotificationReply {
    state: String,
}

#[cfg(target_os = "android")]
pub fn notification_state() -> Result<String, String> {
    bridge::call::<NotificationReply>(bridge::Bridge::Permission, "notification_state", serde_json::json!({}))
        .map(|reply| reply.state)
}

#[cfg(target_os = "android")]
pub async fn notification_request() -> Result<String, String> {
    bridge::call_async::<NotificationReply>(bridge::Bridge::Permission, "notification_request", serde_json::json!({}))
        .await
        .map(|reply| reply.state)
}

#[cfg(target_os = "android")]
pub fn notification_settings() -> Result<(), String> {
    bridge::call::<serde_json::Value>(bridge::Bridge::Permission, "notification_settings", serde_json::json!({}))
        .map(drop)
}

#[cfg(target_os = "ios")]
pub fn notification_state() -> Result<String, String> {
    bridge::notification_state()
}

#[cfg(target_os = "ios")]
pub async fn notification_request() -> Result<String, String> {
    bridge::notification_request().await
}

#[cfg(target_os = "ios")]
pub fn notification_settings() -> Result<(), String> {
    bridge::notification_settings()
}

// Desktop platforms have no notification bridge in this app (the Android and iOS
// implementations live in their own modules). This pre-existing stub is unchanged by the
// iOS port and is NOT a claim that desktop notification permissions work; it is recorded
// in BLOCKERS.md as a desktop-scope question rather than silently treated as parity.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn notification_state() -> Result<String, String> {
    Ok("granted".to_owned())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn notification_request() -> Result<String, String> {
    Ok("granted".to_owned())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn notification_settings() -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    #[test]
    fn sidecar_lrc_is_never_read_off_android() {
        assert_eq!(super::read_sidecar_lrc("content://x/document/primary%3AMusic%2FSong.mp3"), None);
    }
}
