use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::{Rng, RngCore};
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::APP_NAME;
#[cfg(desktop)]
use crate::APP_SLUG;

pub const GOOGLE_CLIENT_ID: &str = match option_env!("HUSHIO_GOOGLE_CLIENT_ID") {
    Some(value) => value,
    None => "",
};

pub const GOOGLE_CLIENT_SECRET: &str = match option_env!("HUSHIO_GOOGLE_CLIENT_SECRET") {
    Some(value) => value,
    None => "",
};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const YOUTUBE_SCOPE: &str = "https://www.googleapis.com/auth/youtube";
const SCOPES: &str = "openid email profile https://www.googleapis.com/auth/youtube";
const CALLBACK_PATH: &str = "/callback";
const APP_REDIRECT_PATH: &str = ":/oauth2redirect";
const VERIFIER_LEN: usize = 64;
const VERIFIER_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
const STATE_BYTES: usize = 32;
const MAX_CODE_LEN: usize = 512;
const MAX_ERROR_LEN: usize = 300;
pub(crate) const REFRESH_LEEWAY_SECS: i64 = 60;
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
pub const REFRESH_RETRY: Duration = Duration::from_secs(30);
const KEYRING_ACCOUNT: &str = "google-refresh-token";

const MSG_DIDNT_COMPLETE: &str = "Google sign-in didn't complete.";
const MSG_TIMED_OUT: &str = "Google sign-in timed out. Please try again.";
const MSG_NO_BROWSER: &str = "Could not open the sign-in browser.";
const MSG_NETWORK: &str = "Couldn't connect right now. Check your connection and try again.";
const MSG_EXPIRED: &str = "Sign-in expired. Please try again.";
const MSG_NO_REFRESH: &str = "Google didn't return a long-term sign-in. Try again.";
const MSG_NOT_CONFIGURED: &str = "Google sign-in isn't set up in this build.";
const MSG_ALREADY_PENDING: &str = "Finish signing in with Google in your browser.";
const MSG_CANCELLED: &str = "Sign-in cancelled.";
const MSG_REJECTED: &str = "Google didn't accept the request. Sign in again, then retry.";

pub type StoreResult<T> = Result<T, String>;

#[derive(Debug, PartialEq, Eq)]
pub enum TokenError {
    SignedOut,
    Retry,
}

pub trait SecretStore: Send + Sync {
    fn read(&self) -> StoreResult<Option<String>>;
    fn write(&self, value: &str) -> StoreResult<()>;
    fn clear(&self) -> StoreResult<()>;
}

pub struct KeyringStore;

pub struct KeyringSlot(pub String);

#[cfg(desktop)]
fn keyring_entry(account: &str) -> StoreResult<keyring::Entry> {
    keyring::Entry::new(&keyring_service(), account).map_err(|error| error.to_string())
}

#[cfg(not(desktop))]
impl SecretStore for KeyringSlot {
    fn read(&self) -> StoreResult<Option<String>> {
        crate::android::secret_read(&self.0)
    }

    fn write(&self, value: &str) -> StoreResult<()> {
        crate::android::secret_write(&self.0, value)
    }

    fn clear(&self) -> StoreResult<()> {
        crate::android::secret_clear(&self.0)
    }
}

#[cfg(desktop)]
impl SecretStore for KeyringSlot {
    fn read(&self) -> StoreResult<Option<String>> {
        match keyring_entry(&self.0)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn write(&self, value: &str) -> StoreResult<()> {
        keyring_entry(&self.0)?
            .set_password(value)
            .map_err(|error| error.to_string())
    }

    fn clear(&self) -> StoreResult<()> {
        match keyring_entry(&self.0)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

impl SecretStore for KeyringStore {
    fn read(&self) -> StoreResult<Option<String>> {
        KeyringSlot(KEYRING_ACCOUNT.to_owned()).read()
    }

    fn write(&self, value: &str) -> StoreResult<()> {
        KeyringSlot(KEYRING_ACCOUNT.to_owned()).write(value)
    }

    fn clear(&self) -> StoreResult<()> {
        KeyringSlot(KEYRING_ACCOUNT.to_owned()).clear()
    }
}

pub(crate) type RedirectFuture<'a> = Pin<Box<dyn Future<Output = StoreResult<String>> + Send + 'a>>;

pub trait Browser: Send + Sync {
    fn open(&self, url: &str) -> StoreResult<()>;

    fn redirect_scheme(&self) -> Option<String> {
        None
    }

    fn await_redirect(&self) -> RedirectFuture<'_> {
        Box::pin(async { Err(MSG_DIDNT_COMPLETE.to_owned()) })
    }
}

pub struct SystemBrowser(pub AppHandle);

impl Browser for SystemBrowser {
    fn open(&self, url: &str) -> StoreResult<()> {
        // Both mobile platforms use the native in-app browser (Custom Tabs on Android,
        // ASWebAuthenticationSession on iOS) so the custom-scheme redirect comes back to
        // the app instead of a loopback listener that iOS cannot register.
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
            android_redirect_scheme(GOOGLE_CLIENT_ID)
        } else if cfg!(target_os = "ios") {
            Some(crate::ios_scheme::REDIRECT_SCHEME.to_owned())
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

pub(crate) fn android_redirect_scheme(client_id: &str) -> Option<String> {
    let prefix = client_id.strip_suffix(".apps.googleusercontent.com")?;
    (!prefix.is_empty()).then(|| format!("com.googleusercontent.apps.{prefix}"))
}

#[derive(Clone)]
pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: Option<String>,
    pub auth_url: String,
    pub token_url: String,
    pub userinfo_url: String,
    pub revoke_url: String,
    pub sign_in_timeout: Duration,
    pub memory_fallback: bool,
}

impl OAuthConfig {
    pub fn production() -> Self {
        Self {
            client_id: GOOGLE_CLIENT_ID.to_owned(),
            client_secret: (!GOOGLE_CLIENT_SECRET.is_empty()).then(|| GOOGLE_CLIENT_SECRET.to_owned()),
            auth_url: AUTH_URL.to_owned(),
            token_url: TOKEN_URL.to_owned(),
            userinfo_url: USERINFO_URL.to_owned(),
            revoke_url: REVOKE_URL.to_owned(),
            sign_in_timeout: SIGN_IN_TIMEOUT,
            memory_fallback: cfg!(target_os = "linux"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Guest,
    Google,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAccount {
    pub mode: Mode,
    pub google_sub: Option<String>,
    pub name: Option<String>,
    pub email: Option<String>,
    pub picture_url: Option<String>,
    pub configured: bool,
    pub keyring_available: bool,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct StoredSession {
    pub refresh_token: String,
    pub sub: String,
    pub email: Option<String>,
    pub saved_at: i64,
}

#[derive(Clone)]
struct AccessToken {
    value: String,
    expires_at: i64,
}

struct Session {
    sub: String,
    email: Option<String>,
    name: Option<String>,
    picture: Option<String>,
    access: Option<AccessToken>,
    refresh_token: String,
}

#[derive(Default)]
struct Inner {
    session: Option<Session>,
    pending: Option<CancellationToken>,
    keyring_available: bool,
}

pub struct GoogleAuth {
    config: OAuthConfig,
    store: Arc<dyn SecretStore>,
    http: reqwest::Client,
    inner: Mutex<Inner>,
}

pub enum Resume {
    Nothing,
    Ready(GoogleAccount),
    SignedOut(GoogleAccount),
    Retry,
}

enum Access {
    Token(String),
    Retry,
    Rejected,
}

enum Refresh {
    Ok {
        access: AccessToken,
        rotated: Option<String>,
    },
    Retry,
    Rejected,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: i64,
    refresh_token: Option<String>,
    scope: Option<String>,
    id_token: Option<String>,
}

#[derive(Default, Deserialize)]
struct Claims {
    sub: Option<String>,
    email: Option<String>,
    name: Option<String>,
    picture: Option<String>,
}

struct Identity {
    sub: String,
    email: Option<String>,
    name: Option<String>,
    picture: Option<String>,
}

struct Reply {
    status: u16,
    ok: bool,
    body: String,
}

pub(crate) struct Callback {
    pub(crate) code: String,
    pub(crate) stream: Option<TcpStream>,
}

struct PendingGuard<'a> {
    auth: &'a GoogleAuth,
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.auth.lock().pending = None;
    }
}

impl GoogleAuth {
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
            inner: Mutex::new(Inner {
                keyring_available: true,
                ..Inner::default()
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn account(&self) -> GoogleAccount {
        let inner = self.lock();
        let configured = !self.config.client_id.is_empty();
        let keyring_available = inner.keyring_available;
        match &inner.session {
            Some(session) => GoogleAccount {
                mode: Mode::Google,
                google_sub: Some(session.sub.clone()),
                name: session.name.clone(),
                email: session.email.clone(),
                picture_url: session.picture.clone(),
                configured,
                keyring_available,
            },
            None => GoogleAccount {
                mode: Mode::Guest,
                google_sub: None,
                name: None,
                email: None,
                picture_url: None,
                configured,
                keyring_available,
            },
        }
    }

    pub fn cancel_sign_in(&self) -> bool {
        match &self.lock().pending {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    pub async fn sign_in(&self, browser: &dyn Browser) -> Result<GoogleAccount, String> {
        if self.config.client_id.is_empty() {
            return Err(MSG_NOT_CONFIGURED.to_owned());
        }
        let cancel = self.begin_sign_in()?;
        let _pending = PendingGuard { auth: self };

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
        browser
            .open(&url)
            .map_err(|_| MSG_NO_BROWSER.to_owned())?;

        let callback = tokio::select! {
            result = tokio::time::timeout(self.config.sign_in_timeout, wait_for_redirect(listener.as_ref(), browser, &state)) => match result {
                Ok(callback) => callback?,
                Err(_) => return Err(MSG_TIMED_OUT.to_owned()),
            },
            () = cancel.cancelled() => return Err(MSG_CANCELLED.to_owned()),
        };

        let Callback { code, stream } = callback;
        let outcome = self.complete_sign_in(&code, &verifier, &redirect).await;
        if let Some(mut stream) = stream {
            let page = if outcome.is_ok() {
                success_page()
            } else {
                error_page()
            };
            respond(&mut stream, "200 OK", &page).await;
        }
        outcome
    }

    fn begin_sign_in(&self) -> Result<CancellationToken, String> {
        let mut inner = self.lock();
        if inner.pending.is_some() {
            return Err(MSG_ALREADY_PENDING.to_owned());
        }
        let token = CancellationToken::new();
        inner.pending = Some(token.clone());
        Ok(token)
    }

    async fn complete_sign_in(
        &self,
        code: &str,
        verifier: &str,
        redirect: &str,
    ) -> Result<GoogleAccount, String> {
        let token = self.exchange(code, verifier, redirect).await?;
        check_scopes(token.scope.as_deref())?;
        let refresh_token = token
            .refresh_token
            .clone()
            .ok_or_else(|| MSG_NO_REFRESH.to_owned())?;
        let info = self.userinfo(&token.access_token).await;
        let claims = token.id_token.as_deref().and_then(id_token_claims);
        let identity = identity(info, claims).ok_or_else(|| MSG_DIDNT_COMPLETE.to_owned())?;
        let session = Session {
            sub: identity.sub,
            email: identity.email,
            name: identity.name,
            picture: identity.picture,
            access: Some(AccessToken {
                value: token.access_token,
                expires_at: now_secs() + token.expires_in,
            }),
            refresh_token,
        };
        let stored = self.persist(&session);
        if stored.is_err() && !self.config.memory_fallback {
            return Err(format!(
                "{APP_NAME} couldn't save your sign-in on this computer. Check that the app data folder is writable."
            ));
        }
        self.install(session, stored.is_ok());
        Ok(self.account())
    }

    fn install(&self, session: Session, keyring_available: bool) {
        let mut inner = self.lock();
        inner.keyring_available = keyring_available;
        inner.session = Some(session);
    }

    pub async fn resume(&self) -> Resume {
        let loaded = self.lock().session.is_some();
        if !loaded && !self.load_session() {
            return Resume::Nothing;
        }
        match self.access().await {
            Access::Token(token) => {
                if let Some(claims) = self.userinfo(&token).await {
                    let mut inner = self.lock();
                    if let Some(session) = inner.session.as_mut() {
                        session.name = claims.name;
                        session.picture = claims.picture;
                        session.email = claims.email.or(session.email.take());
                    }
                }
                Resume::Ready(self.account())
            }
            Access::Retry => Resume::Retry,
            Access::Rejected => {
                self.forget();
                Resume::SignedOut(self.account())
            }
        }
    }

    fn load_session(&self) -> bool {
        let raw = match self.store.read() {
            Ok(Some(raw)) => raw,
            Ok(None) => return false,
            Err(error) => {
                self.set_keyring(false, &error);
                return false;
            }
        };
        self.set_keyring(true, "");
        match serde_json::from_str::<StoredSession>(&raw) {
            Ok(stored) => {
                self.lock().session = Some(Session {
                    sub: stored.sub,
                    email: stored.email,
                    name: None,
                    picture: None,
                    access: None,
                    refresh_token: stored.refresh_token,
                });
                true
            }
            Err(error) => {
                tracing::warn!(%error, "stored Google session is unreadable");
                false
            }
        }
    }

    fn set_keyring(&self, available: bool, error: &str) {
        let mut inner = self.lock();
        if inner.keyring_available && !available {
            tracing::warn!(%error, "keyring unavailable, sign-in kept for this session only");
        }
        inner.keyring_available = available;
    }

    async fn access(&self) -> Access {
        let refresh_token = {
            let inner = self.lock();
            let Some(session) = inner.session.as_ref() else {
                return Access::Rejected;
            };
            if let Some(token) = &session.access {
                if is_fresh(token.expires_at, now_secs()) {
                    return Access::Token(token.value.clone());
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
                    if let Some(refresh_token) = rotated {
                        session.refresh_token = refresh_token;
                        if let Err(error) = self.persist(session) {
                            tracing::warn!(%error, "could not store the rotated Google token");
                        }
                    }
                }
                Access::Token(value)
            }
            Refresh::Retry => Access::Retry,
            Refresh::Rejected => Access::Rejected,
        }
    }

    async fn refresh(&self, refresh_token: &str) -> Refresh {
        let mut fields = vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", self.config.client_id.as_str()),
        ];
        if let Some(secret) = &self.config.client_secret {
            fields.push(("client_secret", secret.as_str()));
        }
        let Some(reply) = self.post_form(&self.config.token_url, &fields).await else {
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
        let mut fields = vec![
            ("code", code),
            ("client_id", self.config.client_id.as_str()),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect),
        ];
        if let Some(secret) = &self.config.client_secret {
            fields.push(("client_secret", secret.as_str()));
        }
        let reply = self
            .post_form(&self.config.token_url, &fields)
            .await
            .ok_or_else(|| MSG_NETWORK.to_owned())?;
        if reply.ok {
            return serde_json::from_str(&reply.body).map_err(|_| MSG_DIDNT_COMPLETE.to_owned());
        }
        if error_code(&reply.body).as_deref() == Some("invalid_grant") {
            Err(MSG_EXPIRED.to_owned())
        } else {
            Err(MSG_DIDNT_COMPLETE.to_owned())
        }
    }

    async fn userinfo(&self, access_token: &str) -> Option<Claims> {
        let response = self
            .http
            .get(&self.config.userinfo_url)
            .bearer_auth(access_token)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.json::<Claims>().await.ok()
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
            sub: session.sub.clone(),
            email: session.email.clone(),
            saved_at: now_secs(),
        };
        let raw = serde_json::to_string(&stored).map_err(|error| error.to_string())?;
        self.store.write(&raw)
    }

    pub fn forget(&self) {
        self.lock().session = None;
        if let Err(error) = self.store.clear() {
            tracing::warn!(%error, "could not delete the stored Google sign-in");
        }
    }

    pub async fn youtube_token(&self, force: bool) -> Result<String, TokenError> {
        if force {
            if let Some(session) = self.lock().session.as_mut() {
                session.access = None;
            }
        }
        match self.access().await {
            Access::Token(token) => Ok(token),
            Access::Retry => Err(TokenError::Retry),
            Access::Rejected => Err(TokenError::SignedOut),
        }
    }

    pub async fn revoke(&self) -> Result<(), String> {
        let refresh_token = self.lock().session.as_ref().map(|session| session.refresh_token.clone());
        let Some(refresh_token) = refresh_token else {
            return Ok(());
        };
        let reply = self
            .post_form(&self.config.revoke_url, &[("token", refresh_token.as_str())])
            .await
            .ok_or_else(|| MSG_NETWORK.to_owned())?;
        if reply.ok || reply.status == 400 {
            Ok(())
        } else {
            Err(MSG_REJECTED.to_owned())
        }
    }

    pub async fn sign_out(&self) -> GoogleAccount {
        let refresh_token = self
            .lock()
            .session
            .as_ref()
            .map(|session| session.refresh_token.clone());
        if let Some(refresh_token) = refresh_token {
            let _ = self
                .post_form(&self.config.revoke_url, &[("token", refresh_token.as_str())])
                .await;
        }
        self.forget();
        self.account()
    }
}

pub(crate) fn random_verifier() -> String {
    let mut rng = rand::thread_rng();
    (0..VERIFIER_LEN)
        .map(|_| VERIFIER_CHARS[rng.gen_range(0..VERIFIER_CHARS.len())] as char)
        .collect()
}

pub(crate) fn random_state() -> String {
    let mut bytes = [0u8; STATE_BYTES];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub(crate) async fn bind_loopback() -> std::io::Result<(TcpListener, u16)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    Ok((listener, port))
}

pub(crate) fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}{CALLBACK_PATH}")
}

pub(crate) fn form_body(fields: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(fields.iter().copied())
        .finish()
}

fn authorization_url(config: &OAuthConfig, redirect: &str, challenge: &str, state: &str) -> String {
    let query = form_body(&[
        ("client_id", config.client_id.as_str()),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        ("scope", SCOPES),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        ("access_type", "offline"),
        ("prompt", "select_account consent"),
        ("include_granted_scopes", "true"),
    ]);
    format!("{}?{query}", config.auth_url)
}

fn check_scopes(granted: Option<&str>) -> Result<(), String> {
    let granted: Vec<&str> = granted.unwrap_or_default().split_whitespace().collect();
    if granted.contains(&YOUTUBE_SCOPE) {
        return Ok(());
    }
    Err(format!(
        "{APP_NAME} needs access to YouTube playlists. Sign in again and keep that box ticked."
    ))
}

fn id_token_claims(token: &str) -> Option<Claims> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn identity(info: Option<Claims>, claims: Option<Claims>) -> Option<Identity> {
    let info = info.unwrap_or_default();
    let claims = claims.unwrap_or_default();
    Some(Identity {
        sub: info.sub.or(claims.sub)?,
        email: info.email.or(claims.email),
        name: info.name.or(claims.name),
        picture: info.picture.or(claims.picture),
    })
}

pub(crate) fn is_fresh(expires_at: i64, now: i64) -> bool {
    expires_at - now >= REFRESH_LEEWAY_SECS
}

pub(crate) fn now_secs() -> i64 {
    UNIX_EPOCH
        .elapsed()
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

pub(crate) fn error_code(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value.get("error")?.as_str().map(str::to_owned)
}

pub(crate) async fn wait_for_redirect(
    listener: Option<&TcpListener>,
    browser: &dyn Browser,
    state: &str,
) -> Result<Callback, String> {
    match listener {
        Some(listener) => wait_for_callback(listener, state).await,
        None => wait_for_app_redirect(browser, state).await,
    }
}

enum Verdict {
    Code(String),
    Ignored,
    Failed(String),
}

fn read_redirect(url: &Url, state: &str) -> Verdict {
    let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if params.get("state").map(String::as_str) != Some(state) {
        return Verdict::Ignored;
    }
    if params.contains_key("error") {
        let message = params
            .get("error_description")
            .filter(|description| !description.is_empty())
            .map(|description| description.chars().take(MAX_ERROR_LEN).collect())
            .unwrap_or_else(|| MSG_DIDNT_COMPLETE.to_owned());
        return Verdict::Failed(message);
    }
    match params.get("code") {
        Some(code) if !code.is_empty() && code.len() <= MAX_CODE_LEN => Verdict::Code(code.clone()),
        _ => Verdict::Failed(MSG_DIDNT_COMPLETE.to_owned()),
    }
}

async fn wait_for_app_redirect(browser: &dyn Browser, state: &str) -> Result<Callback, String> {
    loop {
        let raw = browser.await_redirect().await?;
        let url = Url::parse(&raw).map_err(|_| MSG_DIDNT_COMPLETE.to_owned())?;
        match read_redirect(&url, state) {
            Verdict::Ignored => continue,
            Verdict::Failed(message) => return Err(message),
            Verdict::Code(code) => return Ok(Callback { code, stream: None }),
        }
    }
}

async fn wait_for_callback(listener: &TcpListener, state: &str) -> Result<Callback, String> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|_| MSG_DIDNT_COMPLETE.to_owned())?;
        let Some(target) = request_target(&mut stream).await else {
            respond(&mut stream, "404 Not Found", "Not found").await;
            continue;
        };
        let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
            respond(&mut stream, "404 Not Found", "Not found").await;
            continue;
        };
        if url.path() != CALLBACK_PATH {
            respond(&mut stream, "404 Not Found", "Not found").await;
            continue;
        }
        match read_redirect(&url, state) {
            Verdict::Ignored => respond(&mut stream, "400 Bad Request", &state_page()).await,
            Verdict::Failed(message) => {
                respond(&mut stream, "200 OK", &error_page()).await;
                return Err(message);
            }
            Verdict::Code(code) => {
                return Ok(Callback {
                    code,
                    stream: Some(stream),
                });
            }
        }
    }
}

async fn request_target(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = [0u8; 8192];
    let read = stream.read(&mut buffer).await.ok()?;
    let text = String::from_utf8_lossy(&buffer[..read]);
    let mut parts = text.lines().next()?.split_whitespace();
    (parts.next()? == "GET").then(|| parts.next().map(str::to_owned))?
}

pub(crate) async fn respond(stream: &mut TcpStream, status: &str, text: &str) {
    let page = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{APP_NAME}</title></head><body><p>{text}</p></body></html>"
    );
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        page.len()
    );
    let _ = stream.write_all(format!("{head}{page}").as_bytes()).await;
    let _ = stream.shutdown().await;
}

fn success_page() -> String {
    format!("You're signed in to {APP_NAME}. You can close this tab.")
}

fn error_page() -> String {
    format!("Sign-in didn't complete. You can close this tab and try again in {APP_NAME}.")
}

fn state_page() -> String {
    format!("Sign-in couldn't be verified. Try again in {APP_NAME}.")
}

#[cfg(desktop)]
fn keyring_service() -> String {
    format!("com.{APP_SLUG}.app")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::extract::State as AxState;
    use axum::http::StatusCode;
    use axum::routing::{get, post};
    use tokio::sync::Notify;

    #[derive(Default)]
    struct MemoryStore {
        value: Mutex<Option<String>>,
        unavailable: bool,
    }

    impl MemoryStore {
        fn failing() -> Self {
            Self {
                value: Mutex::new(None),
                unavailable: true,
            }
        }

        fn with(raw: &str) -> Self {
            Self {
                value: Mutex::new(Some(raw.to_owned())),
                unavailable: false,
            }
        }

        fn check(&self) -> StoreResult<()> {
            if self.unavailable {
                Err("no secret service".to_owned())
            } else {
                Ok(())
            }
        }

        fn saved(&self) -> Option<String> {
            self.value.lock().unwrap().clone()
        }
    }

    impl SecretStore for MemoryStore {
        fn read(&self) -> StoreResult<Option<String>> {
            self.check()?;
            Ok(self.value.lock().unwrap().clone())
        }

        fn write(&self, value: &str) -> StoreResult<()> {
            self.check()?;
            *self.value.lock().unwrap() = Some(value.to_owned());
            Ok(())
        }

        fn clear(&self) -> StoreResult<()> {
            self.check()?;
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }

    type Canned = (u16, String);

    #[derive(Default)]
    struct Fake {
        token: Mutex<Option<Canned>>,
        userinfo: Mutex<Option<Canned>>,
        revoke: Mutex<Option<Canned>>,
        requests: Mutex<Vec<(String, String)>>,
    }

    impl Fake {
        fn record(&self, path: &str, body: String) {
            self.requests.lock().unwrap().push((path.to_owned(), body));
        }

        fn request(&self, path: &str) -> Vec<(String, String)> {
            self.requests
                .lock()
                .unwrap()
                .iter()
                .filter(|(seen, _)| seen == path)
                .cloned()
                .collect()
        }
    }

    fn answer(slot: &Mutex<Option<Canned>>) -> (StatusCode, String) {
        let (status, body) = slot.lock().unwrap().clone().unwrap_or((500, String::new()));
        (StatusCode::from_u16(status).unwrap(), body)
    }

    async fn token(AxState(fake): AxState<Arc<Fake>>, body: String) -> (StatusCode, String) {
        fake.record("/token", body);
        answer(&fake.token)
    }

    async fn userinfo(AxState(fake): AxState<Arc<Fake>>) -> (StatusCode, String) {
        fake.record("/userinfo", String::new());
        answer(&fake.userinfo)
    }

    async fn revoke(AxState(fake): AxState<Arc<Fake>>, body: String) -> (StatusCode, String) {
        fake.record("/revoke", body);
        answer(&fake.revoke)
    }

    async fn start_fake() -> (String, Arc<Fake>) {
        let fake = Arc::new(Fake::default());
        let app = Router::new()
            .route("/token", post(token))
            .route("/userinfo", get(userinfo))
            .route("/revoke", post(revoke))
            .with_state(fake.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, fake)
    }

    async fn unused_base() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        base
    }

    fn config(base: &str) -> OAuthConfig {
        OAuthConfig {
            client_id: "client.apps".to_owned(),
            client_secret: Some("secret".to_owned()),
            auth_url: format!("{base}/auth"),
            token_url: format!("{base}/token"),
            userinfo_url: format!("{base}/userinfo"),
            revoke_url: format!("{base}/revoke"),
            sign_in_timeout: Duration::from_secs(5),
            memory_fallback: false,
        }
    }

    fn form(body: &str) -> HashMap<String, String> {
        url::form_urlencoded::parse(body.as_bytes())
            .into_owned()
            .collect()
    }

    fn id_token(sub: &str, email: &str) -> String {
        let claims = serde_json::json!({ "sub": sub, "email": email });
        format!(
            "eyJhbGciOiJSUzI1NiJ9.{}.signature",
            URL_SAFE_NO_PAD.encode(claims.to_string())
        )
    }

    fn good_token() -> Canned {
        let body = serde_json::json!({
            "access_token": "access-1",
            "expires_in": 3600,
            "refresh_token": "refresh-1",
            "scope": SCOPES,
            "token_type": "Bearer",
            "id_token": id_token("sub-1", "ada@example.com"),
        });
        (200, body.to_string())
    }

    fn profile_userinfo() -> Canned {
        let body = serde_json::json!({
            "sub": "sub-1",
            "email": "ada@example.com",
            "name": "Ada",
            "picture": "https://img.example/ada.png",
        });
        (200, body.to_string())
    }

    struct Redirect {
        uri: String,
        state: String,
        challenge: String,
    }

    impl Redirect {
        fn parse(auth_url: &str) -> Self {
            let pairs: HashMap<String, String> = Url::parse(auth_url)
                .unwrap()
                .query_pairs()
                .into_owned()
                .collect();
            Self {
                uri: pairs["redirect_uri"].clone(),
                state: pairs["state"].clone(),
                challenge: pairs["code_challenge"].clone(),
            }
        }
    }

    type Deliver = Box<dyn Fn(&Redirect) -> Vec<String> + Send + Sync>;

    struct TestBrowser {
        deliver: Deliver,
        opened: Notify,
        seen: Mutex<Option<(String, String)>>,
    }

    impl Browser for TestBrowser {
        fn open(&self, url: &str) -> StoreResult<()> {
            let redirect = Redirect::parse(url);
            let queries = (self.deliver)(&redirect);
            *self.seen.lock().unwrap() = Some((redirect.challenge.clone(), redirect.uri.clone()));
            self.opened.notify_one();
            let target = redirect.uri;
            tokio::spawn(async move {
                for query in queries {
                    let _ = reqwest::get(format!("{target}?{query}")).await;
                }
            });
            Ok(())
        }
    }

    fn browser(deliver: impl Fn(&Redirect) -> Vec<String> + Send + Sync + 'static) -> Arc<TestBrowser> {
        Arc::new(TestBrowser {
            deliver: Box::new(deliver),
            opened: Notify::new(),
            seen: Mutex::new(None),
        })
    }

    struct NoBrowser;

    impl Browser for NoBrowser {
        fn open(&self, _: &str) -> StoreResult<()> {
            panic!("the browser must not open");
        }
    }

    fn code_for(redirect: &Redirect) -> Vec<String> {
        vec![format!("code=abc&state={}", redirect.state)]
    }

    #[test]
    fn rfc7636_challenge_vector() {
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_is_64_unreserved_characters() {
        let verifier = random_verifier();
        assert_eq!(verifier.len(), 64);
        assert!(verifier.bytes().all(|byte| VERIFIER_CHARS.contains(&byte)));
        assert_ne!(verifier, random_verifier());
    }

    #[test]
    fn state_is_32_random_bytes_base64url() {
        let state = random_state();
        assert_eq!(state.len(), 43);
        assert_eq!(URL_SAFE_NO_PAD.decode(&state).unwrap().len(), 32);
        assert_ne!(state, random_state());
    }

    #[test]
    fn authorization_url_carries_the_exact_parameters() {
        let url = authorization_url(&config("http://idp"), "http://127.0.0.1:5000/callback", "chal", "st");
        let parsed = Url::parse(&url).unwrap();
        assert_eq!(parsed.origin().ascii_serialization(), "http://idp");
        let query: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
        assert_eq!(query["client_id"], "client.apps");
        assert_eq!(query["redirect_uri"], "http://127.0.0.1:5000/callback");
        assert_eq!(query["response_type"], "code");
        assert_eq!(query["scope"], SCOPES);
        assert_eq!(query["code_challenge"], "chal");
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["state"], "st");
        assert_eq!(query["access_type"], "offline");
        assert_eq!(query["prompt"], "select_account consent");
        assert_eq!(query["include_granted_scopes"], "true");
        assert_eq!(query.len(), 10);
    }

    #[tokio::test]
    async fn loopback_port_is_assigned_per_flow() {
        let (first, first_port) = bind_loopback().await.unwrap();
        let (_second, second_port) = bind_loopback().await.unwrap();
        assert_ne!(first_port, 0);
        assert_ne!(first_port, second_port);
        assert_eq!(first.local_addr().unwrap().ip().to_string(), "127.0.0.1");
        assert_eq!(redirect_uri(first_port), format!("http://127.0.0.1:{first_port}/callback"));
    }

    #[test]
    fn scopes_must_include_youtube_and_no_drive() {
        assert!(check_scopes(Some(SCOPES)).is_ok());
        assert!(check_scopes(Some("openid email profile")).is_err());
        assert!(check_scopes(None).is_err());
        assert!(!SCOPES.contains("drive"));
    }

    #[test]
    fn id_token_claims_are_read_from_the_payload() {
        let claims = id_token_claims(&id_token("sub-9", "b@example.com")).unwrap();
        assert_eq!(claims.sub.as_deref(), Some("sub-9"));
        assert_eq!(claims.email.as_deref(), Some("b@example.com"));
        assert!(id_token_claims("not-a-token").is_none());
    }

    #[test]
    fn identity_falls_back_to_the_id_token() {
        let claims = Claims {
            sub: Some("sub-2".to_owned()),
            email: Some("c@example.com".to_owned()),
            ..Claims::default()
        };
        let identity = identity(None, Some(claims)).unwrap();
        assert_eq!(identity.sub, "sub-2");
        assert_eq!(identity.email.as_deref(), Some("c@example.com"));
        assert!(identity.name.is_none());
        assert!(super::identity(None, None).is_none());
    }

    #[test]
    fn access_token_refreshes_inside_sixty_seconds() {
        assert!(is_fresh(1_000 + 61, 1_000));
        assert!(!is_fresh(1_000 + 59, 1_000));
    }

    #[tokio::test]
    async fn callback_ignores_other_paths_and_keeps_waiting() {
        let (listener, port) = bind_loopback().await.unwrap();
        let waiter = tokio::spawn(async move { wait_for_callback(&listener, "st").await });
        let favicon = reqwest::get(format!("http://127.0.0.1:{port}/favicon.ico"))
            .await
            .unwrap();
        assert_eq!(favicon.status(), 404);
        let callback = tokio::spawn(reqwest::get(format!(
            "http://127.0.0.1:{port}/callback?code=abc&state=st"
        )));
        let mut received = waiter.await.unwrap().unwrap();
        assert_eq!(received.code, "abc");
        respond(received.stream.as_mut().unwrap(), "200 OK", "ok").await;
        drop(received);
        callback.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn callback_state_mismatch_is_refused_and_flow_continues() {
        let (listener, port) = bind_loopback().await.unwrap();
        let waiter = tokio::spawn(async move { wait_for_callback(&listener, "good").await });
        let forged = reqwest::get(format!(
            "http://127.0.0.1:{port}/callback?code=evil&state=bad"
        ))
        .await
        .unwrap();
        assert_eq!(forged.status(), 400);
        let text = forged.text().await.unwrap();
        assert!(text.contains("Sign-in couldn't be verified. Try again in Hushio."));
        let callback = tokio::spawn(reqwest::get(format!(
            "http://127.0.0.1:{port}/callback?code=real&state=good"
        )));
        let mut received = waiter.await.unwrap().unwrap();
        assert_eq!(received.code, "real");
        respond(received.stream.as_mut().unwrap(), "200 OK", "ok").await;
        drop(received);
        callback.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn callback_error_ends_flow_with_description_cut_to_300_characters() {
        let (listener, port) = bind_loopback().await.unwrap();
        let waiter = tokio::spawn(async move { wait_for_callback(&listener, "st").await });
        let description = "d".repeat(400);
        reqwest::get(format!(
            "http://127.0.0.1:{port}/callback?error=access_denied&error_description={description}&state=st"
        ))
        .await
        .unwrap();
        let message = waiter.await.unwrap().err().unwrap();
        assert_eq!(message.chars().count(), MAX_ERROR_LEN);
    }

    #[tokio::test]
    async fn callback_error_without_description_uses_default_message() {
        let (listener, port) = bind_loopback().await.unwrap();
        let waiter = tokio::spawn(async move { wait_for_callback(&listener, "st").await });
        reqwest::get(format!(
            "http://127.0.0.1:{port}/callback?error=access_denied&state=st"
        ))
        .await
        .unwrap();
        assert_eq!(waiter.await.unwrap().err().unwrap(), MSG_DIDNT_COMPLETE);
    }

    #[tokio::test]
    async fn callback_code_longer_than_512_characters_is_refused() {
        let (listener, port) = bind_loopback().await.unwrap();
        let waiter = tokio::spawn(async move { wait_for_callback(&listener, "st").await });
        let code = "c".repeat(MAX_CODE_LEN + 1);
        reqwest::get(format!("http://127.0.0.1:{port}/callback?code={code}&state=st"))
            .await
            .unwrap();
        assert_eq!(waiter.await.unwrap().err().unwrap(), MSG_DIDNT_COMPLETE);
    }

    #[tokio::test]
    async fn sign_in_stores_only_the_refresh_token_and_reports_the_account() {
        let (base, fake) = start_fake().await;
        *fake.token.lock().unwrap() = Some(good_token());
        *fake.userinfo.lock().unwrap() = Some(profile_userinfo());
        let store = Arc::new(MemoryStore::default());
        let auth = GoogleAuth::new(config(&base), store.clone());
        let browser = browser(code_for);

        let account = auth.sign_in(&*browser).await.unwrap();

        assert_eq!(account.mode, Mode::Google);
        assert_eq!(account.name.as_deref(), Some("Ada"));
        assert_eq!(account.email.as_deref(), Some("ada@example.com"));
        assert_eq!(account.picture_url.as_deref(), Some("https://img.example/ada.png"));
        assert_eq!(account.google_sub.as_deref(), Some("sub-1"));
        assert!(account.keyring_available);

        let saved: serde_json::Value = serde_json::from_str(&store.saved().unwrap()).unwrap();
        let keys: Vec<&str> = saved.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys.len(), 4);
        assert!(["refresh_token", "sub", "email", "saved_at"].iter().all(|key| keys.contains(key)));
        assert_eq!(saved["refresh_token"], "refresh-1");

        let (challenge, redirect_uri) = browser.seen.lock().unwrap().clone().unwrap();
        let request = fake.request("/token");
        let fields = form(&request[0].1);
        assert_eq!(fields["grant_type"], "authorization_code");
        assert_eq!(fields["code"], "abc");
        assert_eq!(fields["client_id"], "client.apps");
        assert_eq!(fields["client_secret"], "secret");
        assert_eq!(fields["redirect_uri"], redirect_uri);
        assert_eq!(fields["code_verifier"].len(), 64);
        assert_eq!(code_challenge(&fields["code_verifier"]), challenge);
    }

    #[tokio::test]
    async fn sign_in_without_client_id_never_opens_the_browser() {
        let mut settings = config("http://127.0.0.1:1");
        settings.client_id = String::new();
        let auth = GoogleAuth::new(settings, Arc::new(MemoryStore::default()));
        assert_eq!(auth.sign_in(&NoBrowser).await, Err(MSG_NOT_CONFIGURED.to_owned()));
        assert!(!auth.account().configured);
    }

    #[tokio::test]
    async fn sign_in_refused_when_scope_is_unticked_and_stores_nothing() {
        let (base, fake) = start_fake().await;
        let body = serde_json::json!({
            "access_token": "a", "expires_in": 3600, "refresh_token": "r",
            "scope": "openid email profile",
        });
        *fake.token.lock().unwrap() = Some((200, body.to_string()));
        let store = Arc::new(MemoryStore::default());
        let auth = GoogleAuth::new(config(&base), store.clone());
        let error = auth.sign_in(&*browser(code_for)).await.unwrap_err();
        assert_eq!(
            error,
            "Hushio needs access to YouTube playlists. Sign in again and keep that box ticked."
        );
        assert!(store.saved().is_none());
        assert_eq!(auth.account().mode, Mode::Guest);
    }

    #[tokio::test]
    async fn sign_in_refused_without_refresh_token() {
        let (base, fake) = start_fake().await;
        let body = serde_json::json!({ "access_token": "a", "expires_in": 3600, "scope": SCOPES });
        *fake.token.lock().unwrap() = Some((200, body.to_string()));
        let store = Arc::new(MemoryStore::default());
        let auth = GoogleAuth::new(config(&base), store.clone());
        let error = auth.sign_in(&*browser(code_for)).await.unwrap_err();
        assert_eq!(error, MSG_NO_REFRESH);
        assert!(store.saved().is_none());
    }

    #[tokio::test]
    async fn token_values_never_reach_an_error_message() {
        let (base, fake) = start_fake().await;
        let leaky = serde_json::json!({ "access_token": "leaked-access-9", "expires_in": 3600, "scope": SCOPES });
        *fake.token.lock().unwrap() = Some((200, leaky.to_string()));
        let error = GoogleAuth::new(config(&base), Arc::new(MemoryStore::default()))
            .sign_in(&*browser(code_for))
            .await
            .unwrap_err();
        assert!(!error.contains("leaked-access-9"));

        *fake.token.lock().unwrap() =
            Some((400, r#"{"error":"invalid_grant","error_description":"refresh leaked-refresh-7"}"#.to_owned()));
        let error = GoogleAuth::new(config(&base), Arc::new(MemoryStore::default()))
            .sign_in(&*browser(code_for))
            .await
            .unwrap_err();
        assert!(!error.contains("leaked-refresh-7"));
    }

    #[tokio::test]
    async fn sign_in_reports_expired_grant_and_network_failure() {
        let (base, fake) = start_fake().await;
        *fake.token.lock().unwrap() = Some((400, r#"{"error":"invalid_grant"}"#.to_owned()));
        let auth = GoogleAuth::new(config(&base), Arc::new(MemoryStore::default()));
        assert_eq!(auth.sign_in(&*browser(code_for)).await.unwrap_err(), MSG_EXPIRED);

        let offline = config(&unused_base().await);
        let auth = GoogleAuth::new(offline, Arc::new(MemoryStore::default()));
        assert_eq!(auth.sign_in(&*browser(code_for)).await.unwrap_err(), MSG_NETWORK);
    }

    #[tokio::test]
    async fn sign_in_times_out_when_no_callback_arrives() {
        let (base, _fake) = start_fake().await;
        let mut settings = config(&base);
        settings.sign_in_timeout = Duration::from_millis(100);
        let auth = GoogleAuth::new(settings, Arc::new(MemoryStore::default()));
        let error = auth.sign_in(&*browser(|_| Vec::new())).await.unwrap_err();
        assert_eq!(error, MSG_TIMED_OUT);
        assert!(!auth.cancel_sign_in());
    }

    #[tokio::test]
    async fn sign_in_survives_a_forged_callback_and_completes() {
        let (base, fake) = start_fake().await;
        *fake.token.lock().unwrap() = Some(good_token());
        *fake.userinfo.lock().unwrap() = Some(profile_userinfo());
        let auth = GoogleAuth::new(config(&base), Arc::new(MemoryStore::default()));
        let browser = browser(|redirect| {
            vec![
                "code=evil&state=forged".to_owned(),
                format!("code=abc&state={}", redirect.state),
            ]
        });
        let account = auth.sign_in(&*browser).await.unwrap();
        assert_eq!(account.mode, Mode::Google);
    }

    #[tokio::test]
    async fn cancel_ends_the_pending_flow() {
        let (base, _fake) = start_fake().await;
        let auth = Arc::new(GoogleAuth::new(config(&base), Arc::new(MemoryStore::default())));
        let browser = browser(|_| Vec::new());
        let task = {
            let auth = auth.clone();
            let browser = browser.clone();
            tokio::spawn(async move { auth.sign_in(&*browser).await })
        };
        browser.opened.notified().await;
        assert!(auth.cancel_sign_in());
        assert_eq!(task.await.unwrap(), Err(MSG_CANCELLED.to_owned()));
        assert!(!auth.cancel_sign_in());
    }

    #[tokio::test]
    async fn second_sign_in_is_refused_while_one_is_pending() {
        let (base, _fake) = start_fake().await;
        let auth = Arc::new(GoogleAuth::new(config(&base), Arc::new(MemoryStore::default())));
        let browser = browser(|_| Vec::new());
        let task = {
            let auth = auth.clone();
            let browser = browser.clone();
            tokio::spawn(async move { auth.sign_in(&*browser).await })
        };
        browser.opened.notified().await;
        assert_eq!(
            auth.sign_in(&NoBrowser).await,
            Err(MSG_ALREADY_PENDING.to_owned())
        );
        auth.cancel_sign_in();
        task.await.unwrap().unwrap_err();
    }

    #[tokio::test]
    async fn keyring_failure_refuses_sign_in_on_windows_and_macos() {
        let (base, fake) = start_fake().await;
        *fake.token.lock().unwrap() = Some(good_token());
        *fake.userinfo.lock().unwrap() = Some(profile_userinfo());
        let auth = GoogleAuth::new(config(&base), Arc::new(MemoryStore::failing()));
        let error = auth.sign_in(&*browser(code_for)).await.unwrap_err();
        assert!(error.contains("couldn't save your sign-in"));
        assert_eq!(auth.account().mode, Mode::Guest);
    }

    #[tokio::test]
    async fn keyring_failure_keeps_sign_in_for_this_launch_on_linux_policy() {
        let (base, fake) = start_fake().await;
        *fake.token.lock().unwrap() = Some(good_token());
        *fake.userinfo.lock().unwrap() = Some(profile_userinfo());
        let mut settings = config(&base);
        settings.memory_fallback = true;
        let auth = GoogleAuth::new(settings, Arc::new(MemoryStore::failing()));
        let account = auth.sign_in(&*browser(code_for)).await.unwrap();
        assert_eq!(account.mode, Mode::Google);
        assert!(!account.keyring_available);
    }

    #[tokio::test]
    async fn resume_refreshes_and_rotates_the_refresh_token() {
        let (base, fake) = start_fake().await;
        *fake.token.lock().unwrap() = Some((
            200,
            r#"{"access_token":"access-2","expires_in":3600,"refresh_token":"refresh-2"}"#.to_owned(),
        ));
        *fake.userinfo.lock().unwrap() = Some(profile_userinfo());
        let store = Arc::new(MemoryStore::with(
            r#"{"refresh_token":"refresh-1","sub":"sub-1","email":"ada@example.com","saved_at":1}"#,
        ));
        let auth = GoogleAuth::new(config(&base), store.clone());

        let Resume::Ready(account) = auth.resume().await else {
            panic!("expected a ready session");
        };

        assert_eq!(account.name.as_deref(), Some("Ada"));
        assert_eq!(account.google_sub.as_deref(), Some("sub-1"));
        let saved: serde_json::Value = serde_json::from_str(&store.saved().unwrap()).unwrap();
        assert_eq!(saved["refresh_token"], "refresh-2");
        let request = fake.request("/token");
        let fields = form(&request[0].1);
        assert_eq!(fields["grant_type"], "refresh_token");
        assert_eq!(fields["refresh_token"], "refresh-1");
    }

    #[tokio::test]
    async fn resume_with_a_fresh_token_does_not_refresh_again() {
        let (base, fake) = start_fake().await;
        *fake.token.lock().unwrap() = Some((
            200,
            r#"{"access_token":"access-2","expires_in":3600}"#.to_owned(),
        ));
        let store = Arc::new(MemoryStore::with(
            r#"{"refresh_token":"refresh-1","sub":"sub-1","email":null,"saved_at":1}"#,
        ));
        let auth = GoogleAuth::new(config(&base), store);
        assert!(matches!(auth.resume().await, Resume::Ready(_)));
        let token = auth.access().await;
        assert!(matches!(token, Access::Token(ref value) if value == "access-2"));
        assert_eq!(fake.request("/token").len(), 1);
    }

    #[tokio::test]
    async fn resume_signs_out_locally_when_the_grant_is_revoked() {
        let (base, fake) = start_fake().await;
        *fake.token.lock().unwrap() = Some((400, r#"{"error":"invalid_grant"}"#.to_owned()));
        let store = Arc::new(MemoryStore::with(
            r#"{"refresh_token":"refresh-1","sub":"sub-1","email":null,"saved_at":1}"#,
        ));
        let auth = GoogleAuth::new(config(&base), store.clone());
        let Resume::SignedOut(account) = auth.resume().await else {
            panic!("expected a local sign-out");
        };
        assert_eq!(account.mode, Mode::Guest);
        assert!(store.saved().is_none());
    }

    #[tokio::test]
    async fn resume_keeps_the_session_when_the_network_is_down() {
        let store = Arc::new(MemoryStore::with(
            r#"{"refresh_token":"refresh-1","sub":"sub-1","email":null,"saved_at":1}"#,
        ));
        let auth = GoogleAuth::new(config(&unused_base().await), store.clone());
        assert!(matches!(auth.resume().await, Resume::Retry));
        assert_eq!(auth.account().mode, Mode::Google);
        assert!(store.saved().unwrap().contains("refresh-1"));
    }

    #[tokio::test]
    async fn resume_retries_on_server_errors() {
        let (base, fake) = start_fake().await;
        *fake.token.lock().unwrap() = Some((503, String::new()));
        let store = Arc::new(MemoryStore::with(
            r#"{"refresh_token":"refresh-1","sub":"sub-1","email":null,"saved_at":1}"#,
        ));
        let auth = GoogleAuth::new(config(&base), store);
        assert!(matches!(auth.resume().await, Resume::Retry));
        assert_eq!(auth.account().mode, Mode::Google);
    }

    #[tokio::test]
    async fn resume_without_a_stored_session_does_nothing() {
        let auth = GoogleAuth::new(config("http://127.0.0.1:1"), Arc::new(MemoryStore::default()));
        assert!(matches!(auth.resume().await, Resume::Nothing));
        assert_eq!(auth.account().mode, Mode::Guest);
    }

    #[tokio::test]
    async fn unavailable_keyring_on_resume_reports_no_keyring() {
        let auth = GoogleAuth::new(config("http://127.0.0.1:1"), Arc::new(MemoryStore::failing()));
        assert!(matches!(auth.resume().await, Resume::Nothing));
        assert!(!auth.account().keyring_available);
    }

    #[tokio::test]
    async fn sign_out_revokes_the_token_and_clears_the_store() {
        let (base, fake) = start_fake().await;
        *fake.token.lock().unwrap() = Some((200, r#"{"access_token":"a","expires_in":3600}"#.to_owned()));
        let store = Arc::new(MemoryStore::with(
            r#"{"refresh_token":"refresh-1","sub":"sub-1","email":null,"saved_at":1}"#,
        ));
        let auth = GoogleAuth::new(config(&base), store.clone());
        assert!(matches!(auth.resume().await, Resume::Ready(_)));

        let account = auth.sign_out().await;

        assert_eq!(account.mode, Mode::Guest);
        assert!(store.saved().is_none());
        let revoked = fake.request("/revoke");
        assert_eq!(form(&revoked[0].1)["token"], "refresh-1");
    }

    #[tokio::test]
    async fn sign_out_completes_even_when_revoke_fails() {
        let store = Arc::new(MemoryStore::with(
            r#"{"refresh_token":"refresh-1","sub":"sub-1","email":null,"saved_at":1}"#,
        ));
        let auth = GoogleAuth::new(config(&unused_base().await), store.clone());
        assert!(matches!(auth.resume().await, Resume::Retry));
        let account = auth.sign_out().await;
        assert_eq!(account.mode, Mode::Guest);
        assert!(store.saved().is_none());
    }

    #[test]
    fn keyring_service_matches_the_bundle_identifier() {
        assert_eq!(keyring_service(), "com.hushio.app");
    }

    #[cfg(target_os = "macos")]
    struct KeychainAccount(&'static str);

    #[cfg(target_os = "macos")]
    impl Drop for KeychainAccount {
        fn drop(&mut self) {
            let _ = KeyringSlot(self.0.to_owned()).clear();
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychain_round_trip_writes_under_the_app_service_and_removes_the_item() {
        let account: &'static str =
            Box::leak(format!("test-{}", uuid::Uuid::new_v4()).into_boxed_str());
        let _cleanup = KeychainAccount(account);
        let slot = KeyringSlot(account.to_owned());

        assert_eq!(slot.read().unwrap(), None);
        slot.write("first").unwrap();
        assert_eq!(slot.read().unwrap().as_deref(), Some("first"));
        let direct = keyring::Entry::new("com.hushio.app", account).unwrap();
        assert_eq!(direct.get_password().unwrap(), "first");

        slot.write("second").unwrap();
        assert_eq!(slot.read().unwrap().as_deref(), Some("second"));

        slot.clear().unwrap();
        assert_eq!(slot.read().unwrap(), None);
        slot.clear().unwrap();
    }

    #[test]
    fn android_redirect_scheme_is_the_reversed_client_id() {
        assert_eq!(
            android_redirect_scheme("123-abc.apps.googleusercontent.com").as_deref(),
            Some("com.googleusercontent.apps.123-abc")
        );
        assert_eq!(android_redirect_scheme(""), None);
        assert_eq!(android_redirect_scheme("123-abc"), None);
        assert_eq!(android_redirect_scheme(".apps.googleusercontent.com"), None);
    }

    #[test]
    fn app_redirect_reads_code_state_and_errors() {
        let ok = Url::parse("com.googleusercontent.apps.x:/oauth2redirect?code=c1&state=s1").unwrap();
        assert!(matches!(read_redirect(&ok, "s1"), Verdict::Code(code) if code == "c1"));
        let forged = Url::parse("com.googleusercontent.apps.x:/oauth2redirect?code=c1&state=bad").unwrap();
        assert!(matches!(read_redirect(&forged, "s1"), Verdict::Ignored));
        let denied = Url::parse("com.googleusercontent.apps.x:/oauth2redirect?error=access_denied&state=s1").unwrap();
        assert!(matches!(read_redirect(&denied, "s1"), Verdict::Failed(message) if message == MSG_DIDNT_COMPLETE));
        let long = format!("com.googleusercontent.apps.x:/oauth2redirect?code={}&state=s1", "c".repeat(MAX_CODE_LEN + 1));
        let long = Url::parse(&long).unwrap();
        assert!(matches!(read_redirect(&long, "s1"), Verdict::Failed(_)));
    }
}
