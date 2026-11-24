//! iOS-only constants shared by the auth flows.
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
