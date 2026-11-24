#[cfg(any(target_os = "android", target_os = "ios"))]
use std::sync::OnceLock;

use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::{Manager, plugin::PluginHandle};

#[cfg(target_os = "android")]
const PACKAGE: &str = "com.hushio.player";

// The bridge handle set is shared by both mobile platforms: on Android the handles wrap
// Kotlin classes (`register_android_plugin`), on iOS they wrap the Swift plugin instances
// (`register_ios_plugin`). The shared facade in src/android.rs dispatches through the same
// `run_mobile_plugin` call on both.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub struct AndroidBridges<R: Runtime> {
    /// iOS: the single registered plugin instance carries the player AND the service
    /// bridges (see the comment on `plugins()`), so one handle serves every command.
    pub player: OnceLock<PluginHandle<R>>,
    pub secure: OnceLock<PluginHandle<R>>,
    pub media: OnceLock<PluginHandle<R>>,
    pub auth: OnceLock<PluginHandle<R>>,
    pub permission: OnceLock<PluginHandle<R>>,
    pub audio: OnceLock<PluginHandle<R>>,
    pub sync: OnceLock<PluginHandle<R>>,
    pub update: OnceLock<PluginHandle<R>>,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
impl<R: Runtime> Default for AndroidBridges<R> {
    fn default() -> Self {
        Self {
            player: OnceLock::new(),
            secure: OnceLock::new(),
            media: OnceLock::new(),
            auth: OnceLock::new(),
            permission: OnceLock::new(),
            audio: OnceLock::new(),
            sync: OnceLock::new(),
            update: OnceLock::new(),
        }
    }
}

#[cfg(target_os = "android")]
macro_rules! bridge_plugin {
    ($name:literal, $class:literal, $field:ident) => {
        Builder::new($name)
            .setup(|app, api| {
                let handle = api.register_android_plugin(PACKAGE, $class)?;
                app.manage(AndroidBridges::<R>::default());
                let _ = app.state::<AndroidBridges<R>>().$field.set(handle);
                Ok(())
            })
            .build()
    };
}

#[cfg(target_os = "android")]
pub fn plugins<R: Runtime>() -> Vec<TauriPlugin<R>> {
    vec![
        Builder::new("hushio-player")
            .setup(|_app, api| {
                api.register_android_plugin(PACKAGE, "PlayerPlugin")?;
                Ok(())
            })
            .build(),
        bridge_plugin!("hushio-secure", "SecurePlugin", secure),
        bridge_plugin!("hushio-media", "MediaStorePlugin", media),
        bridge_plugin!("hushio-auth", "AuthPlugin", auth),
        bridge_plugin!("hushio-permission", "PermissionPlugin", permission),
        bridge_plugin!("hushio-audio", "LocalAudioPlugin", audio),
        bridge_plugin!("hushio-sync", "SyncPlugin", sync),
        bridge_plugin!("hushio-update", "UpdatePlugin", update),
    ]
}

// iOS branch: register the Swift plugin so the command surface links on iOS.
// The Swift package (ios/Sources) is compiled via the plugin's SPM package and exports
// one init symbol per bridge (playback + the Phase D service bridges).
//
// The plugin NAMES deliberately mirror Android's (`hushio-secure`, `hushio-audio`, …) so
// the shared Rust facade in `src-tauri/src/android.rs` can dispatch to the same command
// names on both platforms with no branch at any call site.
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_hushio_player);

#[cfg(target_os = "ios")]
pub fn plugins<R: Runtime>() -> Vec<TauriPlugin<R>> {
    // ONE registration for the whole iOS surface.
    //
    // `PluginApi::register_ios_plugin` blocks until the webview answers on the main thread.
    // Registering seven separate plugins (one per Android bridge name) during startup
    // deadlocked the main thread: the window appeared but the WKWebView never painted a
    // frame. Verified by bisect — one registration renders the full phone UI, seven leave
    // it blank. The Swift side therefore exposes every selector (player + secure + audio +
    // media + auth + permission + sync) on this single instance, and the shared facade in
    // `src/android.rs` routes all of them through this one handle.
    vec![Builder::new("hushio-player")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_hushio_player)?;
            if app.try_state::<AndroidBridges<R>>().is_none() {
                app.manage(AndroidBridges::<R>::default());
            }
            let _ = app.state::<AndroidBridges<R>>().player.set(handle);
            Ok(())
        })
        .build()]
}

// Non-Android, non-iOS (desktop) branch: a single empty `hushio-player` plugin. Desktop
// playback uses the Rust mpv engine (src-tauri/src/playback.rs), not this plugin, so the
// command surface only needs to exist.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn plugins<R: Runtime>() -> Vec<TauriPlugin<R>> {
    vec![Builder::new("hushio-player").build()]
}
