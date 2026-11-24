import { getVersion, onBackButtonPress } from "@tauri-apps/api/app";
import { addPluginListener, convertFileSrc, invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PipCommand, PipSnapshot } from "../pip/types";
import type { PlayerQueueItem, PlayerSnapshot } from "./androidPlayback";
import type { LaunchPayload } from "./launchLink";
import type { AudioOutputState } from "./outputDevices";
import type { JournalEntry, ReplayData } from "./replay";
import type { DesktopScheme } from "./theme";
import type { UpdateState } from "./updates";

export type Platform = "windows" | "macos" | "linux" | "android" | "ios";

export function detectPlatform(ua: string): Platform {
  // iPhone/iPad/iPod user agents also contain "Mac OS X", and iPadOS 13+ can
  // masquerade as "Macintosh", so iOS must be checked before the Mac branch.
  // A user agent alone cannot reliably distinguish iPadOS 13+ from a Mac; the
  // phone shell targets iPhone and does not add a tablet-specific layout.
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Linux/.test(ua)) return "linux";
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  throw new Error(`Unsupported platform: ${ua}`);
}

export const platform: Platform = detectPlatform(navigator.userAgent);

export async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (String(error).includes("not found")) {
      throw new Error(`Native command "${command}" is not available`);
    }
    throw error;
  }
}

export function showMainWindow(): Promise<void> {
  return getCurrentWindow().show();
}

export function appVersion(): Promise<string> {
  return getVersion();
}

export function setFullScreen(enabled: boolean): Promise<void> {
  return getCurrentWindow().setFullscreen(enabled);
}

export function minimizeWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}

export function toggleMaximizeWindow(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

export function closeWindow(): Promise<void> {
  return getCurrentWindow().close();
}

export async function watchWindowMaximized(onChange: (value: boolean) => void): Promise<() => void> {
  const current = getCurrentWindow();
  const update = () => {
    void current.isMaximized().then(onChange);
  };
  const unlisten = await current.onResized(update);
  update();
  return unlisten;
}

export async function watchFullScreen(onChange: (value: boolean) => void): Promise<() => void> {
  const current = getCurrentWindow();
  const update = () => {
    void current.isFullscreen().then(onChange);
  };
  const unlisten = await current.onResized(update);
  update();
  return unlisten;
}

export function persistRead<T>(name: string, owner: string): Promise<T | null> {
  return call<T | null>("persist_read", { name, owner });
}

export function persistWrite(name: string, data: unknown, owner: string): Promise<boolean> {
  return call<boolean>("persist_write", { name, data, owner });
}

export function updatesState(): Promise<UpdateState> {
  return call<UpdateState>("updates_state");
}

export function updatesCheck(): Promise<void> {
  return call<void>("updates_check");
}

export function updatesInstall(): Promise<void> {
  return call<void>("updates_install");
}

export function updatesRestart(): Promise<void> {
  return call<void>("updates_restart");
}

export function listenUpdates(onChange: (state: UpdateState) => void): Promise<UnlistenFn> {
  return listen<UpdateState>("updates:changed", (event) => onChange(event.payload));
}

export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

export type PlaybackKind = "start" | "resume" | "pause" | "progress" | "stop";

export type WireTrack = {
  id: string;
  title: string;
  artist: string;
  thumb: string | null;
  duration?: number;
  episode?: true;
};

export type PlaybackEventPayload = { type: PlaybackKind; track?: WireTrack; deltaMs?: number; history?: boolean };

export function playbackEvent(event: PlaybackEventPayload): Promise<void> {
  return call<void>("playback_event", { event });
}

export function replaySummary(period: string): Promise<ReplayData> {
  return call<ReplayData>("replay_summary", { period });
}

export function replayJournal(): Promise<JournalEntry[]> {
  return call<JournalEntry[]>("replay_journal");
}

export function replayJournalRemove(keys: { at: number; id: string }[]): Promise<number> {
  return call<number>("replay_journal_remove", { keys });
}

export type CacheUsage = { bytes: number; files: number };

export function cacheSize(): Promise<CacheUsage> {
  return call<CacheUsage>("cache_size");
}

export function cacheClear(): Promise<CacheUsage> {
  return call<CacheUsage>("cache_clear");
}

export function cacheSetLimit(megabytes: number): Promise<CacheUsage> {
  return call<CacheUsage>("cache_set_limit", { megabytes });
}

export async function copyImage(png: Uint8Array): Promise<void> {
  const image = await Image.fromBytes(png);
  await writeImage(image);
}

export function replayExport(): Promise<unknown[]> {
  return call<unknown[]>("replay_export");
}

export function replayImport(buckets: unknown[]): Promise<void> {
  return call<void>("replay_import", { buckets });
}

export function streamProxyPort(): Promise<number> {
  return call<number>("stream_proxy_port");
}

export function registerStreamUrl(id: string, url: string): Promise<void> {
  return call<void>("stream_register", { id, url });
}

const PLAYER_PLUGIN = "hushio-player";

function playerCall<T>(command: string, args?: InvokeArgs): Promise<T> {
  return call<T>(`plugin:${PLAYER_PLUGIN}|${command}`, args);
}

export function playerSetQueue(
  items: PlayerQueueItem[],
  startIndex: number,
  startPositionMs: number,
): Promise<{ accepted: number }> {
  return playerCall("player_set_queue", { items, startIndex, startPositionMs });
}

export function playerPlay(): Promise<void> {
  return playerCall<void>("player_play");
}

export function playerGetState(): Promise<PlayerSnapshot> {
  return playerCall<PlayerSnapshot>("player_get_state");
}

export function playerPause(): Promise<void> {
  return playerCall<void>("player_pause");
}

export function playerSeek(positionMs: number): Promise<void> {
  return playerCall<void>("player_seek", { positionMs });
}

export function playerSetVolume(volume: number): Promise<void> {
  return playerCall<void>("player_set_volume", { volume });
}

export function playerSetSpeed(speed: number): Promise<void> {
  return playerCall<void>("player_set_speed", { speed });
}

export function playerSetEq(enabled: boolean, gainsDb: readonly number[]): Promise<{ appliedBands: number }> {
  return playerCall("player_set_eq", { enabled, gainsDb: [...gainsDb] });
}

export function playerSetUrl(
  id: string,
  url: string,
  headers: Record<string, string>,
  expiresAtEpochMs: number,
): Promise<void> {
  return playerCall<void>("player_set_url", { id, url, headers, expiresAtEpochMs });
}

export async function listenBackButton(onPress: () => void): Promise<() => void> {
  const listener = await onBackButtonPress(() => onPress());
  return () => {
    void listener.unregister();
  };
}

export function exitApp(): Promise<void> {
  return playerCall("player_exit");
}

export function hapticTick(): Promise<void> {
  return playerCall("player_haptic_tick");
}

export function playerKeepAwake(on: boolean): Promise<void> {
  return playerCall("player_keep_awake", { on });
}

export function playerSetSystemBars(dark: boolean): Promise<void> {
  return playerCall("player_set_system_bars", { dark });
}

export type CastStatus = { connected: boolean; playing: boolean; positionMs: number };

export type CastLoad = {
  url: string;
  contentType: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  positionMs: number;
  playing: boolean;
};

export function castOpen(): Promise<void> {
  return playerCall<void>("cast_open");
}

export function castLoad(load: CastLoad): Promise<void> {
  return playerCall<void>("cast_load", { ...load });
}

export function castPlayPause(play: boolean): Promise<void> {
  return playerCall<void>("cast_play_pause", { play });
}

export function castSeek(positionMs: number): Promise<void> {
  return playerCall<void>("cast_seek", { positionMs });
}

export function castStatus(): Promise<CastStatus> {
  return playerCall<CastStatus>("cast_status");
}

export function castStop(): Promise<void> {
  return playerCall<void>("cast_stop");
}

export type Insets = { top: number; bottom: number; left: number; right: number };

export function playerGetInsets(): Promise<Insets> {
  return playerCall<Insets>("player_get_insets");
}

export function playerTakeLaunch(): Promise<Partial<LaunchPayload>> {
  return playerCall<Partial<LaunchPayload>>("player_take_launch");
}

export type UpdateCheck =
  | { state: "current"; version: string }
  | { state: "available"; version: string; apkName: string; apkUrl: string; sumsUrl: string }
  | { state: "error"; message: string };

export function updateCheck(current: string): Promise<UpdateCheck> {
  return call<UpdateCheck>("update_check", { current });
}

export function updateDownload(
  offer: Extract<UpdateCheck, { state: "available" }>,
): Promise<{ path: string }> {
  return call<{ path: string }>("update_download", {
    apkName: offer.apkName,
    apkUrl: offer.apkUrl,
    sumsUrl: offer.sumsUrl,
  });
}

export function updateInstall(path: string): Promise<{ state: "started" | "unknown_sources" }> {
  return call<{ state: "started" | "unknown_sources" }>("update_install", { path });
}

export function updateOpenInstallSettings(): Promise<void> {
  return call<void>("update_open_install_settings");
}

export async function listenPlayerEvent<T>(event: string, onEvent: (payload: T) => void): Promise<() => void> {
  const listener = await addPluginListener<T>(PLAYER_PLUGIN, event, onEvent);
  return () => void listener.unregister();
}

export type TrackAnalysis = { head: number; tail: number; lufs: number | null };

export function trackAnalysis(source: string): Promise<TrackAnalysis> {
  return call<TrackAnalysis>("track_analysis", { source });
}

export async function naturalScrollDirection(): Promise<boolean | null> {
  try {
    return await call<boolean | null>("os_scroll_direction");
  } catch {
    return null;
  }
}

export interface LyricsMeta {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  providers?: string[];
}

export interface SyncedLyricWord {
  start: number;
  end: number;
  text: string;
}

export interface SyncedLyricBg {
  text: string;
  words?: SyncedLyricWord[];
}

export interface SyncedLyricLine {
  time: number;
  text: string;
  end?: number;
  words?: SyncedLyricWord[];
  bg?: SyncedLyricBg;
  roman?: string;
  translation?: string;
  gap?: boolean;
}

export interface LyricsResult {
  synced: SyncedLyricLine[] | null;
  plain: string | null;
  source: string;
  wordSynced: boolean;
  custom?: boolean;
}

export interface LyricsCandidate {
  provider: string;
  candidateId: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  synced: boolean;
  preview: string[];
}

export function lyricsGet(meta: LyricsMeta): Promise<LyricsResult | null> {
  return call<LyricsResult | null>("lyrics_get", { meta });
}

export function lyricsReset(songId: string): Promise<void> {
  return call<void>("lyrics_reset", { songId });
}

export interface DownloadTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  thumb?: string;
}

export type DownloadEventKind = "queued" | "start" | "progress" | "done" | "failed" | "expired" | "cancelled";

export interface DownloadEvent {
  type: DownloadEventKind;
  id: string;
  downloaded?: number;
  total?: number;
  path?: string;
  reason?: string;
}

export interface DownloadQueueRow {
  id: string;
  running: boolean;
  downloaded: number;
  total: number;
}

export function downloadStart(
  track: DownloadTrack,
  url: string,
  dir?: string,
  exportCompat = false,
  resume = false,
): Promise<void> {
  return call<void>("download_start", { track: { ...track, resume }, url, dir, exportCompat });
}

export function pickFolder(title?: string): Promise<string | null> {
  return call<string | null>("folder_pick", { title });
}

export function playlistCoverPick(playlistId: string): Promise<string | null> {
  return call<string | null>("playlist_cover_pick", { playlistId });
}

export function playlistCoverRemove(playlistId: string): Promise<void> {
  return call<void>("playlist_cover_remove", { playlistId });
}

export function pathExists(path: string): Promise<boolean> {
  return call<boolean>("path_exists", { path });
}

export function revealPath(path: string): Promise<void> {
  return call<void>("reveal_path", { path });
}

export function openFolder(path?: string): Promise<void> {
  return call<void>("open_folder", { path });
}

export function fileSrc(path: string): string {
  return convertFileSrc(path);
}

export function downloadCancel(id: string): Promise<boolean> {
  return call<boolean>("download_cancel", { id });
}

export function downloadQueue(): Promise<DownloadQueueRow[]> {
  return call<DownloadQueueRow[]>("download_queue");
}

export function listenDownloadEvents(onEvent: (event: DownloadEvent) => void): Promise<UnlistenFn> {
  return listen<DownloadEvent>("download:event", (event) => onEvent(event.payload));
}

export interface LocalFolderEntry {
  path: string;
  name: string;
  displayName?: string;
  addedAt: number;
}

export interface LocalTrack {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  genre?: string;
  duration: number;
  size: number;
  mtime: number;
  art?: string;
  codec?: string;
}

export interface LocalUnplayable {
  format: string;
  count: number;
}

export interface LocalLibrary {
  folders: LocalFolderEntry[];
  scannedAt: number;
  tracks: LocalTrack[];
  unplayable: LocalUnplayable[];
}

export interface LocalAddResult {
  lib: LocalLibrary;
  added: LocalFolderEntry[];
  skipped: string[];
}

export interface LocalFolderStatus {
  path: string;
  exists: boolean;
}

export interface LocalOpenResult {
  tracks: LocalTrack[];
  folders: string[];
  unplayable: string[];
}

export type FileDropEvent =
  | { type: "enter" | "drop"; paths: string[] }
  | { type: "over" | "leave" };

export function localLibraryGet(): Promise<LocalLibrary> {
  return call<LocalLibrary>("local_library_get");
}

export function localLibraryAddFolders(paths: string[]): Promise<LocalAddResult> {
  return call<LocalAddResult>("local_library_add_folders", { paths });
}

export function localLibraryScan(filterNonMusic: boolean): Promise<LocalLibrary> {
  return call<LocalLibrary>("local_library_scan", { filterNonMusic });
}

export function localLibraryRemoveFolder(path: string): Promise<LocalLibrary> {
  return call<LocalLibrary>("local_library_remove_folder", { path });
}

export function localLibraryRenameFolder(path: string, displayName: string): Promise<LocalLibrary> {
  return call<LocalLibrary>("local_library_rename_folder", { path, displayName });
}

export function localLibraryFolderStatuses(): Promise<LocalFolderStatus[]> {
  return call<LocalFolderStatus[]>("local_library_folder_statuses");
}

export function localLibraryOpened(): Promise<LocalTrack[]> {
  return call<LocalTrack[]>("local_library_opened");
}

export function localLibraryForgetOpened(id: string): Promise<LocalTrack[]> {
  return call<LocalTrack[]>("local_library_forget_opened", { id });
}

export function localLibraryOpenFiles(paths: string[]): Promise<LocalOpenResult> {
  return call<LocalOpenResult>("local_library_open_files", { paths });
}

export function localLibraryTrackPath(id: string): Promise<string | null> {
  return call<string | null>("local_library_track_path", { id });
}

export interface LocalPlaybackSource {
  url: string;
  mime: string;
}

/** Resolves a registered local track to its loopback playback URL. */
export function localPlaybackSource(id: string): Promise<LocalPlaybackSource> {
  return call<LocalPlaybackSource>("local_playback_source", { id });
}

export function onLocalLibraryChanged(onChange: () => void): Promise<UnlistenFn> {
  return listen("local-library-changed", () => onChange());
}

export type GoogleAccount = {
  mode: "guest" | "google";
  googleSub: string | null;
  name: string | null;
  email: string | null;
  pictureUrl: string | null;
  configured: boolean;
  keyringAvailable: boolean;
};

export function googleAccountGet(): Promise<GoogleAccount> {
  return call<GoogleAccount>("google_account_get");
}

export function googleSignIn(): Promise<GoogleAccount> {
  return call<GoogleAccount>("google_sign_in");
}

export function googleSignInCancel(): Promise<boolean> {
  return call<boolean>("google_sign_in_cancel");
}

export function googleSignOut(): Promise<GoogleAccount> {
  return call<GoogleAccount>("google_sign_out");
}

export function listenGoogleAuthChanged(onChange: (account: GoogleAccount) => void): Promise<UnlistenFn> {
  return listen<GoogleAccount>("google-auth-changed", (event) => onChange(event.payload));
}

export type SpotifyAccount = {
  configured: boolean;
  signedIn: boolean;
  name: string | null;
};

export function spotifyStatus(): Promise<SpotifyAccount> {
  return call<SpotifyAccount>("spotify_status");
}

export function spotifySignIn(): Promise<SpotifyAccount> {
  return call<SpotifyAccount>("spotify_sign_in");
}

export function spotifySignOut(): Promise<SpotifyAccount> {
  return call<SpotifyAccount>("spotify_sign_out");
}

export function spotifyAccessToken(): Promise<string> {
  return call<string>("spotify_access_token");
}

export function audioOutputState(): Promise<AudioOutputState> {
  return call<AudioOutputState>("audio_output_state");
}

export function listenAudioOutputChanged(onChange: (state: AudioOutputState) => void): Promise<UnlistenFn> {
  return listen<AudioOutputState>("audio-output-changed", (event) => onChange(event.payload));
}

export type YtSyncState = "idle" | "running" | "paused_sign_in" | "error";

export type YtSyncStatus = {
  state: YtSyncState;
  done: number;
  total: number;
  playlistName: string | null;
  backend: "official" | "unofficial";
  quotaUsedToday: number;
  quotaLimit: number;
  failedJobs: number;
  lastError: string | null;
  lastSyncedAt: number | null;
  pulledPlaylists: number;
};

export type YtSyncJob = {
  kind: "create" | "rename" | "add" | "remove" | "delete" | "like" | "unlike";
  localPlaylistId?: string | null;
  ytPlaylistId?: string | null;
  videoId?: string | null;
  payload?: string | null;
};

export function ytSyncStatus(): Promise<YtSyncStatus> {
  return call<YtSyncStatus>("yt_sync_status");
}

export function ytSyncNow(): Promise<YtSyncStatus> {
  return call<YtSyncStatus>("yt_sync_now");
}

export function ytEnqueue(jobs: YtSyncJob[]): Promise<void> {
  return call<void>("yt_enqueue", { jobs });
}

export function ytRate(videoId: string, like: boolean): Promise<void> {
  return call<void>("yt_rate", { videoId, like });
}

export function listenYtSyncProgress(onChange: (status: YtSyncStatus) => void): Promise<UnlistenFn> {
  return listen<YtSyncStatus>("yt-sync-progress", (event) => onChange(event.payload));
}

export type YtPlaylistLink = { localPlaylistId: string; ytPlaylistId: string };

export function listenYtPlaylistLinked(onLink: (link: YtPlaylistLink) => void): Promise<UnlistenFn> {
  return listen<YtPlaylistLink>("yt-playlist-linked", (event) => onLink(event.payload));
}

export type YtRemotePlaylist = {
  id: string;
  title: string;
  count: number;
  thumbnail: string | null;
};

export type YtRemoteVideo = {
  videoId: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
  thumbnail: string | null;
};

export function ytMyPlaylists(): Promise<YtRemotePlaylist[]> {
  return call<YtRemotePlaylist[]>("yt_my_playlists");
}

export function ytPlaylistVideos(playlistId: string): Promise<YtRemoteVideo[]> {
  return call<YtRemoteVideo[]>("yt_playlist_videos", { playlistId });
}

export function ytLinkPlaylist(localPlaylistId: string, ytPlaylistId: string): Promise<void> {
  return call<void>("yt_link_playlist", { localPlaylistId, ytPlaylistId });
}

export function ytUnlinkPlaylist(localPlaylistId: string): Promise<void> {
  return call<void>("yt_unlink_playlist", { localPlaylistId });
}

export type YtTvCode = { userCode: string; verificationUrl: string; expiresAt: number };

export type YtTvStatus = { connected: boolean };

export function ytTvStatus(): Promise<YtTvStatus> {
  return call<YtTvStatus>("yt_tv_status");
}

export function ytTvConnect(): Promise<YtTvStatus> {
  return call<YtTvStatus>("yt_tv_connect");
}

export function ytTvCancel(): Promise<boolean> {
  return call<boolean>("yt_tv_cancel");
}

export function ytTvDisconnect(): Promise<YtTvStatus> {
  return call<YtTvStatus>("yt_tv_disconnect");
}

export function ytTvOpen(): Promise<void> {
  return call<void>("yt_tv_open");
}

export function listenYtTvCode(onCode: (code: YtTvCode) => void): Promise<UnlistenFn> {
  return listen<YtTvCode>("yt-tv-code", (event) => onCode(event.payload));
}

export function eraseStopSync(): Promise<void> {
  return call<void>("erase_stop_sync");
}

export function eraseResumeSync(): Promise<void> {
  return call<void>("erase_resume_sync");
}

export function eraseYoutubePlaylists(): Promise<number> {
  return call<number>("erase_youtube_playlists");
}

export function eraseRevoke(): Promise<void> {
  return call<void>("erase_revoke");
}

export function eraseKeyring(): Promise<void> {
  return call<void>("erase_keyring");
}

export function eraseLocalData(deleteDownloads: boolean, downloadPaths: string[]): Promise<void> {
  return call<void>("erase_local_data", { deleteDownloads, downloadPaths });
}

export function listenMenuCommands(onCommand: (command: string) => void): Promise<UnlistenFn> {
  return listen<string>("menu:command", (event) => onCommand(event.payload));
}

export type MenuPlaybackState = { playing: boolean; shuffle: boolean; repeat: "off" | "all" | "one" };

export function menuSetPlaybackState(state: MenuPlaybackState): Promise<void> {
  return call<void>("menu_set_playback_state", { state });
}

export async function listenFileDrop(onEvent: (event: FileDropEvent) => void): Promise<UnlistenFn> {
  return getCurrentWindow().onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === "enter" || payload.type === "drop") {
      onEvent({ type: payload.type, paths: payload.paths });
    } else {
      onEvent({ type: payload.type });
    }
  });
}

export function setTrayPlaying(playing: boolean): Promise<void> {
  return call<void>("tray_set_playing", { playing });
}

export function introDone(): Promise<void> {
  return call<void>("window_intro_done");
}

export function guestDetectMarker(): Promise<boolean> {
  return call<boolean>("guest_detect_marker");
}

export function setReduceTransparency(reduce: boolean): Promise<void> {
  return call<void>("window_set_reduce_transparency", { reduce });
}

export type MediaTrackPayload = {
  id: string;
  title: string;
  artist: string;
  album: string;
  thumb: string | null;
  duration: number;
};

export type MediaButton = "play" | "pause" | "next" | "previous";

export function setMediaTrack(track: MediaTrackPayload): Promise<void> {
  return call<void>("media_set_track", { track });
}

export function setMediaPlaying(playing: boolean): Promise<void> {
  return call<void>("media_set_playing", { playing });
}

export function setMediaPosition(position: number, duration: number): Promise<void> {
  return call<void>("media_set_position", { position, duration });
}

export function clearMedia(): Promise<void> {
  return call<void>("media_clear");
}

export function listenMediaButton(onAction: (action: MediaButton) => void): Promise<UnlistenFn> {
  return listen<MediaButton>("media:button", (event) => onAction(event.payload));
}

export function listenMediaSeek(onSeek: (seconds: number) => void): Promise<UnlistenFn> {
  return listen<number>("media:seek", (event) => onSeek(event.payload));
}

export type DesktopAppearance = { colorScheme: DesktopScheme; reduceMotion: boolean };

export function readDesktopAppearance(): Promise<DesktopAppearance> {
  return call<DesktopAppearance>("linux_appearance_read");
}

export function listenDesktopAppearance(onChange: (appearance: DesktopAppearance) => void): Promise<UnlistenFn> {
  return listen<DesktopAppearance>("linux:appearance", (event) => onChange(event.payload));
}

export type LaunchAction = { type: "file"; path: string } | { type: "playlist"; id: string };

export function launchTake(): Promise<LaunchAction[]> {
  return call<LaunchAction[]>("launch_take");
}

export function listenLaunchPending(onPending: () => void): Promise<UnlistenFn> {
  return listen("launch:pending", () => onPending());
}

export function pipToggle(): Promise<boolean> {
  return call<boolean>("pip_toggle");
}

export function pipIsOpen(): Promise<boolean> {
  return call<boolean>("pip_is_open");
}

export function pipClose(): Promise<void> {
  return call<void>("pip_close");
}

export function pipMinimize(): Promise<void> {
  return call<void>("pip_minimize");
}

export function pipSetCompact(on: boolean): Promise<void> {
  return call<void>("pip_set_compact", { on });
}

export function pipShowMain(): Promise<void> {
  return call<void>("pip_show_main");
}

export function pipReady(): Promise<void> {
  return call<void>("pip_ready");
}

export function pipSendState(payload: PipSnapshot): Promise<void> {
  return call<void>("pip_send_state", { payload });
}

export function pipSendCommand(payload: PipCommand): Promise<void> {
  return call<void>("pip_send_command", { payload });
}

export function pipSessionErased(): Promise<void> {
  return call<void>("pip_session_erased");
}

export function listenPipState(onState: (snapshot: PipSnapshot) => void): Promise<UnlistenFn> {
  return listen<PipSnapshot>("pip:state", (event) => onState(event.payload));
}

export function listenPipCommand(onCommand: (command: unknown) => void): Promise<UnlistenFn> {
  return listen<unknown>("pip:command", (event) => onCommand(event.payload));
}

export function listenPipOpenChanged(onChange: (open: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>("pip:open-changed", (event) => onChange(event.payload));
}

export function listenPipNeedState(onNeed: () => void): Promise<UnlistenFn> {
  return listen("pip:need-state", () => onNeed());
}

export function listenSessionErased(onErased: () => void): Promise<UnlistenFn> {
  return listen("session:erased", () => onErased());
}

export function notificationState(): Promise<string> {
  return call<string>("notification_state");
}

export function notificationRequest(): Promise<string> {
  return call<string>("notification_request");
}

export function notificationSettings(): Promise<void> {
  return call<void>("notification_settings");
}

export function downloadDeleteFile(path: string): Promise<void> {
  return call<void>("download_delete_file", { path });
}

export type ScrobbleServiceStatus = {
  available: boolean;
  connected: boolean;
  username: string | null;
  enabled: boolean;
  awaitingApproval: boolean;
};

export type ScrobbleStatus = {
  lastfm: ScrobbleServiceStatus;
  listenbrainz: ScrobbleServiceStatus;
};

export function scrobbleStatus(): Promise<ScrobbleStatus> {
  return call<ScrobbleStatus>("scrobble_status");
}

export function listenbrainzConnect(token: string): Promise<ScrobbleStatus> {
  return call<ScrobbleStatus>("listenbrainz_connect", { token });
}

export function listenbrainzDisconnect(): Promise<ScrobbleStatus> {
  return call<ScrobbleStatus>("listenbrainz_disconnect");
}

export function lastfmBeginAuth(): Promise<ScrobbleStatus> {
  return call<ScrobbleStatus>("lastfm_begin_auth");
}

export function lastfmFinishAuth(): Promise<ScrobbleStatus> {
  return call<ScrobbleStatus>("lastfm_finish_auth");
}

export function lastfmDisconnect(): Promise<ScrobbleStatus> {
  return call<ScrobbleStatus>("lastfm_disconnect");
}

export function scrobbleSetEnabled(service: string, enabled: boolean): Promise<ScrobbleStatus> {
  return call<ScrobbleStatus>("scrobble_set_enabled", { service, enabled });
}

export function scrobbleLove(artist: string, title: string, loved: boolean): Promise<void> {
  return call<void>("scrobble_love", { artist, title, loved });
}

export type DiscordStatus = { available: boolean; enabled: boolean; connected: boolean };

export function discordStatus(): Promise<DiscordStatus> {
  return call<DiscordStatus>("discord_status");
}

export function discordSetEnabled(enabled: boolean): Promise<DiscordStatus> {
  return call<DiscordStatus>("discord_set_enabled", { enabled });
}

export type NetworkServerKind = "webDav" | "smb";

export type NetworkServer = {
  id: string;
  kind: NetworkServerKind;
  kindLabel: string;
  name: string;
  url: string;
  host: string;
  share: string;
  path: string;
  username: string;
};

export type NetworkServerInput = {
  id: string;
  kind: NetworkServerKind;
  name: string;
  url: string;
  host: string;
  share: string;
  path: string;
  username: string;
  password: string;
};

export type NetworkTrack = {
  id: string;
  serverId: string;
  serverName: string;
  path: string;
  name: string;
  title: string;
  artist: string;
  album: string;
  size: number;
};

export function networkServers(): Promise<NetworkServer[]> {
  return call<NetworkServer[]>("network_servers");
}

export function networkServerSave(server: NetworkServerInput): Promise<NetworkServer[]> {
  return call<NetworkServer[]>("network_server_save", { server });
}

export function networkServerRemove(id: string): Promise<NetworkServer[]> {
  return call<NetworkServer[]>("network_server_remove", { id });
}

export function networkTracks(id: string, path: string): Promise<NetworkTrack[]> {
  return call<NetworkTrack[]>("network_tracks", { id, path });
}
