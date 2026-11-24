type PlayerRepeat = "off" | "all" | "one";

export type PlayerSnapshot = {
  playing: boolean;
  buffering: boolean;
  positionMs: number;
  durationMs: number;
  index: number;
  id: string | null;
  speed: number;
  repeat: PlayerRepeat;
  shuffle: boolean;
};

export type PlayerQueueItem = {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  url: string;
  headers: Record<string, string>;
  liked: boolean;
  expiresAtEpochMs: number | null;
  contentUri?: string;
  artworkUrl?: string;
};

export type PlayMeta = {
  artist?: string;
  artworkUrl?: string;
  durationMs?: number;
};

export type MediaEvent = "play" | "pause" | "playing" | "waiting" | "timeupdate" | "durationchange";

export const IDLE_SNAPSHOT: PlayerSnapshot = {
  playing: false,
  buffering: false,
  positionMs: 0,
  durationMs: 0,
  index: 0,
  id: null,
  speed: 1,
  repeat: "off",
  shuffle: false,
};

const LINK_TTL_MS = 10 * 60 * 1000;
const EXPIRE_PARAM = /[?&/]expire[=/](\d{9,11})/;

export function isAndroidAgent(userAgent: string): boolean {
  return /Android/.test(userAgent);
}

/** iOS runs the same `hushio-player` native boundary (AVFoundation instead of Media3). */
export function isIOSAgent(userAgent: string): boolean {
  return /iPhone|iPad|iPod/.test(userAgent);
}

export const ANDROID = isAndroidAgent(navigator.userAgent);
export const IOS = isIOSAgent(navigator.userAgent);

/**
 * True when playback is owned by the native `hushio-player` plugin rather than the
 * HTML/`NativeAudioDeck` path. Android and iOS share the same command/event contract
 * (`src/lib/bridge.ts`), so `androidEngine.ts` drives both.
 */
export const NATIVE_PLAYER = ANDROID || IOS;

export function expiryOf(url: string, nowMs: number): number {
  const match = EXPIRE_PARAM.exec(url);
  return match ? Number(match[1]) * 1000 : nowMs + LINK_TTL_MS;
}

export function queueItemFor(
  id: string,
  title: string,
  url: string,
  headers: Record<string, string>,
  expiresAtEpochMs: number,
  meta: PlayMeta = {},
): PlayerQueueItem {
  const item: PlayerQueueItem = {
    id,
    title,
    artist: meta.artist ?? "",
    durationMs: meta.durationMs ?? 0,
    url,
    headers: { ...headers },
    liked: false,
    expiresAtEpochMs,
  };
  if (meta.artworkUrl) item.artworkUrl = meta.artworkUrl;
  return item;
}

export function mediaEventsFor(before: PlayerSnapshot, after: PlayerSnapshot): MediaEvent[] {
  const events: MediaEvent[] = [];
  if (!before.playing && after.playing) events.push("play");
  if (before.playing && !after.playing) events.push("pause");
  if (!before.buffering && after.buffering) events.push("waiting");
  if (after.playing && !after.buffering && (!before.playing || before.buffering)) events.push("playing");
  if (before.durationMs !== after.durationMs) events.push("durationchange");
  if (before.positionMs !== after.positionMs || before.index !== after.index) events.push("timeupdate");
  return events;
}
