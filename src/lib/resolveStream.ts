import { onMemoryTrim } from "./memoryTrim";
import { ytFetch as fetch } from "./ytFetch";
import { jsLog } from "./bridge";
import type { Innertube } from "youtubei.js";
import { getSession, MARKET, resetSession } from "./innertube";
import { isJioSaavnId, resolveJioSaavnStream } from "./jiosaavn";
import { firstSuccess } from "./firstSuccess";
import { traceMark } from "./streamTrace";

type InnerTubeClient = NonNullable<NonNullable<Parameters<Innertube["getBasicInfo"]>[1]>["client"]>;
export const MEDIA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CLIENTS: readonly InnerTubeClient[] = ["VISIONOS", "IOS", "ANDROID_VR", "WEB", "YTMUSIC", "ANDROID", "TV"];
const PIPED_BASES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
];
const PROBE_TIMEOUT_MS = 6_000;
const PROBE_BYTES = 4096;
const CLIENT_STAGGER_MS = 600;
const PIPED_TIMEOUT_MS = 12_000;
const CACHE_LIMIT = 50;
const BAD_CLIENT_MS = 10 * 60 * 1000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_TTL_MS = 6 * 60 * 60 * 1000;
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const EXPIRE_PARAM = /[?&/]expire[=/](\d{9,11})/;
const AUDIO_RANK: Record<number, number> = { 141: 6, 251: 5, 140: 4, 250: 3, 249: 2, 139: 1 };

export type ResolvedStream = {
  url: string;
  mime: string;
  lufs: number | null;
  itag?: number;
  clen?: number;
  kbps?: number;
  sampleRate?: number;
  channels?: number;
};

type Pin = { itag: number; clen?: number };

type AudioFormat = {
  itag: number;
  url?: string;
  mime_type?: string;
  bitrate?: number;
  average_bitrate?: number;
  content_length?: number;
  has_audio: boolean;
  has_video: boolean;
  is_drc?: boolean;
  is_original?: boolean;
  loudness_db?: number;
  track_absolute_loudness_lkfs?: number;
  audio_sample_rate?: number | string;
  audio_channels?: number;
  signature_cipher?: string;
  cipher?: string;
  decipher?(player?: unknown): Promise<string>;
};

export type StreamingData = {
  url?: string;
  mime_type?: string;
  hls_manifest_url?: string;
  formats: AudioFormat[];
  adaptive_formats: AudioFormat[];
};

type ResolveOptions = { maxKbps?: number; mp4Only: boolean; pin?: Pin; trustKnown: boolean; exclude?: InnerTubeClient };

type Resolved = { stream: ResolvedStream; verified: boolean; client?: InnerTubeClient };

type CacheEntry = { value: ResolvedStream; client?: InnerTubeClient; expiresAt: number };

type PipedStream = { url?: string; mimeType?: string; bitrate?: number };

const resolveCache = new Map<string, CacheEntry>();
onMemoryTrim(() => resolveCache.clear());
const inFlight = new Map<string, Promise<ResolvedStream>>();
const verifiedClients = new Set<InnerTubeClient>();
const badUntil = new Map<InnerTubeClient, number>();
let preferredClientIdx = 0;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: number | undefined): number | undefined {
  return isFiniteNumber(value) && value > 0 ? value : undefined;
}

function audioScore(format: AudioFormat): number {
  return (AUDIO_RANK[format.itag] ?? 0) * 1e9 + (format.bitrate ?? 0);
}

function optionalPositive(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return isFiniteNumber(parsed) && parsed > 0 ? parsed : undefined;
}

function kbps(format: AudioFormat): number {
  return (format.average_bitrate ?? format.bitrate ?? 0) / 1000;
}

function formatLufs(format: AudioFormat): number | null {
  if (isFiniteNumber(format.track_absolute_loudness_lkfs)) return format.track_absolute_loudness_lkfs;
  if (isFiniteNumber(format.loudness_db)) return format.loudness_db - 14;
  return null;
}

async function formatUrl(format: AudioFormat, player: unknown): Promise<string | null> {
  try {
    if (typeof format.url === "string") return format.url;
    if (typeof format.decipher === "function" && player) {
      const deciphered = await format.decipher(player);
      if (deciphered) return deciphered;
    }
    return null;
  } catch (error) {
    console.warn(`[hushio] stream deciphering failed: ${describeError(error)}`);
    jsLog("warn", `stream deciphering failed: ${describeError(error)}`);
    return null;
  }
}

export function streamTtlMs(url: string, now: number): number {
  const expire = EXPIRE_PARAM.exec(url)?.[1];
  if (expire === undefined) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(0, Number(expire) * 1000 - now - EXPIRY_MARGIN_MS));
}

export async function pickAudio(
  streaming: StreamingData | undefined,
  player: unknown,
  maxKbps: number | undefined,
  mp4Only: boolean,
  pin?: Pin,
): Promise<ResolvedStream | null> {
  if (!streaming) return null;

  const isAudioOnly = (format: AudioFormat) => format.has_audio && !format.has_video;
  let candidates = streaming.adaptive_formats.filter(isAudioOnly);
  if (candidates.length === 0) candidates = streaming.formats.filter(isAudioOnly);
  if (candidates.length === 0) {
    return typeof streaming.url === "string"
      ? { url: streaming.url, mime: streaming.mime_type ?? "audio/mp4", lufs: null }
      : null;
  }

  const plain = candidates.filter((format) => !format.is_drc && format.is_original !== false);
  if (plain.length > 0) candidates = plain;
  candidates = [...candidates].sort((a, b) => audioScore(b) - audioScore(a));

  if (pin) {
    candidates = candidates.filter(
      (format) =>
        format.itag === pin.itag &&
        (pin.clen == null || format.content_length == null || format.content_length === pin.clen),
    );
  } else {
    if (maxKbps) {
      const ceiling = maxKbps * 1.1;
      const within = candidates.filter((format) => kbps(format) <= ceiling);
      if (within.length > 0) candidates = within;
    }
    if (mp4Only) {
      const mp4 = candidates.filter((format) => format.mime_type?.includes("mp4"));
      if (mp4.length > 0) candidates = mp4;
    }
  }

  for (const preferred of candidates) {
    const url = await formatUrl(preferred, player);
    if (!url) continue;
    return {
      url,
      mime: preferred.mime_type ?? "audio/mp4",
      lufs: formatLufs(preferred),
      itag: positive(preferred.itag),
      clen: positive(preferred.content_length),
      kbps: positive(Math.round(kbps(preferred))),
      sampleRate: optionalPositive(preferred.audio_sample_rate),
      channels: optionalPositive(preferred.audio_channels),
    };
  }
  return null;
}

export async function probeUrl(url: string, cancel?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  timeout.addEventListener("abort", stop);
  cancel?.addEventListener("abort", stop);
  if (cancel?.aborted) stop();
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": MEDIA_USER_AGENT, Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: controller.signal,
    });
    if (response.status !== 206 && response.status !== 200) {
      await response.body?.cancel();
      console.warn(`[hushio] stream probe rejected: HTTP ${response.status}`);
      jsLog("warn", `stream probe rejected: HTTP ${response.status}`);
      return false;
    }
    const reader = response.body?.getReader();
    if (!reader) {
      console.warn("[hushio] stream probe rejected: no body");
      return false;
    }
    const { value } = await reader.read();
    await reader.cancel();
    if ((value?.byteLength ?? 0) > 0) return true;
    console.warn("[hushio] stream probe rejected: empty body");
    return false;
  } catch (error) {
    const reason = timeout.aborted
      ? `timed out after ${PROBE_TIMEOUT_MS} ms`
      : cancel?.aborted
        ? "cancelled"
        : describeError(error);
    console.warn(`[hushio] stream probe failed: ${reason}`);
    jsLog("warn", `stream probe failed: ${reason}`);
    return false;
  }
}

function hasUrl(stream: PipedStream): stream is PipedStream & { url: string } {
  return typeof stream.url === "string";
}

export async function resolveViaPiped(videoId: string): Promise<ResolvedStream> {
  if (!/^[\w-]{6,20}$/.test(videoId)) throw new Error("Invalid video id");
  for (const base of PIPED_BASES) {
    try {
      const response = await fetch(`${base}/streams/${videoId}`, {
        headers: { "User-Agent": MEDIA_USER_AGENT },
        signal: AbortSignal.timeout(PIPED_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const data: { audioStreams?: PipedStream[] } = await response.json();
      const streams = (data.audioStreams ?? [])
        .filter(hasUrl)
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
      const pick = streams.find((stream) => /mp4|aac/i.test(stream.mimeType ?? "")) ?? streams[0];
      if (pick && (await probeUrl(pick.url)))
        return {
          url: pick.url,
          mime: pick.mimeType ?? "audio/mp4",
          lufs: null,
          kbps: positive(Math.round((pick.bitrate ?? 0) / 1000)),
        };
    } catch (error) {
      console.warn(`[hushio] Piped mirror ${base} failed: ${describeError(error)}`);
      jsLog("warn", `Piped mirror failed: ${describeError(error)}`);
    }
  }
  throw new Error("No Piped mirror had a playable stream");
}

function describeStreams(status: string | undefined, streaming: StreamingData | undefined): string {
  const audio = (streaming?.adaptive_formats ?? []).filter((format) => format.has_audio && !format.has_video);
  const plainUrl = audio.filter((format) => typeof format.url === "string").length;
  const sig = audio.filter((format) => format.signature_cipher || format.cipher).length;
  const hls = streaming?.hls_manifest_url ? "y" : "n";
  return `playability=${status ?? "?"} audio=${audio.length} plainUrl=${plainUrl} sig=${sig} hls=${hls}`;
}

async function attemptClient(
  innertube: Innertube,
  poToken: string | null,
  client: InnerTubeClient,
  videoId: string,
  options: ResolveOptions,
  cancel: AbortSignal,
): Promise<Resolved & { client: InnerTubeClient }> {
  const info = await innertube.getBasicInfo(videoId, { client, po_token: poToken ?? undefined });
  console.info(`[hushio] stream ${client}: ${describeStreams(info.playability_status?.status, info.streaming_data)}`);
  traceMark(`client ${client} info`);
  const picked = await pickAudio(
    info.streaming_data,
    innertube.session.player,
    options.maxKbps,
    options.mp4Only,
    options.pin,
  );
  if (!picked) throw new Error(`no audio format for client ${client}`);
  if (options.trustKnown && verifiedClients.has(client)) return { stream: picked, verified: false, client };
  if (!(await probeUrl(picked.url, cancel))) {
    traceMark(`client ${client} probe failed`);
    throw new Error(`stream rejected for client ${client}`);
  }
  traceMark(`client ${client} probe ok`);
  verifiedClients.add(client);
  return { stream: picked, verified: true, client };
}

function clientAt(offset: number): InnerTubeClient {
  return CLIENTS[(preferredClientIdx + offset) % CLIENTS.length];
}

function clientOrder(exclude: InnerTubeClient | undefined): InnerTubeClient[] {
  const now = Date.now();
  const rotated = CLIENTS.map((_, offset) => clientAt(offset)).filter((client) => client !== exclude);
  const isBad = (client: InnerTubeClient) => (badUntil.get(client) ?? 0) > now;
  return [...rotated.filter((client) => !isBad(client)), ...rotated.filter(isBad)];
}

function markBad(client: InnerTubeClient): void {
  badUntil.set(client, Date.now() + BAD_CLIENT_MS);
  verifiedClients.delete(client);
  preferredClientIdx = (CLIENTS.indexOf(client) + 1) % CLIENTS.length;
}

async function resolveUncached(videoId: string, options: ResolveOptions): Promise<Resolved> {
  if (isJioSaavnId(videoId)) return { stream: await resolveJioSaavnStream(videoId, options.maxKbps), verified: true };
  let lastError: unknown;
  for (let round = 0; round < 2; round++) {
    if (round === 1) {
      console.warn(
        `[hushio] all clients failed, rebuilding session with a fresh PO token: ${describeError(lastError)}`,
      );
      jsLog("warn", `all clients failed, rebuilding session: ${describeError(lastError)}`);
      await resetSession(MARKET);
    }
    const { innertube, context } = await getSession(MARKET);
    const order = clientOrder(options.exclude);
    try {
      const winner = await firstSuccess(
        order.length,
        (index, cancel) => attemptClient(innertube, context.poToken, order[index], videoId, options, cancel),
        CLIENT_STAGGER_MS,
      );
      preferredClientIdx = CLIENTS.indexOf(winner.client);
      badUntil.delete(winner.client);
      return winner;
    } catch (error) {
      lastError = error;
    }
  }
  try {
    return { stream: await resolveViaPiped(videoId), verified: true };
  } catch (pipedError) {
    console.warn(`[hushio] Piped fallback failed: ${describeError(pipedError)}`);
    jsLog("warn", `Piped fallback failed: ${describeError(pipedError)}`);
    throw lastError instanceof Error ? lastError : new Error("Could not resolve a playable audio stream");
  }
}

function cacheKey(videoId: string, maxKbps: number | undefined, mp4Only: boolean): string {
  return `${videoId}|${maxKbps ?? ""}|${mp4Only ? "mp4" : ""}`;
}

function evictOldest(): void {
  for (const key of resolveCache.keys()) {
    if (resolveCache.size <= CACHE_LIMIT) return;
    resolveCache.delete(key);
  }
}

function evictIfSame(key: string, url: string): void {
  if (resolveCache.get(key)?.value.url === url) resolveCache.delete(key);
}

export function resolveStream(
  videoId: string,
  refresh = false,
  maxKbps?: number,
  mp4Only = false,
): Promise<ResolvedStream> {
  const key = cacheKey(videoId, maxKbps, mp4Only);
  const cached = resolveCache.get(key);
  if (!refresh && cached && Date.now() < cached.expiresAt) {
    traceMark("cache hit", videoId);
    return Promise.resolve(cached.value);
  }
  const shared = inFlight.get(key);
  if (!refresh && shared) return shared;

  traceMark("resolve start", videoId);
  const previous = cached?.value;
  const pin = previous?.itag !== undefined ? { itag: previous.itag, clen: previous.clen } : undefined;
  const stale = refresh ? cached?.client : undefined;
  if (stale) markBad(stale);
  const attempt: Promise<ResolvedStream> = resolveUncached(videoId, {
    maxKbps,
    mp4Only,
    pin,
    trustKnown: !refresh,
    exclude: stale,
  })
    .then(({ stream: value, verified, client }) => {
      const ts = Date.now();
      resolveCache.delete(key);
      resolveCache.set(key, { value, client, expiresAt: ts + streamTtlMs(value.url, ts) });
      evictOldest();
      if (!verified) {
        void probeUrl(value.url).then((ok) => {
          if (!ok) evictIfSame(key, value.url);
        });
      }
      traceMark("resolved", videoId);
      return value;
    })
    .finally(() => {
      if (inFlight.get(key) === attempt) inFlight.delete(key);
    });
  inFlight.set(key, attempt);
  return attempt;
}

export function prefetchStream(videoId: string, maxKbps?: number): Promise<void> {
  return resolveStream(videoId, false, maxKbps).then(
    () => undefined,
    () => undefined,
  );
}

export function warmStreamSession(): Promise<void> {
  return getSession(MARKET).then(
    () => undefined,
    (error: unknown) => {
      console.warn(`[hushio] session warm-up failed: ${describeError(error)}`);
    },
  );
}
