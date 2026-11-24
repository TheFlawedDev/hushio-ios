import { X, FolderOpen, ArrowClockwise } from "@phosphor-icons/react";
import {
  downloadCancel,
  downloadQueue,
  downloadStart,
  jsLog,
  listenDownloadEvents,
  openFolder,
  downloadDeleteFile,
  pickFolder,
  revealPath,
  type DownloadEvent,
} from "./bridge";
import { plural } from "./plural";
import { resolveStream } from "./resolveStream";
import { currentNetworkType, subscribeNetworkType, type NetworkType } from "./networkType";
import { type DownloadItem, type DownloadTrack, useLibrary } from "../stores/library";
import { type DownloadQuality, useSettings } from "../stores/settings";
import { type MenuItem, useUI } from "../stores/ui";

const DOWNLOAD_ALL_CONFIRM = 25;
const GB_PER_SONG = 0.04;
const PROGRESS_TICK_MS = 500;
const EXPIRED_MESSAGE = "The link expired. Try again.";
const QUALITY_KBPS: Record<DownloadQuality, number | undefined> = {
  standard: 128,
  high: 192,
  lossless: undefined,
};

export type DownloadSource = {
  id: string;
  title: string;
  artist: string;
  thumb?: string | null;
  album?: string | null;
  duration?: number;
};

type SentStream = { dir?: string; itag?: number; clen?: number };

const retried = new Set<string>();
const sent = new Map<string, SentStream>();

function notify(message: string, kind: "info" | "success" | "error" = "info", art?: string | null) {
  useUI.getState().toast(message, kind, undefined, undefined, art ? { art } : undefined);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function patch(id: string, changes: Partial<DownloadItem>) {
  useLibrary.getState().patchDownload(id, changes);
}

export function isDownloadable(id: string): boolean {
  return !id.startsWith("local:");
}

export function shouldHoldForWifi(wifiOnly: boolean, network: NetworkType): boolean {
  return wifiOnly && network === "cellular";
}

function holding(): boolean {
  return shouldHoldForWifi(useSettings.getState().downloadWifiOnly, currentNetworkType());
}

function isPending(status: DownloadItem["status"] | undefined): boolean {
  return status === "queued" || status === "downloading" || status === "waiting";
}

export function downloadedPath(id: string): string | null {
  const item = useLibrary.getState().downloads[id];
  return item?.status === "done" && item.path ? item.path : null;
}

function trackOf(source: DownloadSource): DownloadTrack {
  return {
    id: source.id,
    title: source.title,
    artist: source.artist,
    thumb: source.thumb ?? undefined,
    album: source.album ?? undefined,
    duration: source.duration ?? 0,
  };
}

async function queue(source: DownloadSource, dir?: string, expired?: SentStream): Promise<void> {
  const library = useLibrary.getState();
  const track = trackOf(source);
  const hold = holding();
  library.setDownload(source.id, {
    track,
    path: library.downloads[source.id]?.path ?? null,
    status: hold ? "waiting" : "queued",
    progress: 0,
    downloaded: 0,
    total: 0,
  });
  if (hold) return;
  const { downloadDir, downloadQuality, exportDownloads } = useSettings.getState();
  const target = dir ?? downloadDir ?? undefined;
  try {
    const stream = await resolveStream(source.id, true, QUALITY_KBPS[downloadQuality], true);
    const resume = expired?.itag !== undefined && expired.itag === stream.itag && expired.clen === stream.clen;
    sent.set(source.id, { dir: target, itag: stream.itag, clen: stream.clen });
    // Message-only diagnostics (no signed URL): the exact values the native side was handed.
    jsLog(
      "info",
      `download ${source.id}: quality=${downloadQuality} itag=${stream.itag ?? "?"} clen=${stream.clen ?? "?"} dir=${target ?? "default"} export=${exportDownloads}`,
    );
    await downloadStart(track, stream.url, target, exportDownloads, resume);
  } catch (error) {
    patch(source.id, { status: "failed", progress: 0 });
    jsLog("warn", `download ${source.id} failed: ${describe(error)}`);
    notify(`Download failed: ${describe(error)}`, "error", source.thumb);
  }
}

export async function startDownload(source: DownloadSource, dir?: string): Promise<void> {
  const existing = useLibrary.getState().downloads[source.id];
  if (isPending(existing?.status)) return;
  if (existing?.status === "done") {
    notify("Already downloaded — see the Downloads view", "info", source.thumb);
    return;
  }
  retried.delete(source.id);
  await queue(source, dir);
}

const YT_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function autoDownloadLiked(source: DownloadSource): void {
  if (!useSettings.getState().autoDownloadLiked || !YT_VIDEO_ID.test(source.id)) return;
  const status = useLibrary.getState().downloads[source.id]?.status;
  if (status === "done" || isPending(status)) return;
  void startDownload(source);
}

export async function cancelDownload(id: string): Promise<void> {
  if (useLibrary.getState().downloads[id]?.status === "waiting") {
    useLibrary.getState().removeDownload(id);
    return;
  }
  try {
    await downloadCancel(id);
    useLibrary.getState().removeDownload(id);
  } catch (error) {
    notify(`Couldn't cancel the download: ${describe(error)}`, "error");
  }
}

export function createProgressBuffer(
  apply: (id: string, downloaded: number, total: number) => void,
  tickMs: number,
) {
  const latest = new Map<string, { downloaded: number; total: number }>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const discard = (id: string) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    latest.delete(id);
  };
  return {
    push(id: string, downloaded: number, total: number) {
      latest.set(id, { downloaded, total });
      if (timers.has(id)) return;
      timers.set(
        id,
        setTimeout(() => {
          const progress = latest.get(id);
          discard(id);
          if (progress) apply(id, progress.downloaded, progress.total);
        }, tickMs),
      );
    },
    discard,
  };
}

function applyProgress(id: string, downloaded: number, total: number) {
  if (!useLibrary.getState().downloads[id]) return;
  patch(id, {
    status: "downloading",
    downloaded,
    total,
    progress: total > 0 ? Math.min(1, downloaded / total) : 0,
  });
}

const progress = createProgressBuffer(applyProgress, PROGRESS_TICK_MS);

function anyActive(): boolean {
  return Object.values(useLibrary.getState().downloads).some((item) => isPending(item.status));
}

export function handleDownloadEvent(event: DownloadEvent): void {
  const { id } = event;
  const library = useLibrary.getState();
  const item = library.downloads[id];
  if (!item) return;
  switch (event.type) {
    case "start":
      applyProgress(id, 0, 0);
      return;
    case "progress":
      progress.push(id, event.downloaded ?? 0, event.total ?? 0);
      return;
    case "done":
      if (!event.path) return;
      progress.discard(id);
      retried.delete(id);
      patch(id, { status: "done", path: event.path, progress: 1 });
      if (!anyActive()) notify("Downloads finished", "success");
      return;
    case "expired": {
      progress.discard(id);
      if (retried.has(id)) {
        retried.delete(id);
        patch(id, { status: "failed", progress: 0 });
        jsLog("warn", `download ${id} expired twice: ${EXPIRED_MESSAGE}`);
        notify(`Download failed: ${EXPIRED_MESSAGE}`, "error");
        return;
      }
      retried.add(id);
      const last = sent.get(id);
      void queue(item.track, last?.dir, last);
      return;
    }
    case "failed":
      progress.discard(id);
      retried.delete(id);
      patch(id, { status: "failed", progress: 0 });
      jsLog("warn", `download ${id} failed: ${event.reason ?? "unknown error"}`);
      notify(`Download failed: ${event.reason ?? "unknown error"}`, "error");
      return;
    case "cancelled":
      progress.discard(id);
      retried.delete(id);
      library.removeDownload(id);
      return;
    case "queued":
      return;
  }
}

export async function reconcileStaleDownloads(): Promise<void> {
  const rows = await downloadQueue().catch(() => null);
  if (!rows) return;
  const live = new Set(rows.map((row) => row.id));
  const library = useLibrary.getState();
  for (const [id, item] of Object.entries(library.downloads)) {
    if ((item.status === "queued" || item.status === "downloading") && !live.has(id)) {
      library.patchDownload(id, { status: "failed", progress: 0 });
    }
  }
}

export function releaseWaitingDownloads(): void {
  if (holding()) return;
  const waiting = Object.values(useLibrary.getState().downloads).filter((item) => item.status === "waiting");
  for (const item of waiting) void queue(item.track);
}

export function autoDownloadAdded(playlistTracks: DownloadSource[], addedIds: readonly string[]): void {
  if (!useSettings.getState().keepPlaylistsUpdated) return;
  const downloads = useLibrary.getState().downloads;
  const added = new Set(addedIds);
  const existing = playlistTracks.filter((track) => !added.has(track.id) && isDownloadable(track.id));
  if (existing.length === 0 || !existing.every((track) => downloads[track.id]?.status === "done")) return;
  for (const track of playlistTracks) {
    if (!added.has(track.id) || !isDownloadable(track.id) || downloads[track.id]?.status === "done") continue;
    void startDownload(track);
  }
}

export async function listenForDownloadProgress(): Promise<() => void> {
  await reconcileStaleDownloads();
  const stopNetwork = subscribeNetworkType(releaseWaitingDownloads);
  const stopSettings = useSettings.subscribe(releaseWaitingDownloads);
  const unlisten = await listenDownloadEvents(handleDownloadEvent);
  return () => {
    stopNetwork();
    stopSettings();
    unlisten();
  };
}

export function revealDownload(path: string): void {
  revealPath(path).catch((error: unknown) => notify(`Couldn't show the file: ${describe(error)}`, "error"));
}

export function openDownloadFolder(): void {
  openFolder(useSettings.getState().downloadDir ?? undefined).catch(() =>
    notify("Couldn't open the downloads folder", "error"),
  );
}

export async function chooseDownloadFolder(): Promise<void> {
  const picked = await pickFolder().catch(() => {
    notify("Couldn't open the folder picker", "error");
    return undefined;
  });
  if (!picked) return;
  useSettings.getState().setDownloadDir(picked);
  notify("Download folder updated", "success");
}

export function downloadAll(sources: DownloadSource[], what: string): void {
  const downloads = useLibrary.getState().downloads;
  const seen = new Set<string>();
  const pending = sources.filter((source) => {
    if (seen.has(source.id) || !isDownloadable(source.id)) return false;
    seen.add(source.id);
    const status = downloads[source.id]?.status;
    return status !== "done" && !isPending(status);
  });
  if (pending.length === 0) {
    notify(`Everything in ${what} is already downloaded`);
    return;
  }
  const start = () => {
    notify(`Downloading ${plural(pending.length, "song", "songs")} from ${what}`);
    for (const source of pending) void startDownload(source);
  };
  if (pending.length <= DOWNLOAD_ALL_CONFIRM) {
    start();
    return;
  }
  const size = Math.max(0.1, Math.round(pending.length * GB_PER_SONG * 10) / 10);
  useUI.getState().openDialog({
    title: `Download ${plural(pending.length, "song", "songs")}?`,
    body: `That's roughly ${size} GB. They download two at a time; you can cancel any of them in Downloads.`,
    confirmLabel: "Download all",
    onConfirm: start,
  });
}

export function removeDownload(id: string): void {
  const item = useLibrary.getState().downloads[id];
  if (item?.path) void downloadDeleteFile(item.path).catch(() => undefined);
  useLibrary.getState().removeDownload(id);
}

export function downloadMenuItems(item: DownloadItem): MenuItem[] {
  const { track, status, path } = item;
  const busy = isPending(status);
  const items: MenuItem[] = [];
  if (status === "failed") {
    items.push({ label: "Retry download", icon: ArrowClockwise, onSelect: () => void startDownload(track) });
  }
  if (busy) {
    items.push({
      label: "Cancel download",
      icon: X,
      danger: true,
      onSelect: () => void cancelDownload(track.id),
    });
  }
  if (status === "done" && path) {
    items.push({ label: "Show in folder", icon: FolderOpen, onSelect: () => revealDownload(path) });
  }
  if (!busy) {
    items.push({
      label: "Remove download",
      icon: X,
      danger: true,
      separatorBefore: items.length > 0,
      onSelect: () => removeDownload(track.id),
    });
  }
  return [
    ...items,
    { label: track.title, subject: { title: track.title, subtitle: track.artist, thumb: track.thumb ?? null } },
  ];
}
