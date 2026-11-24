mod tags;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::fmt::Display;
use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use regex::Regex;
use reqwest::StatusCode;
use reqwest::header::{CONTENT_TYPE, RANGE};
use serde::{Deserialize, Serialize};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;
use tokio::time::{sleep, timeout};
use tokio_util::sync::CancellationToken;

use crate::APP_SLUG;
use crate::stream::USER_AGENT;
use tags::{Cover, Tags};

const MAX_CONCURRENT: usize = 2;
const STALL: Duration = Duration::from_secs(20);
const ATTEMPTS: u32 = 4;
const BACKOFF: Duration = Duration::from_millis(1500);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const COVER_TIMEOUT: Duration = Duration::from_secs(15);
const COVER_MAX_BYTES: usize = 5 * 1024 * 1024;
const NAME_MAX_CHARS: usize = 120;
const EVENT: &str = "download:event";
const ID_MAX_LEN: usize = 64;
const LINK_MARGIN_SECS: u64 = 5 * 60;
const EXPIRED_MESSAGE: &str = "The link expired. Try again.";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub thumb: Option<String>,
    #[serde(default)]
    pub resume: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    Queued,
    Start,
    Progress,
    Done,
    Failed,
    Expired,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEvent {
    #[serde(rename = "type")]
    pub kind: EventKind,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl DownloadEvent {
    fn new(kind: EventKind, id: &str) -> Self {
        Self {
            kind,
            id: id.to_owned(),
            downloaded: None,
            total: None,
            path: None,
            reason: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueRow {
    pub id: String,
    pub running: bool,
    pub downloaded: u64,
    pub total: u64,
}

pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: DownloadEvent);
}

impl EventSink for tauri::AppHandle {
    fn emit(&self, event: DownloadEvent) {
        if let Err(error) = tauri::Emitter::emit(self, EVENT, event) {
            tracing::warn!(%error, "could not emit download event");
        }
    }
}

#[derive(Clone, Copy)]
pub struct Policy {
    pub stall: Duration,
    pub backoff: Duration,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            stall: STALL,
            backoff: BACKOFF,
        }
    }
}

pub struct Downloads<S: EventSink> {
    inner: Arc<Inner<S>>,
}

struct Inner<S> {
    sink: S,
    default_dir: PathBuf,
    policy: Policy,
    client: reqwest::Client,
    slots: Semaphore,
    jobs: Mutex<BTreeMap<String, Job>>,
    quitting: AtomicBool,
}

struct Job {
    token: CancellationToken,
    part: PathBuf,
    running: bool,
    downloaded: u64,
    total: u64,
}

struct Request {
    track: TrackInfo,
    url: String,
    dir: PathBuf,
    part: PathBuf,
    token: CancellationToken,
}

struct Transferred {
    mime: Option<String>,
}

#[derive(Debug, PartialEq)]
enum Failure {
    Cancelled,
    Expired,
    Failed(String),
}

impl From<io::Error> for Failure {
    fn from(error: io::Error) -> Self {
        Self::Failed(error.to_string())
    }
}

#[derive(Default)]
pub struct Throttle {
    last: Option<Instant>,
}

impl Throttle {
    pub fn ready(&mut self, now: Instant) -> bool {
        match self.last {
            Some(last) if now.duration_since(last) <= PROGRESS_INTERVAL => false,
            _ => {
                self.last = Some(now);
                true
            }
        }
    }
}

impl<S: EventSink> Downloads<S> {
    pub fn new(sink: S, default_dir: PathBuf) -> Self {
        Self::with_policy(sink, default_dir, Policy::default())
    }

    fn with_policy(sink: S, default_dir: PathBuf, policy: Policy) -> Self {
        Self {
            inner: Arc::new(Inner {
                sink,
                default_dir,
                policy,
                client: reqwest::Client::new(),
                slots: Semaphore::new(MAX_CONCURRENT),
                jobs: Mutex::new(BTreeMap::new()),
                quitting: AtomicBool::new(false),
            }),
        }
    }

    pub fn enqueue(
        &self,
        track: TrackInfo,
        url: String,
        dir: Option<PathBuf>,
    ) -> Result<(), String> {
        if !valid_id(&track.id) {
            return Err("Track id is not valid".to_owned());
        }
        let dir = match dir {
            _ if cfg!(target_os = "android") => self.inner.default_dir.clone(),
            Some(dir) if !dir.is_absolute() => {
                return Err("Download folder must be an absolute path".to_owned());
            }
            Some(dir) => dir,
            None => self.inner.default_dir.clone(),
        };
        let part = part_path(&dir, &track.id);
        let token = CancellationToken::new();
        {
            let mut jobs = lock(&self.inner.jobs);
            if jobs.contains_key(&track.id) {
                return Err("Already downloading this track".to_owned());
            }
            jobs.insert(
                track.id.clone(),
                Job {
                    token: token.clone(),
                    part: part.clone(),
                    running: false,
                    downloaded: 0,
                    total: 0,
                },
            );
        }
        self.inner
            .sink
            .emit(DownloadEvent::new(EventKind::Queued, &track.id));
        tracing::info!(id = %track.id, dir = %dir.display(), "download queued");
        let inner = Arc::clone(&self.inner);
        let request = Request {
            track,
            url,
            dir,
            part,
            token,
        };
        tauri::async_runtime::spawn(async move { inner.run(request).await });
        Ok(())
    }

    pub fn cancel(&self, id: &str) -> bool {
        match lock(&self.inner.jobs).get(id) {
            Some(job) => {
                job.token.cancel();
                true
            }
            None => false,
        }
    }

    pub fn queue(&self) -> Vec<QueueRow> {
        lock(&self.inner.jobs)
            .iter()
            .map(|(id, job)| QueueRow {
                id: id.clone(),
                running: job.running,
                downloaded: job.downloaded,
                total: job.total,
            })
            .collect()
    }

    pub fn abandon(&self) {
        self.inner.quitting.store(true, Ordering::SeqCst);
        for job in lock(&self.inner.jobs).values() {
            job.token.cancel();
            remove_partials(&job.part);
        }
    }
}

impl<S: EventSink> Inner<S> {
    async fn run(&self, request: Request) {
        let id = request.track.id.clone();
        let outcome = match self.download(&request).await {
            Err(Failure::Expired) if request.track.resume => {
                Err(Failure::Failed(EXPIRED_MESSAGE.to_owned()))
            }
            other => other,
        };
        if !matches!(outcome, Err(Failure::Expired)) {
            remove_partials(&request.part);
        }
        lock(&self.jobs).remove(&id);
        match outcome {
            Ok(path) => self.sink.emit(DownloadEvent {
                path: Some(path.display().to_string()),
                ..DownloadEvent::new(EventKind::Done, &id)
            }),
            Err(Failure::Cancelled) if self.quitting.load(Ordering::SeqCst) => {}
            Err(Failure::Cancelled) => self
                .sink
                .emit(DownloadEvent::new(EventKind::Cancelled, &id)),
            Err(Failure::Expired) => self
                .sink
                .emit(DownloadEvent::new(EventKind::Expired, &id)),
            Err(Failure::Failed(reason)) => {
                tracing::warn!(%id, %reason, "download failed");
                self.sink.emit(DownloadEvent {
                    reason: Some(reason),
                    ..DownloadEvent::new(EventKind::Failed, &id)
                });
            }
        }
    }

    async fn download(&self, request: &Request) -> Result<PathBuf, Failure> {
        let slot = until_cancelled(&request.token, async {
            self.slots
                .acquire()
                .await
                .map_err(|error| Failure::Failed(error.to_string()))
        })
        .await?;
        if link_expires_soon(&request.url, now_secs()) {
            return Err(Failure::Expired);
        }
        self.mark_running(&request.track.id);
        self.sink
            .emit(DownloadEvent::new(EventKind::Start, &request.track.id));
        tokio::fs::create_dir_all(&request.dir).await?;
        let transferred = self.attempts(request).await?;
        drop(slot);
        self.finish(request, transferred).await
    }

    async fn attempts(&self, request: &Request) -> Result<Transferred, Failure> {
        let mut throttle = Throttle::default();
        let mut attempt: u32 = 1;
        loop {
            let from = if attempt == 1 && !request.track.resume {
                0
            } else {
                std::fs::metadata(&request.part).map_or(0, |meta| meta.len())
            };
            match self.transfer(request, from, &mut throttle).await {
                Ok(transferred) => return Ok(transferred),
                Err(Failure::Cancelled) => return Err(Failure::Cancelled),
                Err(Failure::Expired) => return Err(Failure::Expired),
                Err(Failure::Failed(reason)) if attempt >= ATTEMPTS => {
                    return Err(Failure::Failed(reason));
                }
                Err(Failure::Failed(reason)) => {
                    tracing::warn!(id = %request.track.id, %reason, attempt, "download attempt failed, trying again");
                    let pause = self.policy.backoff * attempt;
                    until_cancelled(&request.token, async {
                        sleep(pause).await;
                        Ok(())
                    })
                    .await?;
                    attempt += 1;
                }
            }
        }
    }

    async fn transfer(
        &self,
        request: &Request,
        from: u64,
        throttle: &mut Throttle,
    ) -> Result<Transferred, Failure> {
        let head = self
            .client
            .get(&request.url)
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .header(RANGE, format!("bytes={from}-"))
            .send();
        let mut response =
            until_cancelled(&request.token, stalled(self.policy.stall, head)).await?;
        tracing::info!(
            id = %request.track.id,
            status = response.status().as_u16(),
            content_length = response.content_length().unwrap_or(0),
            from,
            "download response"
        );
        if matches!(response.status(), StatusCode::FORBIDDEN | StatusCode::GONE) {
            return Err(Failure::Expired);
        }
        if !response.status().is_success() {
            return Err(Failure::Failed(format!(
                "HTTP {}",
                response.status().as_u16()
            )));
        }

        let resumed = response.status() == StatusCode::PARTIAL_CONTENT && from > 0;
        let start = if resumed { from } else { 0 };
        let total = start + response.content_length().unwrap_or(0);
        let mime = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(!resumed)
            .append(resumed)
            .open(&request.part)
            .await?;

        let mut written = start;
        loop {
            let chunk =
                until_cancelled(&request.token, stalled(self.policy.stall, response.chunk()))
                    .await?;
            let Some(bytes) = chunk else { break };
            file.write_all(&bytes).await?;
            written += bytes.len() as u64;
            self.record(request, throttle, written, total);
        }
        file.flush().await?;

        if total > 0 && written < total {
            return Err(Failure::Failed("download ended early".to_owned()));
        }
        Ok(Transferred { mime })
    }

    async fn finish(
        &self,
        request: &Request,
        transferred: Transferred,
    ) -> Result<PathBuf, Failure> {
        let webm = transferred.mime.as_deref().is_some_and(is_webm);
        if !webm {
            let cover = self
                .fetch_cover(request.track.thumb.as_deref(), &request.token)
                .await;
            if request.token.is_cancelled() {
                return Err(Failure::Cancelled);
            }
            let tags = Tags {
                title: request.track.title.clone(),
                artist: request.track.artist.clone(),
                album: request
                    .track
                    .album
                    .clone()
                    .filter(|album| !album.trim().is_empty()),
                cover,
            };
            let part = request.part.clone();
            match tokio::task::spawn_blocking(move || tags::write(&part, &tags)).await {
                Ok(Ok(())) => {}
                Ok(Err(reason)) => {
                    tracing::warn!(id = %request.track.id, %reason, "tags not written");
                }
                Err(error) => tracing::warn!(id = %request.track.id, %error, "tagging stopped"),
            }
        }
        if request.token.is_cancelled() {
            return Err(Failure::Cancelled);
        }

        let extension = if webm { "webm" } else { "m4a" };
        let stem = sanitize_filename(&format!(
            "{} - {}",
            request.track.artist, request.track.title
        ));
        if cfg!(target_os = "android") {
            let part = request.part.to_string_lossy().into_owned();
            let uri = crate::android::publish_download(&part, &format!("{stem}.{extension}"))
                .await
                .map_err(Failure::Failed)?;
            remove_file_logged(&request.part);
            return Ok(PathBuf::from(uri));
        }
        let dest = claim_name(&request.dir, &stem, extension)?;
        tracing::info!(id = %request.track.id, dest = %dest.display(), "download finishing");
        if let Err(error) = tokio::fs::rename(&request.part, &dest).await {
            remove_file_logged(&dest);
            return Err(error.into());
        }
        Ok(dest)
    }

    async fn fetch_cover(&self, thumb: Option<&str>, token: &CancellationToken) -> Option<Cover> {
        let url = cover_url(thumb?)?;
        let fetch = timeout(COVER_TIMEOUT, self.read_cover(&url));
        let result = tokio::select! {
            () = token.cancelled() => return None,
            result = fetch => result,
        };
        match result {
            Ok(Ok(Some(bytes))) => Cover::sniff(bytes),
            Ok(Ok(None)) => None,
            Ok(Err(error)) => {
                tracing::warn!(%error, "cover not fetched");
                None
            }
            Err(_) => {
                tracing::warn!("cover fetch timed out");
                None
            }
        }
    }

    async fn read_cover(&self, url: &str) -> reqwest::Result<Option<Vec<u8>>> {
        let mut response = self
            .client
            .get(url)
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if body.len() + chunk.len() > COVER_MAX_BYTES {
                return Ok(None);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(Some(body))
    }

    fn mark_running(&self, id: &str) {
        if let Some(job) = lock(&self.jobs).get_mut(id) {
            job.running = true;
        }
    }

    fn record(&self, request: &Request, throttle: &mut Throttle, downloaded: u64, total: u64) {
        if let Some(job) = lock(&self.jobs).get_mut(&request.track.id) {
            job.downloaded = downloaded;
            job.total = total;
        }
        if throttle.ready(Instant::now()) {
            self.sink.emit(DownloadEvent {
                downloaded: Some(downloaded),
                total: Some(total),
                ..DownloadEvent::new(EventKind::Progress, &request.track.id)
            });
        }
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

fn link_expires_soon(url: &str, now: u64) -> bool {
    Regex::new(r"[?&/]expire[=/](\d{9,11})")
        .expect("static regex")
        .captures(url)
        .and_then(|caps| caps.get(1)?.as_str().parse::<u64>().ok())
        .is_some_and(|expire| expire <= now + LINK_MARGIN_SECS)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().expect("download queue lock")
}

async fn until_cancelled<T>(
    token: &CancellationToken,
    work: impl Future<Output = Result<T, Failure>>,
) -> Result<T, Failure> {
    tokio::select! {
        () = token.cancelled() => Err(Failure::Cancelled),
        result = work => result,
    }
}

async fn stalled<T, E: Display>(
    stall: Duration,
    work: impl Future<Output = Result<T, E>>,
) -> Result<T, Failure> {
    match timeout(stall, work).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(Failure::Failed(error.to_string())),
        Err(_) => Err(Failure::Failed("download stalled".to_owned())),
    }
}

pub fn require_https(url: &str) -> Result<(), String> {
    if url.starts_with("https://") {
        Ok(())
    } else {
        Err("stream url must be https".to_owned())
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= ID_MAX_LEN
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn part_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!(".{APP_SLUG}-{id}.part"))
}

fn remove_partials(part: &Path) {
    remove_file_logged(part);
    remove_file_logged(&PathBuf::from(format!("{}.tagging", part.display())));
}

fn remove_file_logged(path: &Path) {
    if let Err(error) = std::fs::remove_file(path) {
        if error.kind() != io::ErrorKind::NotFound {
            tracing::warn!(%error, path = %path.display(), "could not remove download file");
        }
    }
}

fn is_webm(mime: &str) -> bool {
    let lower = mime.to_ascii_lowercase();
    lower.contains("webm") || lower.contains("opus")
}

fn cover_url(thumb: &str) -> Option<String> {
    let url = thumb.trim();
    if !url.starts_with("https://") {
        return None;
    }
    let sized = Regex::new(r"=s\d+")
        .expect("static regex")
        .replace_all(url, "=s1000");
    let sized = Regex::new(r"=w\d+(-c)?-h\d+")
        .expect("static regex")
        .replace_all(&sized, "=w1000${1}-h1000");
    Some(sized.into_owned())
}

fn is_unsafe_char(c: char) -> bool {
    matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        || c <= '\u{1f}'
        || ('\u{200b}'..='\u{200f}').contains(&c)
        || ('\u{202a}'..='\u{202e}').contains(&c)
        || ('\u{2060}'..='\u{206f}').contains(&c)
        || c == '\u{feff}'
}

fn sanitize_filename(input: &str) -> String {
    let replaced: String = input
        .chars()
        .map(|c| if is_unsafe_char(c) { '_' } else { c })
        .collect();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim();
    let capped: String = if trimmed.is_empty() {
        "track".to_owned()
    } else {
        trimmed.chars().take(NAME_MAX_CHARS).collect()
    };
    if is_reserved(&capped) {
        format!("_{capped}")
    } else {
        capped
    }
}

fn is_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    let bytes = stem.as_bytes();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || (bytes.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && (b'1'..=b'9').contains(&bytes[3]))
}

fn claim_name(dir: &Path, stem: &str, extension: &str) -> io::Result<PathBuf> {
    let mut n = 1;
    loop {
        let name = if n == 1 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem} ({n}).{extension}")
        };
        let path = dir.join(name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => n += 1,
            Err(error) => return Err(error),
        }
    }
}
