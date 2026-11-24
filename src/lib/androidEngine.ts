import {
  listenPlayerEvent,
  playerGetState,
  playerPause,
  playerPlay,
  playerSeek,
  playerSetEq,
  playerSetQueue,
  playerSetSpeed,
  playerSetUrl,
  localLibraryTrackPath,
  playerSetVolume,
  jsLog,
} from "./bridge";
import {
  expiryOf,
  IOS,
  IDLE_SNAPSHOT,
  mediaEventsFor,
  queueItemFor,
  type MediaEvent,
  type PlayerSnapshot,
  type PlayMeta,
} from "./androidPlayback";
import { MEDIA_USER_AGENT, resolveStream } from "./resolveStream";
import { addonStreamFor, addonsEnabled } from "./addons/resolve";
import { isJioSaavnId } from "./jiosaavn";
import { useUI } from "../stores/ui";
import { currentStreamBitrate } from "./streamingQuality";
import { fileDetails, streamDetails } from "./streamStats";
import { useNowStream } from "../stores/nowStream";
import { playFailedMessage } from "./playFailed";
import { traceMark } from "./streamTrace";

type StreamNeeded = { id: string; reason: string };
type PlayerFailure = { id: string; code: string; message: string; recoverable: boolean };
type PlayerAction = { action: string };
type PlayerFocus = { state: "lost" | "gained" };

let last: PlayerSnapshot = IDLE_SNAPSHOT;
let currentTitle = "";
let currentMeta: PlayMeta = {};
let playGeneration = 0;
let currentId: string | null = null;
let wantsPlayback = false;
let emit: ((type: MediaEvent | "ended") => void) | null = null;
const REFRESH_LIMIT = 3;
const REFRESH_WINDOW_MS = 60_000;
let refreshTimes: number[] = [];

function headers(): Record<string, string> {
  return { "User-Agent": MEDIA_USER_AGENT };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/**
 * Containers AVFoundation can actually decode. iOS resolves through the same ladder as
 * Android (141 > 251 > 140 > …), and 251 is Opus-in-WebM — which `AVPlayer` cannot play
 * at all. Android's Media3 handles Opus/WebM, so the ladder is right for it; on iOS the
 * resolver must be asked for MP4/AAC (`mp4Only`) and a non-decodable result must be a
 * real error instead of a silent stall.
 */
const IOS_PLAYABLE_MIME = /^audio\/(mp4|m4a|aac|mpeg|mp3|wav|x-wav|x-flac|flac)\b/i;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function iosCanPlay(mime: string | undefined): boolean {
  return typeof mime === "string" && IOS_PLAYABLE_MIME.test(mime);
}

function report(action: string): (error: unknown) => void {
  return (error) => {
    const detail = describeError(error);
    console.warn(`[hushio] android ${action} failed: ${detail}`);
    jsLog("warn", `${action} failed: ${detail}`);
  };
}

export async function androidPlayStream(id: string, title: string, fromSeconds = 0, meta: PlayMeta = {}): Promise<void> {
  const generation = ++playGeneration;
  currentId = id;
  wantsPlayback = true;
  currentTitle = title;
  currentMeta = meta;
  refreshTimes = [];
  const positionMs = Number.isFinite(fromSeconds) ? Math.max(0, Math.round(fromSeconds * 1000)) : 0;
  if (id.startsWith("local:")) {
    const contentUri = await localLibraryTrackPath(id);
    if (generation !== playGeneration) return;
    if (!contentUri) throw new Error("Local track is not in the library");
    useNowStream.getState().publish(id, fileDetails(contentUri, "Local file"));
    const item = { ...queueItemFor(id, title, "", {}, 0, meta), expiresAtEpochMs: null, contentUri };
    await playerSetQueue([item], 0, positionMs);
    if (generation === playGeneration && wantsPlayback) await playerPlay();
    return;
  }
  const maxKbps = currentStreamBitrate();
  const addon = addonsEnabled(maxKbps === undefined) ? await addonStreamFor(id) : null;
  // iOS: ask for MP4/AAC only, because AVPlayer has no Opus/WebM decoder (see above).
  const stream =
    addon?.stream ??
    (maxKbps === undefined
      ? await resolveStream(id, false, undefined, IOS)
      : await resolveStream(id, false, maxKbps, IOS));
  if (generation !== playGeneration) return;
  if (IOS && !iosCanPlay(stream.mime)) {
    // Honest failure: the resolved container cannot be decoded here. Throwing lets the
    // shared failure path surface one message instead of an AVPlayer that never starts.
    throw new Error(`iOS cannot decode ${stream.mime || "this stream"}`);
  }
  useNowStream.getState().publish(id, streamDetails(stream, addon?.label ?? (isJioSaavnId(id) ? "JioSaavn" : "Stream")));
  jsLog("info", `resolved ${id}: mime=${stream.mime || "?"} itag=${stream.itag ?? "?"} host=${hostOf(stream.url)}`);
  const item = queueItemFor(id, title, stream.url, headers(), expiryOf(stream.url, Date.now()), meta);
  await playerSetQueue([item], 0, positionMs);
  traceMark("player queued");
  if (generation === playGeneration && wantsPlayback) await playerPlay();
}

export function adoptNativeItem(id: string, title: string): void {
  ++playGeneration;
  currentId = id;
  currentTitle = title;
  currentMeta = {};
  refreshTimes = [];
}

export async function androidPlay(): Promise<void> {
  wantsPlayback = true;
  try {
    const state = await playerGetState();
    if (state.id !== null && (currentId === null || state.id === currentId)) {
      await playerPlay();
      return;
    }
    const { currentTrack, usePlayer } = await import("../stores/player");
    const store = usePlayer.getState();
    const track = currentTrack(store);
    const id = currentId ?? track?.id;
    if (id === undefined) return;
    const fresh = id === currentId;
    const from = fresh && last.positionMs > 0 ? last.positionMs / 1000 : store.position;
    await androidPlayStream(id, fresh ? currentTitle : (track?.title ?? ""), from, fresh ? currentMeta : {});
  } catch (error) {
    report("play")(error);
    emit?.("pause");
    useUI.getState().toast(playFailedMessage(currentTitle), "error");
  }
}

export function androidPause(): void {
  wantsPlayback = false;
  playerPause().catch(report("pause"));
}

export function androidSeek(seconds: number): void {
  playerSeek(Math.round(seconds * 1000)).catch(report("seek"));
}

export function androidSetVolume(value: number): void {
  playerSetVolume(value).catch(report("volume"));
}

export function androidSetSpeed(rate: number): void {
  playerSetSpeed(rate).catch(report("speed"));
}

export function androidSetEq(enabled: boolean, gains: readonly number[]): void {
  playerSetEq(enabled, gains).catch(report("eq"));
}

export function androidPosition(): number {
  return last.positionMs / 1000;
}

export function androidDuration(): number {
  return last.durationMs / 1000;
}

export function androidRate(): number {
  return last.speed;
}

async function refreshUrl(id: string): Promise<void> {
  if (id !== currentId) return;
  const now = Date.now();
  refreshTimes = refreshTimes.filter((time) => now - time < REFRESH_WINDOW_MS);
  if (refreshTimes.length >= REFRESH_LIMIT) {
    androidPause();
    emit?.("pause");
    useUI.getState().toast(playFailedMessage(currentTitle), "error");
    return;
  }
  refreshTimes.push(now);
  const generation = playGeneration;
  try {
    const maxKbps = currentStreamBitrate();
    const stream = maxKbps === undefined ? await resolveStream(id, true) : await resolveStream(id, true, maxKbps);
    if (generation !== playGeneration) return;
    await playerSetUrl(id, stream.url, headers(), expiryOf(stream.url, Date.now()));
  } catch (error) {
    if (generation !== playGeneration) return;
    console.warn(`[hushio] stream refresh failed: ${String(error)}`);
    jsLog("warn", `stream refresh failed for ${id}: ${describeError(error)}`);
    useUI.getState().toast(playFailedMessage(currentTitle), "error");
  }
}

function subscribe<T>(event: string, onEvent: (payload: T) => void): void {
  listenPlayerEvent<T>(event, onEvent).catch(report(`listen to ${event}`));
}

function applySnapshot(next: PlayerSnapshot): void {
  if (currentId !== null && next.id !== null && next.id !== currentId) return;
  const unrequested = next.playing && !wantsPlayback;
  if (unrequested) playerPause().catch(report("pause"));
  const reported = unrequested ? { ...next, playing: false } : next;
  const before = last;
  last = reported;
  if (reported.playing) refreshTimes = [];
  for (const type of mediaEventsFor(before, reported)) emit?.(type);
}

async function syncNativeState(): Promise<void> {
  let next: PlayerSnapshot;
  try {
    next = await playerGetState();
  } catch (error) {
    report("sync")(error);
    next = IDLE_SNAPSHOT;
  }
  applySnapshot(next);
}

async function setCurrentLiked(liked: boolean): Promise<void> {
  const [{ currentTrack, usePlayer }, { useLibrary }] = await Promise.all([
    import("../stores/player"),
    import("../stores/library"),
  ]);
  const track = currentTrack(usePlayer.getState());
  if (!track) return;
  const library = useLibrary.getState();
  if (library.liked.some((item) => item.id === track.id) === liked) return;
  library.toggleLike(track);
}

async function handlePlayerAction(action: string): Promise<void> {
  if (action === "play") {
    wantsPlayback = true;
    return;
  }
  if (action === "like" || action === "unlike") return setCurrentLiked(action === "like");
  if (action !== "next" && action !== "previous") return;
  const { usePlayer } = await import("../stores/player");
  if (action === "next") usePlayer.getState().next(true);
  else usePlayer.getState().prevTrack();
}

export function startAndroidEngine(dispatch: (type: MediaEvent | "ended") => void): void {
  emit = dispatch;
  playerGetState().then((state) => {
    if (state.playing) wantsPlayback = true;
    applySnapshot(state);
  }, report("sync"));
  subscribe<PlayerSnapshot>("player-state", applySnapshot);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNativeState();
  });
  subscribe<unknown>("player-ended", (payload) => {
    const id = payload !== null && typeof payload === "object" ? (payload as { id?: unknown }).id : undefined;
    if (id === undefined || id === currentId) dispatch("ended");
  });
  subscribe<PlayerAction>("player-action", (event) => void handlePlayerAction(event.action));
  subscribe<PlayerFocus>("player-focus", (event) => {
    wantsPlayback = event.state === "gained";
  });
  subscribe<StreamNeeded>("player-stream-needed", (event) => {
    void refreshUrl(event.id);
  });
  subscribe<PlayerFailure>("player-error", (event) => {
    console.warn(`[hushio] player error ${event.code}: ${event.message}`);
    jsLog("warn", `player-error ${event.code}: ${event.message} (id=${event.id ?? "none"})`);
    if (currentId !== null && event.id !== currentId) return;
    useUI.getState().toast(playFailedMessage(currentTitle), "error");
  });
}
