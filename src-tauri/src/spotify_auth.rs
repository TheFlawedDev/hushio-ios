use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::APP_NAME;
use crate::google_auth::{
    Browser, Callback, RedirectFuture, SecretStore, StoreResult, bind_loopback, code_challenge, error_code,
    form_body, is_fresh, now_secs, random_state, random_verifier, redirect_uri, respond, wait_for_redirect,
};

pub const CLIENT_ID: &str = match option_env!("HUSHIO_SPOTIFY_CLIENT_ID") {
    Some(value) => value,
    None => "",
};

pub const TOKEN_SLOT: &str = "spotify-refresh-token";
pub const SCOPES: &str = "playlist-read-private playlist-read-collaborative user-library-read";

const AUTH_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const ME_URL: &str = "https://api.spotify.com/v1/me";
const ANDROID_SCHEME: &str = "hushio-spotify";
/// iOS uses the same dedicated scheme; it is registered in `Info.ios.plist`.
const IOS_SCHEME: &str = "hushio-spotify";
const APP_REDIRECT_PATH: &str = ":/callback";
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

const MSG_DIDNT_COMPLETE: &str = "Spotify sign-in didn't complete.";
const MSG_TIMED_OUT: &str = "Spotify sign-in timed out. Please try again.";
const MSG_NO_BROWSER: &str = "Could not open the sign-in browser.";
const MSG_NETWORK: &str = "Couldn't connect right now. Check your connection and try again.";
const MSG_EXPIRED: &str = "Sign-in expired. Please try again.";
const MSG_NO_REFRESH: &str = "Spotify didn't return a long-term sign-in. Try again.";
const MSG_NOT_CONFIGURED: &str = "Spotify sign-in isn't set up in this build.";
const MSG_ALREADY_PENDING: &str = "Finish signing in with Spotify in your browser.";
const MSG_CANCELLED: &str = "Sign-in cancelled.";
const MSG_SIGNED_OUT: &str = "Connect your Spotify account first.";
const MSG_SAVE: &str = "Couldn't save your Spotify sign-in on this computer. Check that the app data folder is writable.";

#[derive(Clone)]
pub struct OAuthConfig {
    pub client_id: String,
    pub auth_url: String,
    pub token_url: String,
    pub me_url: String,
    pub sign_in_timeout: Duration,
    pub memory_fallback: bool,
}

impl OAuthConfig {
    pub fn production() -> Self {
        Self {
            client_id: CLIENT_ID.to_owned(),
            auth_url: AUTH_URL.to_owned(),
            token_url: TOKEN_URL.to_owned(),
            me_url: ME_URL.to_owned(),
            sign_in_timeout: SIGN_IN_TIMEOUT,
            memory_fallback: cfg!(target_os = "linux"),
        }
    }
}

pub struct SpotifyBrowser(pub AppHandle);

impl Browser for SpotifyBrowser {
    fn open(&self, url: &str) -> StoreResult<()> {
        if cfg!(any(target_os = "android", target_os = "ios")) {
            return crate::android::open_sign_in(url);
        }
        self.0
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|error| error.to_string())
    }

    fn redirect_scheme(&self) -> Option<String> {
        if cfg!(target_os = "android") {
            Some(ANDROID_SCHEME.to_owned())
        } else if cfg!(target_os = "ios") {
            Some(IOS_SCHEME.to_owned())
        } else {
            None
        }
    }

    fn await_redirect(&self) -> RedirectFuture<'_> {
        Box::pin(async {
            crate::android::await_sign_in_redirect()
                .await
                .map_err(|_| MSG_CANCELLED.to_owned())
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyAccount {
    pub configured: bool,
    pub signed_in: bool,
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct StoredSession {
    refresh_token: String,
    name: Option<String>,
}

#[derive(Clone)]
struct AccessToken {
    value: String,
    expires_at: i64,
}

struct Session {
    name: Option<String>,
    access: Option<AccessToken>,
    refresh_token: String,
}

#[derive(Default)]
struct Inner {
    session: Option<Session>,
    loaded: bool,
    pending: bool,
}

pub struct SpotifyAuth {
    config: OAuthConfig,
    store: Arc<dyn SecretStore>,
    http: reqwest::Client,
    inner: Mutex<Inner>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: i64,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct Profile {
    id: String,
    display_name: Option<String>,
}

enum Refresh {
    Ok {
        access: AccessToken,
        rotated: Option<String>,
    },
    Retry,
    Rejected,
}

struct Reply {
    status: u16,
    ok: bool,
    body: String,
}

struct PendingGuard<'a>(&'a SpotifyAuth);

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.0.lock().pending = false;
    }
}

impl SpotifyAuth {
    pub fn new(config: OAuthConfig, store: Arc<dyn SecretStore>) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(crate::stream::USER_AGENT)
            .timeout(HTTP_TIMEOUT)
            .build()
            .unwrap_or_default();
        Self {
            config,
            store,
            http,
            inner: Mutex::new(Inner::default()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn ensure_loaded(&self) {
        let mut inner = self.lock();
        if inner.loaded {
            return;
        }
        inner.loaded = true;
        let Ok(Some(raw)) = self.store.read() else {
            return;
        };
        match serde_json::from_str::<StoredSession>(&raw) {
            Ok(stored) => {
                inner.session = Some(Session {
                    name: stored.name,
                    access: None,
                    refresh_token: stored.refresh_token,
                });
            }
            Err(error) => tracing::warn!(%error, "stored Spotify session is unreadable"),
        }
    }

    pub fn account(&self) -> SpotifyAccount {
        self.ensure_loaded();
        let inner = self.lock();
        SpotifyAccount {
            configured: !self.config.client_id.is_empty(),
            signed_in: inner.session.is_some(),
            name: inner.session.as_ref().and_then(|session| session.name.clone()),
        }
    }

    fn begin(&self) -> Result<(), String> {
        let mut inner = self.lock();
        if inner.pending {
            return Err(MSG_ALREADY_PENDING.to_owned());
        }
        inner.pending = true;
        Ok(())
    }

    pub async fn sign_in(&self, browser: &dyn Browser) -> Result<SpotifyAccount, String> {
        if self.config.client_id.is_empty() {
            return Err(MSG_NOT_CONFIGURED.to_owned());
        }
        self.begin()?;
        let _pending = PendingGuard(self);

        let verifier = random_verifier();
        let state = random_state();
        let (listener, redirect) = match browser.redirect_scheme() {
            Some(scheme) => (None, format!("{scheme}{APP_REDIRECT_PATH}")),
            None => {
                let (listener, port) = bind_loopback()
                    .await
                    .map_err(|_| MSG_DIDNT_COMPLETE.to_owned())?;
                (Some(listener), redirect_uri(port))
            }
        };
        let url = authorization_url(&self.config, &redirect, &code_challenge(&verifier), &state);
        browser.open(&url).map_err(|_| MSG_NO_BROWSER.to_owned())?;

        let callback = tokio::time::timeout(
            self.config.sign_in_timeout,
            wait_for_redirect(listener.as_ref(), browser, &state),
        )
        .await
        .map_err(|_| MSG_TIMED_OUT.to_owned())??;

        let Callback { code, stream } = callback;
        let outcome = self.complete(&code, &verifier, &redirect).await;
        if let Some(mut stream) = stream {
            let page = if outcome.is_ok() { success_page() } else { error_page() };
            respond(&mut stream, "200 OK", &page).await;
        }
        outcome
    }

    async fn complete(&self, code: &str, verifier: &str, redirect: &str) -> Result<SpotifyAccount, String> {
        let token = self.exchange(code, verifier, redirect).await?;
        let refresh_token = token
            .refresh_token
            .clone()
            .ok_or_else(|| MSG_NO_REFRESH.to_owned())?;
        let profile = self
            .profile(&token.access_token)
            .await
            .ok_or_else(|| MSG_DIDNT_COMPLETE.to_owned())?;
        let session = Session {
            name: profile.display_name.filter(|name| !name.is_empty()).or(Some(profile.id)),
            access: Some(AccessToken {
                value: token.access_token,
                expires_at: now_secs() + token.expires_in,
            }),
            refresh_token,
        };
        if self.persist(&session).is_err() && !self.config.memory_fallback {
            return Err(MSG_SAVE.to_owned());
        }
        {
            let mut inner = self.lock();
            inner.loaded = true;
            inner.session = Some(session);
        }
        Ok(self.account())
    }

    pub async fn access_token(&self) -> Result<String, String> {
        self.ensure_loaded();
        let refresh_token = {
            let inner = self.lock();
            let session = inner.session.as_ref().ok_or_else(|| MSG_SIGNED_OUT.to_owned())?;
            if let Some(token) = &session.access {
                if is_fresh(token.expires_at, now_secs()) {
                    return Ok(token.value.clone());
                }
            }
            session.refresh_token.clone()
        };
        match self.refresh(&refresh_token).await {
            Refresh::Ok { access, rotated } => {
                let value = access.value.clone();
                let mut inner = self.lock();
                if let Some(session) = inner.session.as_mut() {
                    session.access = Some(access);
                    if let Some(next) = rotated {
                        session.refresh_token = next;
                        if let Err(error) = self.persist(session) {
                            tracing::warn!(%error, "could not store the rotated Spotify token");
                        }
                    }
                }
                Ok(value)
            }
            Refresh::Retry => Err(MSG_NETWORK.to_owned()),
            Refresh::Rejected => {
                self.forget();
                Err(MSG_SIGNED_OUT.to_owned())
            }
        }
    }

    async fn refresh(&self, refresh_token: &str) -> Refresh {
        let Some(reply) = self
            .post_form(
                &self.config.token_url,
                &[
                    ("grant_type", "refresh_token"),
                    ("refresh_token", refresh_token),
                    ("client_id", self.config.client_id.as_str()),
                ],
            )
            .await
        else {
            return Refresh::Retry;
        };
        if reply.status == 400 || reply.status == 401 {
            return Refresh::Rejected;
        }
        if !reply.ok {
            return Refresh::Retry;
        }
        match serde_json::from_str::<TokenResponse>(&reply.body) {
            Ok(token) => Refresh::Ok {
                access: AccessToken {
                    value: token.access_token,
                    expires_at: now_secs() + token.expires_in,
                },
                rotated: token.refresh_token,
            },
            Err(_) => Refresh::Retry,
        }
    }

    async fn exchange(&self, code: &str, verifier: &str, redirect: &str) -> Result<TokenResponse, String> {
        let reply = self
            .post_form(
                &self.config.token_url,
                &[
                    ("grant_type", "authorization_code"),
                    ("code", code),
                    ("redirect_uri", redirect),
                    ("client_id", self.config.client_id.as_str()),
                    ("code_verifier", verifier),
                ],
            )
            .await
            .ok_or_else(|| MSG_NETWORK.to_owned())?;
        if reply.ok {
            return serde_json::from_str::<TokenResponse>(&reply.body)
                .map_err(|_| MSG_DIDNT_COMPLETE.to_owned());
        }
        if error_code(&reply.body).as_deref() == Some("invalid_grant") {
            Err(MSG_EXPIRED.to_owned())
        } else {
            Err(MSG_DIDNT_COMPLETE.to_owned())
        }
    }

    async fn profile(&self, access_token: &str) -> Option<Profile> {
        let response = self
            .http
            .get(&self.config.me_url)
            .bearer_auth(access_token)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.json::<Profile>().await.ok()
    }

    async fn post_form(&self, url: &str, fields: &[(&str, &str)]) -> Option<Reply> {
        let response = self
            .http
            .post(url)
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(form_body(fields))
            .send()
            .await
            .ok()?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Some(Reply {
            status: status.as_u16(),
            ok: status.is_success(),
            body,
        })
    }

    fn persist(&self, session: &Session) -> StoreResult<()> {
        let stored = StoredSession {
            refresh_token: session.refresh_token.clone(),
            name: session.name.clone(),
        };
        let raw = serde_json::to_string(&stored).map_err(|error| error.to_string())?;
        self.store.write(&raw)
    }

    fn forget(&self) {
        self.lock().session = None;
        if let Err(error) = self.store.clear() {
            tracing::warn!(%error, "could not delete the stored Spotify sign-in");
        }
    }

    pub fn sign_out(&self) -> SpotifyAccount {
        self.forget();
        self.account()
    }
}

fn authorization_url(config: &OAuthConfig, redirect: &str, challenge: &str, state: &str) -> String {
    let query = form_body(&[
        ("client_id", config.client_id.as_str()),
        ("response_type", "code"),
        ("redirect_uri", redirect),
        ("scope", SCOPES),
        ("code_challenge_method", "S256"),
        ("code_challenge", challenge),
        ("state", state),
    ]);
    format!("{}?{query}", config.auth_url)
}

fn success_page() -> String {
    format!("Spotify is connected to {APP_NAME}. You can close this tab.")
}

fn error_page() -> String {
    format!("Spotify sign-in didn't complete. You can close this tab and try again in {APP_NAME}.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use url::Url;

    #[derive(Default)]
    struct MemoryStore(Mutex<Option<String>>);

    impl MemoryStore {
        fn with(raw: &str) -> Self {
            Self(Mutex::new(Some(raw.to_owned())))
        }

        fn saved(&self) -> Option<String> {
            self.0.lock().unwrap().clone()
        }
    }

    impl SecretStore for MemoryStore {
        fn read(&self) -> StoreResult<Option<String>> {
            Ok(self.0.lock().unwrap().clone())
        }

        fn write(&self, value: &str) -> StoreResult<()> {
            *self.0.lock().unwrap() = Some(value.to_owned());
            Ok(())
        }

        fn clear(&self) -> StoreResult<()> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    struct NoBrowser;

    impl Browser for NoBrowser {
        fn open(&self, _: &str) -> StoreResult<()> {
            panic!("the browser must not open");
        }
    }

    fn config() -> OAuthConfig {
        OAuthConfig {
            client_id: "spotify-client".to_owned(),
            auth_url: "https://accounts.test/authorize".to_owned(),
            token_url: "https://accounts.test/api/token".to_owned(),
            me_url: "https://api.test/v1/me".to_owned(),
            sign_in_timeout: Duration::from_secs(5),
            memory_fallback: false,
        }
    }

    #[test]
    fn rfc7636_challenge_vector() {
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_meets_the_pkce_length_and_charset() {
        let verifier = random_verifier();
        assert!((43..=128).contains(&verifier.len()));
        assert!(verifier.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-._~".contains(&byte)));
        assert_ne!(verifier, random_verifier());
    }

    #[test]
    fn authorization_url_carries_pkce_and_only_the_library_scopes() {
        let url = authorization_url(&config(), "hushio-spotify:/callback", "chal", "st");
        let parsed = Url::parse(&url).unwrap();
        assert_eq!(parsed.origin().ascii_serialization(), "https://accounts.test");
        assert_eq!(parsed.path(), "/authorize");
        let query: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
        assert_eq!(query["client_id"], "spotify-client");
        assert_eq!(query["response_type"], "code");
        assert_eq!(query["redirect_uri"], "hushio-spotify:/callback");
        assert_eq!(query["code_challenge"], "chal");
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["state"], "st");
        assert_eq!(query["scope"], "playlist-read-private playlist-read-collaborative user-library-read");
        assert_eq!(query.len(), 7);
        assert!(!query.contains_key("client_secret"));
    }

    #[test]
    fn scopes_are_exactly_the_three_library_scopes() {
        assert_eq!(SCOPES.split_whitespace().count(), 3);
        assert!(SCOPES.contains("playlist-read-private"));
        assert!(SCOPES.contains("playlist-read-collaborative"));
        assert!(SCOPES.contains("user-library-read"));
    }

    #[test]
    fn android_redirect_is_the_manifest_scheme_and_path() {
        assert_eq!(format!("{ANDROID_SCHEME}{APP_REDIRECT_PATH}"), "hushio-spotify:/callback");
    }

    #[tokio::test]
    async fn sign_in_without_client_id_never_opens_the_browser() {
        let mut settings = config();
        settings.client_id = String::new();
        let auth = SpotifyAuth::new(settings, Arc::new(MemoryStore::default()));
        assert_eq!(auth.sign_in(&NoBrowser).await, Err(MSG_NOT_CONFIGURED.to_owned()));
        assert!(!auth.account().configured);
    }

    #[test]
    fn stored_session_is_read_without_the_network() {
        let store = Arc::new(MemoryStore::with(r#"{"refresh_token":"r-1","name":"Ada"}"#));
        let auth = SpotifyAuth::new(config(), store);
        let account = auth.account();
        assert!(account.configured);
        assert!(account.signed_in);
        assert_eq!(account.name.as_deref(), Some("Ada"));
    }

    #[test]
    fn sign_out_forgets_the_session_and_the_stored_secret() {
        let store = Arc::new(MemoryStore::with(r#"{"refresh_token":"r-1","name":null}"#));
        let auth = SpotifyAuth::new(config(), store.clone());
        let account = auth.sign_out();
        assert!(!account.signed_in);
        assert!(store.saved().is_none());
    }
}
