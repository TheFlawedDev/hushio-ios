//! iOS-only constants shared by the auth and deep-link routing flows.
//!
//! The ASWebAuthenticationSession callback scheme must match the scheme the redirect URI
//! is built from, otherwise the browser session can never complete. It is the app's bundle
//! identifier (see `tauri.ios.conf.json`), which is also what `Info.ios.plist` registers
//! under `CFBundleURLTypes`.

/// Registered in `Info.ios.plist` → `CFBundleURLSchemes`, and returned by
/// `google_auth::SystemBrowser::redirect_scheme` on iOS so the redirect URI becomes
/// `com.hushio.app.iosdev:/oauth2redirect` (the same `<scheme>:/oauth2redirect` shape
/// Android uses via `RedirectUri.PATH`).
pub const REDIRECT_SCHEME: &str = "com.hushio.app.iosdev";

/// The app custom URL scheme registered in `Info.ios.plist` and configured in
/// `tauri.ios.conf.json` for deep linking and playlist routing (`hushio://...`).
/// Matches `crate::launch::SCHEME`.
pub const APP_SCHEME: &str = "hushio";

/// Spotify OAuth redirect custom URL scheme registered in `Info.ios.plist`.
pub const SPOTIFY_SCHEME: &str = "hushio-spotify";
