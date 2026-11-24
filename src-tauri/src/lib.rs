mod analysis;
mod crash;
mod disconnect;
mod android;
mod audio_output;
mod cache;
mod cache_limit;
mod discord;
mod downloads;
mod google_auth;
mod launch;
mod spotify_auth;
mod linux_portal;
mod linux_session;
mod local_library;
mod lyrics;
mod install_marker;
mod ios_scheme;
mod macos_window;
mod media_controls;
mod menu;
mod network;
#[cfg(desktop)]
mod playback;
mod persist;
mod reveal;
mod scrobble;
mod secrets;
mod stats;
mod stream;
mod sync_queue;
mod taskbar;
#[cfg(desktop)]
mod tray;
#[cfg(desktop)]
mod updates;
#[cfg(desktop)]
mod window;
mod tree_library;
mod yt_data_api;
mod yt_innertube_auth;
#[cfg(desktop)]
mod pip;
mod playlist_cover;
#[cfg(mobile)]
mod mobile;
#[cfg(mobile)]
use mobile::{pip, tray, updates, window};

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tracing::Subscriber;
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;

const APP_NAME: &str = "Hushio";
const APP_SLUG: &str = "hushio";
const DATA_DIR_ENV: &str = "HUSHIO_DATA_DIR";
#[cfg(desktop)]
const ALLOW_MULTI_ENV: &str = "HUSHIO_ALLOW_MULTI";

struct DataPaths {
    root: PathBuf,
}

struct LogPrefix;

impl<S, N> FormatEvent<S, N> for LogPrefix
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> std::fmt::Result {
        write!(writer, "[{APP_SLUG}] ")?;
        ctx.format_fields(writer.by_ref(), event)?;
        writeln!(writer)
    }
}

fn data_root(app: &AppHandle) -> tauri::Result<PathBuf> {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV) {
        return Ok(PathBuf::from(dir));
    }
    #[cfg(target_os = "linux")]
    {
        return Ok(app.path().data_dir()?.join(APP_SLUG));
    }
    #[cfg(not(target_os = "linux"))]
    {
        app.path().app_data_dir()
    }
}

fn ensure_install_marker(root: &std::path::Path) -> bool {
    let marker = root.join(format!(".{APP_SLUG}-install"));
    if marker.exists() {
        return false;
    }
    match std::fs::write(&marker, b"") {
        Ok(()) => {
            tracing::info!(path = %marker.display(), "created install marker");
            true
        }
        Err(error) => {
            tracing::warn!(%error, path = %marker.display(), "could not create install marker");
            false
        }
    }
}

fn prepare_data_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    let root = data_root(app)?;
    let data = root.join("data");
    if let Err(error) = std::fs::create_dir_all(&data) {
        tracing::warn!(%error, path = %data.display(), "could not create data folder");
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) = std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
        {
            tracing::warn!(%error, path = %root.display(), "could not restrict data folder");
        }
    }
    ensure_install_marker(&root);
    tracing::info!(path = %root.display(), "app data folder ready");
    Ok(root)
}

#[tauri::command]
async fn persist_read(
    state: State<'_, DataPaths>,
    name: String,
    owner: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    Ok(persist::read(&state.root, owner.as_deref().unwrap_or("guest"), &name).await)
}

#[tauri::command]
async fn persist_write(
    state: State<'_, DataPaths>,
    name: String,
    data: serde_json::Value,
    owner: Option<String>,
) -> Result<bool, String> {
    persist::write(
        &state.root,
        owner.as_deref().unwrap_or("guest"),
        &name,
        &data,
    )
    .await?;
    Ok(true)
}

#[tauri::command]
fn os_scroll_direction() -> Option<bool> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let output = Command::new("reg")
            .args([
                "query",
                "HKCU\\Control Panel\\Desktop",
                "/v",
                "WheelScrollChars",
            ])
            .creation_flags(0x08000000)
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let line = text
            .lines()
            .find(|line| line.contains("WheelScrollChars"))?;
        let value = line
            .split("REG_SZ")
            .nth(1)?
            .trim()
            .split_whitespace()
            .next()?;
        let amount = value.parse::<i32>().ok()?;
        return Some(amount < 0);
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let output = Command::new("defaults")
            .args(["read", "-g", "com.apple.swipescrolldirection"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        return Some(text.trim() == "1");
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        None
    }
}

#[tauri::command]
async fn stream_proxy_port(
    state: State<'_, stream::StreamProxy<stream::Registry>>,
) -> Result<u16, String> {
    state.start().await.map_err(|error| error.to_string())
}

#[tauri::command]
fn stream_register(
    state: State<'_, stream::Registry>,
    id: String,
    url: String,
) -> Result<(), String> {
    state.register(&id, &url).map_err(str::to_owned)
}

#[tauri::command]
async fn track_analysis(
    folders: State<'_, reveal::Folders>,
    local: State<'_, local_library::Service>,
    source: String,
) -> Result<analysis::Analysis, String> {
    if source.starts_with("local:") {
        let path = local
            .track_path(&source)
            .await
            .ok_or_else(|| "Local track is not in the library".to_owned())?;
        return analysis::analyse_source(path, &folders).await;
    }
    analysis::analyse_source(source, &folders).await
}

#[tauri::command]
async fn lyrics_get(
    state: State<'_, lyrics::Service>,
    local: State<'_, local_library::Service>,
    meta: lyrics::LyricsMeta,
) -> Result<Option<lyrics::LyricsResult>, String> {
    let local_path = if meta.id.starts_with("local:") {
        local.track_path(&meta.id).await
    } else {
        None
    };
    Ok(state.get_with_local_path(meta, local_path.as_deref()).await)
}

#[tauri::command]
async fn lyrics_search(
    state: State<'_, lyrics::Service>,
    query: String,
    duration: Option<f64>,
) -> Result<Vec<lyrics::LyricsCandidate>, String> {
    state.search(&query, duration).await
}

#[tauri::command]
async fn lyrics_pick(
    state: State<'_, lyrics::Service>,
    song_id: String,
    provider: String,
    candidate_id: String,
) -> Result<lyrics::LyricsResult, String> {
    state.pick(&song_id, &provider, &candidate_id).await
}

#[tauri::command]
async fn lyrics_reset(state: State<'_, lyrics::Service>, song_id: String) -> Result<(), String> {
    state.reset(&song_id).await;
    Ok(())
}

fn allow_file(app: &AppHandle, path: &str) {
    if let Err(error) = app.asset_protocol_scope().allow_file(path) {
        tracing::warn!(%error, path, "could not allow file for playback");
    }
}

#[tauri::command]
async fn local_library_get(
    state: State<'_, local_library::Service>,
) -> Result<local_library::LocalLibrary, String> {
    Ok(state.library().await)
}

#[tauri::command]
async fn local_library_add_folders(
    app: AppHandle,
    state: State<'_, local_library::Service>,
    folders: State<'_, reveal::Folders>,
    paths: Vec<String>,
) -> Result<local_library::AddResult, String> {
    for path in &paths {
        folders.check(Path::new(path))?;
    }
    let result = state.add_folders(paths).await?;
    local_library::sync_watches(&app).await;
    Ok(result)
}

#[tauri::command]
async fn local_library_scan(
    state: State<'_, local_library::Service>,
    folders: State<'_, reveal::Folders>,
    filter_non_music: bool,
) -> Result<local_library::LocalLibrary, String> {
    state.scan(filter_non_music, &folders).await
}

#[tauri::command]
async fn local_library_remove_folder(
    app: AppHandle,
    state: State<'_, local_library::Service>,
    path: String,
) -> Result<local_library::LocalLibrary, String> {
    let library = state.remove_folder(&path).await?;
    local_library::sync_watches(&app).await;
    Ok(library)
}

#[tauri::command]
async fn local_library_rename_folder(
    state: State<'_, local_library::Service>,
    path: String,
    display_name: String,
) -> Result<local_library::LocalLibrary, String> {
    state.rename_folder(&path, &display_name).await
}

#[tauri::command]
async fn local_library_folder_statuses(
    state: State<'_, local_library::Service>,
) -> Result<Vec<local_library::FolderStatus>, String> {
    Ok(state.folder_statuses().await)
}

#[tauri::command]
async fn local_library_opened(
    state: State<'_, local_library::Service>,
) -> Result<Vec<local_library::LocalTrack>, String> {
    Ok(state.opened().await)
}

#[tauri::command]
async fn local_library_forget_opened(
    state: State<'_, local_library::Service>,
    id: String,
) -> Result<Vec<local_library::LocalTrack>, String> {
    state.forget_opened(&id).await
}

#[tauri::command]
async fn local_library_open_files(
    app: AppHandle,
    state: State<'_, local_library::Service>,
    folders: State<'_, reveal::Folders>,
    paths: Vec<String>,
) -> Result<local_library::OpenResult, String> {
    let result = state.open_files(paths).await?;
    for folder in &result.folders {
        reveal::approve_user_folder(&app, &folders, PathBuf::from(folder)).await?;
    }
    for track in &result.tracks {
        allow_file(&app, &track.path);
    }
    Ok(result)
}

#[tauri::command]
fn google_account_get(google: State<'_, Arc<google_auth::GoogleAuth>>) -> google_auth::GoogleAccount {
    google.account()
}

#[tauri::command]
async fn google_sign_in(
    app: AppHandle,
    google: State<'_, Arc<google_auth::GoogleAuth>>,
) -> Result<google_auth::GoogleAccount, String> {
    let account = google
        .sign_in(&google_auth::SystemBrowser(app.clone()))
        .await?;
    let _ = app.emit("google-auth-changed", &account);
    app.state::<Arc<YtEngine>>().resume();
    spawn_sync(&app, app.state::<Arc<YtEngine>>().inner().clone());
    Ok(account)
}

type YtEngine = sync_queue::Engine<Arc<google_auth::GoogleAuth>>;

fn emit_sync(app: &AppHandle, event: sync_queue::Event) {
    match event {
        sync_queue::Event::Progress(status) => {
            let _ = app.emit("yt-sync-progress", status);
        }
        sync_queue::Event::Linked {
            local_playlist_id,
            yt_playlist_id,
        } => {
            let _ = app.emit(
                "yt-playlist-linked",
                serde_json::json!({ "localPlaylistId": local_playlist_id, "ytPlaylistId": yt_playlist_id }),
            );
        }
    }
}

fn spawn_sync(app: &AppHandle, engine: Arc<YtEngine>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let emit = move |event: sync_queue::Event| emit_sync(&app, event);
        if engine.run(&emit).await == Some(sync_queue::Halt::Offline) {
            let _ = android::schedule_retry();
        }
    });
}

#[cfg(target_os = "android")]
const BACKGROUND_DONE: i32 = 0;
#[cfg(target_os = "android")]
const BACKGROUND_OFFLINE: i32 = 1;
#[cfg(target_os = "android")]
const BACKGROUND_NOT_READY: i32 = 2;

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_hushio_player_SyncNative_runSync(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) -> i32 {
    let Some(app) = android::app() else {
        return BACKGROUND_NOT_READY;
    };
    let engine = app.state::<Arc<YtEngine>>().inner().clone();
    let emit = |_: sync_queue::Event| {};
    match tauri::async_runtime::block_on(engine.run(&emit)) {
        Some(sync_queue::Halt::Offline) => BACKGROUND_OFFLINE,
        _ => BACKGROUND_DONE,
    }
}

#[tauri::command]
async fn yt_sync_status(engine: State<'_, Arc<YtEngine>>) -> Result<sync_queue::Status, String> {
    Ok(engine.status().await)
}

#[tauri::command]
async fn yt_sync_now(
    app: AppHandle,
    engine: State<'_, Arc<YtEngine>>,
) -> Result<sync_queue::Status, String> {
    spawn_sync(&app, engine.inner().clone());
    Ok(engine.status().await)
}

#[tauri::command]
async fn yt_enqueue(
    app: AppHandle,
    engine: State<'_, Arc<YtEngine>>,
    jobs: Vec<sync_queue::JobInput>,
) -> Result<(), String> {
    engine.enqueue(jobs).await?;
    spawn_sync(&app, engine.inner().clone());
    Ok(())
}

#[tauri::command]
async fn yt_rate(
    app: AppHandle,
    engine: State<'_, Arc<YtEngine>>,
    video_id: String,
    like: bool,
) -> Result<(), String> {
    let kind = if like { sync_queue::Kind::Like } else { sync_queue::Kind::Unlike };
    let job = sync_queue::JobInput {
        kind,
        local_playlist_id: None,
        yt_playlist_id: None,
        video_id: Some(video_id),
        payload: None,
    };
    engine.enqueue(vec![job]).await?;
    spawn_sync(&app, engine.inner().clone());
    Ok(())
}

#[tauri::command]
async fn yt_my_playlists(engine: State<'_, Arc<YtEngine>>) -> Result<Vec<yt_data_api::RemotePlaylist>, String> {
    engine.my_playlists().await
}

#[tauri::command]
async fn yt_playlist_videos(
    engine: State<'_, Arc<YtEngine>>,
    playlist_id: String,
) -> Result<Vec<yt_data_api::RemoteVideo>, String> {
    engine.playlist_videos(&playlist_id).await
}

#[tauri::command]
async fn yt_link_playlist(
    engine: State<'_, Arc<YtEngine>>,
    local_playlist_id: String,
    yt_playlist_id: String,
) -> Result<(), String> {
    engine.link(&local_playlist_id, &yt_playlist_id).await
}

#[tauri::command]
async fn yt_unlink_playlist(engine: State<'_, Arc<YtEngine>>, local_playlist_id: String) -> Result<(), String> {
    engine.unlink(&local_playlist_id).await
}

#[tauri::command]
fn yt_tv_status(tv: State<'_, Arc<yt_innertube_auth::Innertube>>) -> yt_innertube_auth::TvStatus {
    tv.status()
}

#[tauri::command]
async fn yt_tv_connect(
    app: AppHandle,
    tv: State<'_, Arc<yt_innertube_auth::Innertube>>,
) -> Result<yt_innertube_auth::TvStatus, String> {
    let emit = |code: yt_innertube_auth::TvCode| {
        let _ = app.emit("yt-tv-code", code);
    };
    if tv.connect(&emit).await? {
        spawn_sync(&app, app.state::<Arc<YtEngine>>().inner().clone());
    }
    Ok(tv.status())
}

#[tauri::command]
fn yt_tv_cancel(tv: State<'_, Arc<yt_innertube_auth::Innertube>>) -> bool {
    tv.cancel()
}

#[tauri::command]
async fn yt_tv_disconnect(
    tv: State<'_, Arc<yt_innertube_auth::Innertube>>,
) -> Result<yt_innertube_auth::TvStatus, String> {
    tv.disconnect().await
}

#[tauri::command]
fn yt_tv_open(app: AppHandle) -> Result<(), String> {
    use google_auth::Browser;
    google_auth::SystemBrowser(app).open(yt_innertube_auth::VERIFICATION_URL)
}

#[tauri::command]
fn google_sign_in_cancel(google: State<'_, Arc<google_auth::GoogleAuth>>) -> bool {
    google.cancel_sign_in()
}

#[tauri::command]
async fn google_sign_out(
    google: State<'_, Arc<google_auth::GoogleAuth>>,
) -> Result<google_auth::GoogleAccount, String> {
    Ok(google.sign_out().await)
}

#[tauri::command]
fn spotify_status(spotify: State<'_, Arc<spotify_auth::SpotifyAuth>>) -> spotify_auth::SpotifyAccount {
    spotify.account()
}

#[tauri::command]
async fn spotify_sign_in(
    app: AppHandle,
    spotify: State<'_, Arc<spotify_auth::SpotifyAuth>>,
) -> Result<spotify_auth::SpotifyAccount, String> {
    spotify
        .sign_in(&spotify_auth::SpotifyBrowser(app.clone()))
        .await
}

#[tauri::command]
fn spotify_sign_out(spotify: State<'_, Arc<spotify_auth::SpotifyAuth>>) -> spotify_auth::SpotifyAccount {
    spotify.sign_out()
}

#[tauri::command]
async fn spotify_access_token(spotify: State<'_, Arc<spotify_auth::SpotifyAuth>>) -> Result<String, String> {
    spotify.access_token().await
}

async fn keep_google_session(app: AppHandle, google: Arc<google_auth::GoogleAuth>) {
    loop {
        match google.resume().await {
            google_auth::Resume::Nothing => return,
            google_auth::Resume::Ready(account) => {
                let _ = app.emit("google-auth-changed", &account);
                spawn_sync(&app, app.state::<Arc<YtEngine>>().inner().clone());
                return;
            }
            google_auth::Resume::SignedOut(account) => {
                let _ = app.emit("google-auth-changed", &account);
                return;
            }
            google_auth::Resume::Retry => tokio::time::sleep(google_auth::REFRESH_RETRY).await,
        }
    }
}

#[tauri::command]
async fn local_library_track_path(
    state: State<'_, local_library::Service>,
    id: String,
) -> Result<Option<String>, String> {
    Ok(state.track_path(&id).await)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPlaybackSource {
    url: String,
    mime: String,
}

#[tauri::command]
async fn local_playback_source(
    proxy: State<'_, stream::StreamProxy<stream::Registry>>,
    local: State<'_, local_library::Service>,
    folders: State<'_, reveal::Folders>,
    id: String,
) -> Result<LocalPlaybackSource, String> {
    let path = local
        .track_path(&id)
        .await
        .ok_or_else(|| "Local track is not in the library".to_owned())?;
    folders.check(Path::new(&path))?;
    proxy.register_local_file(&id, Path::new(&path))?;
    let port = proxy.start().await.map_err(|error| error.to_string())?;
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .essence_str()
        .to_owned();
    Ok(LocalPlaybackSource {
        url: format!("http://127.0.0.1:{port}/?id={id}"),
        mime,
    })
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        crash::record_panic(&panic_message(info));
        previous(info);
    }));
}

fn panic_message(info: &std::panic::PanicHookInfo<'_>) -> String {
    let payload = info.payload();
    if let Some(text) = payload.downcast_ref::<&str>() {
        return (*text).to_owned();
    }
    if let Some(text) = payload.downcast_ref::<String>() {
        return text.clone();
    }
    "The app stopped unexpectedly.".to_owned()
}

/// Diagnostic sink for the frontend.
///
/// On iOS a release build has no visible console: JavaScript `console.warn` reaches
/// neither the device log nor `devicectl --console`, which makes device-only playback
/// failures impossible to diagnose. The frontend forwards those messages here and they
/// come out of the Rust tracing subscriber, i.e. on the app's stdout, which
/// `xcrun devicectl device process launch --console` captures.
///
/// Deliberately message-only: callers must never pass credentials, tokens or URLs with
/// signatures (see the call sites, which log hosts and codes rather than full URLs).
#[tauri::command]
fn js_log(level: String, message: String) {
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", "{message}"),
        "warn" => tracing::warn!(target: "frontend", "{message}"),
        _ => tracing::info!(target: "frontend", "{message}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .event_format(LogPrefix)
        .with_max_level(tracing::Level::INFO)
        .init();
    install_panic_hook();
    #[cfg(desktop)]
    media_controls::set_app_id();

    let mut builder = tauri::Builder::<tauri::Wry>::default();
    #[cfg(desktop)]
    if std::env::var(ALLOW_MULTI_ENV).ok().as_deref() != Some("1") {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            launch::receive(app, &argv, std::path::Path::new(&cwd));
            window::show_main(app);
        }));
    }
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder = builder.plugin(tauri_plugin_deep_link::init());
    #[cfg(desktop)]
    {
        builder = builder.plugin(window::state_plugin());
    }
    for plugin in tauri_plugin_hushio_player::plugins() {
        builder = builder.plugin(plugin);
    }
    let app = builder
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            {
                window::on_window_event(window, event);
                pip::on_window_event(window, event);
            }
            #[cfg(not(desktop))]
            let _ = (window, event);
        })
        .on_page_load(|webview, payload| {
            #[cfg(desktop)]
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                window::on_navigation_started(webview.app_handle());
            }
            #[cfg(not(desktop))]
            let _ = (webview, payload);
        })
        .register_uri_scheme_protocol("localart", |context, request| {
            let art_dir = context.app_handle().state::<local_library::Service>().art_dir();
            local_library::serve_art(&art_dir, request.uri().path())
        })
        .register_uri_scheme_protocol("netmusic", |context, request| {
            let network = context.app_handle().state::<Arc<network::Service>>();
            let request = tauri::http::Request::from_parts(request.into_parts().0, Vec::new());
            tauri::async_runtime::block_on(network::serve_track(&network, &request))
        })
        .setup(|app| {
            android::init(app.handle());
            #[cfg(desktop)]
            app.manage(playback::Engine::new(app.handle().clone()));
            let root = prepare_data_dir(app.handle())?;
            let default_dir = if cfg!(target_os = "android") {
                app.path().app_cache_dir()?.join(format!("{APP_SLUG}-downloads"))
            } else {
                app.path().download_dir()?.join(APP_NAME)
            };
            let stored_settings = tauri::async_runtime::block_on(persist::read(&root, "guest", "settings"));
            cache::set_limit_mb(cache::limit_mb_from_settings(stored_settings.as_ref()));
            if cfg!(target_os = "android") {
                let images = app.path().app_cache_dir()?.join("images");
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = cache_limit::trim_dir(&images, cache::limit_bytes()) {
                        tracing::warn!(%error, "image cache not trimmed");
                    }
                });
            }
            let export_dir = app.path().audio_dir().ok().map(|dir| dir.join(APP_NAME));
            let folders = tauri::async_runtime::block_on(reveal::Folders::open(
                &root,
                default_dir.clone(),
                export_dir,
            ));
            folders.approve_library(tauri::async_runtime::block_on(local_library::stored_folder_paths(&root)));
            reveal::allow_picked(app.handle(), &folders)?;
            reveal::allow_asset(app.handle(), &root.join(playlist_cover::COVER_DIR))?;
            app.manage(folders);
            let local = tauri::async_runtime::block_on(local_library::Service::load(root.clone()));
            app.manage(local);
            local_library::start_watching(app.handle());
            let stats_root = root.clone();
            let sync_root = root.clone();
            let scrobble_root = root.clone();
            let network_root = root.clone();
            let discord_root = root.clone();
            let crash_root = root.clone();
            let lyrics_root = root.clone();
            app.manage(DataPaths { root });
            #[cfg(desktop)]
            app.manage(tray::Tray::default());
            #[cfg(desktop)]
            {
                let updates = updates::Service::shared(app.package_info().version.to_string());
                app.manage(updates);
                updates::start(app.handle().clone());
                app.manage(window::Glass::default());
                app.manage(pip::Pip::default());
            }
            #[cfg(desktop)]
            linux_session::setup(app.handle());
            #[cfg(desktop)]
            linux_portal::start(app.handle());
            #[cfg(desktop)]
            tray::setup(app.handle());
            #[cfg(desktop)]
            taskbar::setup(app.handle());
            let controls = media_controls::Controls::default();
            #[cfg(desktop)]
            controls.install(app.handle());
            app.manage(controls);
            app.manage(launch::Pending::default());
            // Runtime custom-scheme registration is a desktop capability. On iOS the
            // schemes are declared statically in `Info.ios.plist` (CFBundleURLTypes),
            // which is how the OS routes them; the deep-link plugin's `register`
            // returns "unsupported platform" there.
            #[cfg(desktop)]
            launch::register_scheme(app.handle());
            let argv: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            launch::receive(app.handle(), &argv, &cwd);
            #[cfg(desktop)]
            window::restore_main(app.handle());
            #[cfg(desktop)]
            window::apply_glass(app.handle());
            let registry = stream::Registry::default();
            app.manage(registry.clone());
            let proxy = stream::StreamProxy::new(registry);
            tauri::async_runtime::block_on(proxy.start())?;
            app.manage(proxy);
            app.manage(tauri::async_runtime::block_on(lyrics::Service::load(lyrics_root))?);
            app.manage(downloads::Downloads::new(app.handle().clone(), default_dir));
            let stats = Arc::new(tauri::async_runtime::block_on(stats::Service::load(stats_root)));
            tauri::async_runtime::spawn(stats.clone().run_flush());
            app.manage(stats);
            let vault = secrets::keystore();
            let scrobbles = Arc::new(tauri::async_runtime::block_on(scrobble::Service::load(
                scrobble_root,
                vault.clone(),
            )));
            tauri::async_runtime::spawn(scrobbles.clone().run_retry());
            app.manage(scrobbles);
            let network = Arc::new(tauri::async_runtime::block_on(network::Service::load(
                network_root,
                vault,
            )));
            app.state::<stream::StreamProxy<stream::Registry>>().set_network(network.clone());
            app.manage(network);
            crash::set_crash_root(crash_root.clone());
            let crashes = Arc::new(tauri::async_runtime::block_on(crash::Service::load(crash_root.clone())));
            tauri::async_runtime::block_on(crashes.absorb_crash_file(&crash_root));
            app.manage(crashes);
            let discord = Arc::new(tauri::async_runtime::block_on(discord::Service::load(discord_root)));
            app.manage(discord);
            let google = Arc::new(google_auth::GoogleAuth::new(
                google_auth::OAuthConfig::production(),
                Arc::new(google_auth::KeyringStore),
            ));
            app.manage(google.clone());
            app.manage(Arc::new(spotify_auth::SpotifyAuth::new(
                spotify_auth::OAuthConfig::production(),
                Arc::new(google_auth::KeyringSlot(spotify_auth::TOKEN_SLOT.to_owned())),
            )));
            let tv =Arc::new(yt_innertube_auth::Innertube::new(
                yt_innertube_auth::TvConfig::production(),
                Arc::new(google_auth::KeyringSlot(yt_innertube_auth::TV_TOKEN_SLOT.to_owned())),
            ));
            app.manage(tv.clone());
            let engine = tauri::async_runtime::block_on(sync_queue::Engine::load(
                sync_root,
                yt_data_api::API_BASE,
                google.clone(),
                tv,
            ));
            app.manage(Arc::new(engine));
            tauri::async_runtime::spawn(keep_google_session(app.handle().clone(), google));
            #[cfg(target_os = "macos")]
            macos_window::install(app.handle());
            #[cfg(target_os = "macos")]
            menu::install(app.handle())?;
            #[cfg(target_os = "macos")]
            audio_output::install(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            os_scroll_direction,
            linux_portal::linux_appearance_read,
            linux_session::linux_session_rules,
            audio_output::audio_output_state,
            persist_read,
            persist_write,
            menu::menu_set_playback_state,
            stream_proxy_port,
            stream_register,
            #[cfg(desktop)]
            playback::desktop_playback_load,
            #[cfg(desktop)]
            playback::desktop_playback_control,
            #[cfg(desktop)]
            playback::desktop_playback_devices,
            #[cfg(desktop)]
            playback::desktop_playback_available,
            lyrics_get,
            lyrics_search,
            lyrics_pick,
            lyrics_reset,
            track_analysis,
            download_start,
            download_cancel,
            download_queue,
            reveal::folder_pick,
            js_log,
            notification_state,
            notification_request,
            notification_settings,
            download_delete_file,
            reveal::path_exists,
            reveal::reveal_path,
            reveal::open_folder,
            playlist_cover::playlist_cover_pick,
            playlist_cover::playlist_cover_remove,
            local_library_get,
            local_library_add_folders,
            local_library_scan,
            local_library_remove_folder,
            local_library_rename_folder,
            local_library_folder_statuses,
            local_library_opened,
            local_library_forget_opened,
            local_library_open_files,
            local_library_track_path,
            local_playback_source,
            playback_event,
            replay_summary,
            replay_journal,
            replay_journal_remove,
            cache::cache_size,
            cache::cache_clear,
            cache::cache_set_limit,
            replay_export,
            replay_import,
            google_account_get,
            google_sign_in,
            google_sign_in_cancel,
            google_sign_out,
            spotify_status,
            spotify_sign_in,
            spotify_sign_out,
            spotify_access_token,
            yt_sync_status,
            yt_sync_now,
            yt_enqueue,
            yt_rate,
            yt_my_playlists,
            yt_playlist_videos,
            yt_link_playlist,
            yt_unlink_playlist,
            yt_tv_status,
            yt_tv_connect,
            yt_tv_cancel,
            yt_tv_disconnect,
            yt_tv_open,
            scrobble::scrobble_status,
            scrobble::listenbrainz_connect,
            scrobble::listenbrainz_disconnect,
            scrobble::lastfm_begin_auth,
            scrobble::lastfm_finish_auth,
            scrobble::lastfm_disconnect,
            scrobble::scrobble_set_enabled,
            scrobble::scrobble_love,
            network::network_servers,
            network::network_server_save,
            network::network_server_remove,
            network::network_tracks,
            network::network_track_bytes,
            crash::crash_logs,
            crash::crash_logs_clear,
            discord::discord_status,
            discord::discord_set_enabled,
            disconnect::erase_stop_sync,
            disconnect::erase_resume_sync,
            disconnect::erase_youtube_playlists,
            disconnect::erase_revoke,
            disconnect::erase_keyring,
            disconnect::erase_local_data,
            tray::tray_set_playing,
            media_controls::media_set_track,
            media_controls::media_set_playing,
            media_controls::media_set_position,
            media_controls::media_clear,
            window::window_intro_done,
            install_marker::guest_detect_marker,
            window::window_set_reduce_transparency,
            launch::launch_take,
            pip::pip_toggle,
            pip::pip_is_open,
            pip::pip_close,
            pip::pip_minimize,
            pip::pip_set_compact,
            pip::pip_show_main,
            pip::pip_ready,
            pip::pip_send_state,
            pip::pip_send_command,
            pip::pip_session_erased,
            updates::updates_state,
            updates::updates_check,
            updates::updates_install,
            updates::updates_restart,
            android::update_check,
            android::update_download,
            android::update_install,
            android::update_open_install_settings
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { .. } => {
            #[cfg(desktop)]
            tauri::async_runtime::block_on(app.state::<playback::Engine>().shutdown());
            macos_window::mark_quitting();
            app.state::<downloads::Downloads<AppHandle>>().abandon();
            tauri::async_runtime::block_on(app.state::<Arc<stats::Service>>().flush());
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                macos_window::show_main(app);
            }
        }
        _ => {}
    });
}

#[tauri::command]
fn playback_event(
    stats: State<'_, Arc<stats::Service>>,
    scrobbles: State<'_, Arc<scrobble::Service>>,
    discord: State<'_, Arc<discord::Service>>,
    event: stats::PlaybackEvent,
) -> Result<(), String> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    scrobbles.playback(&event, chrono::Utc::now().timestamp() as u64);
    discord.playback(&event, now_ms);
    stats.playback(&event, chrono::Local::now())
}

#[tauri::command]
fn replay_summary(stats: State<'_, Arc<stats::Service>>, period: String) -> serde_json::Value {
    stats.replay_summary(&period, chrono::Local::now())
}

#[tauri::command]
fn replay_journal(stats: State<'_, Arc<stats::Service>>) -> Vec<stats::JournalEntry> {
    stats.journal()
}

#[tauri::command]
async fn replay_journal_remove(
    stats: State<'_, Arc<stats::Service>>,
    keys: Vec<stats::JournalKey>,
) -> Result<usize, String> {
    stats.journal_remove(&keys).await
}

#[tauri::command]
fn replay_export(stats: State<'_, Arc<stats::Service>>) -> Vec<serde_json::Value> {
    stats.export()
}

#[tauri::command]
fn notification_state() -> Result<String, String> {
    android::notification_state()
}

#[tauri::command]
async fn notification_request() -> Result<String, String> {
    android::notification_request().await
}

#[tauri::command]
fn notification_settings() -> Result<(), String> {
    android::notification_settings()
}

#[tauri::command]
fn download_delete_file(path: String) -> Result<(), String> {
    if path.starts_with("content://") {
        android::media_delete(&path)
    } else {
        Ok(())
    }
}

#[tauri::command]
async fn replay_import(stats: State<'_, Arc<stats::Service>>, buckets: Vec<serde_json::Value>) -> Result<(), String> {
    stats.import(&buckets).await
}

#[tauri::command]
fn download_start(
    state: State<'_, downloads::Downloads<AppHandle>>,
    folders: State<'_, reveal::Folders>,
    track: downloads::TrackInfo,
    url: String,
    dir: Option<String>,
    export_compat: Option<bool>,
) -> Result<(), String> {
    downloads::require_https(&url)?;
    let dir = reveal::target_dir(&folders, export_compat == Some(true), dir.map(PathBuf::from))?;
    state.enqueue(track, url, dir)
}

#[tauri::command]
fn download_cancel(state: State<'_, downloads::Downloads<AppHandle>>, id: String) -> bool {
    state.cancel(&id)
}

#[tauri::command]
fn download_queue(state: State<'_, downloads::Downloads<AppHandle>>) -> Vec<downloads::QueueRow> {
    state.queue()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl Write for Buffer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().expect("lock").extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn log_lines_start_with_slug_prefix() {
        let buffer = Buffer::default();
        let writer = buffer.clone();
        let subscriber = tracing_subscriber::fmt()
            .event_format(LogPrefix)
            .with_writer(move || writer.clone())
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!("app data folder ready");
        });
        let output = String::from_utf8(buffer.0.lock().expect("lock").clone()).expect("utf8");
        assert!(output.starts_with("[hushio] "), "{output}");
    }

    #[test]
    fn install_marker_is_created_once() {
        let root = tempfile::tempdir().expect("temp dir");
        assert!(ensure_install_marker(root.path()));
        assert!(root.path().join(".hushio-install").exists());
        assert!(!ensure_install_marker(root.path()));
    }

    fn bundle_identifier() -> String {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        config["identifier"].as_str().expect("identifier").to_owned()
    }

    #[test]
    fn bundle_identifier_is_the_app_identifier() {
        assert_eq!(bundle_identifier(), "com.hushio.app");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_data_folder_sits_under_application_support_by_identifier() {
        let home = PathBuf::from(std::env::var_os("HOME").expect("HOME is set"));
        let root = home.join("Library/Application Support").join(bundle_identifier());

        assert_eq!(
            persist::store_path(&root, "", "player"),
            root.join("data/guest/player.json")
        );
        assert_eq!(
            persist::store_path(&root, "account-1", "library"),
            root.join("data/account-1/library.json")
        );
        assert_eq!(root.file_name().and_then(|name| name.to_str()), Some("com.hushio.app"));
    }
}
