import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autoDownloadAdded,
  shouldHoldForWifi,
  releaseWaitingDownloads,
  autoDownloadLiked,
  chooseDownloadFolder,
  cancelDownload,
  createProgressBuffer,
  downloadAll,
  downloadedPath,
  downloadMenuItems,
  handleDownloadEvent,
  listenForDownloadProgress,
  reconcileStaleDownloads,
  revealDownload,
  removeDownload,
  openDownloadFolder,
  startDownload,
  type DownloadSource,
} from "./downloads";
import { type DownloadItem, useLibrary } from "../stores/library";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";

const bridge = vi.hoisted(() => ({
  downloadCancel: vi.fn(),
  downloadDeleteFile: vi.fn(async () => undefined),
  downloadQueue: vi.fn(),
  downloadStart: vi.fn(),
  listenDownloadEvents: vi.fn(),
  jsLog: vi.fn(),
  openFolder: vi.fn(),
  persistRead: vi.fn(async () => null),
  persistWrite: vi.fn(async () => true),
  pickFolder: vi.fn(),
  revealPath: vi.fn(),
}));

const resolve = vi.hoisted(() => vi.fn());

const network = vi.hoisted(() => ({ type: "wifi" as "wifi" | "cellular" | "unknown" }));

vi.mock("./bridge", () => bridge);
vi.mock("./resolveStream", () => ({ resolveStream: resolve }));
vi.mock("./networkType", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./networkType")>()),
  currentNetworkType: () => network.type,
}));

const SONG: DownloadSource = { id: "abc123", title: "Song", artist: "Artist", thumb: "https://img.test/t.jpg", duration: 200 };

function item(overrides: Partial<DownloadItem> & Pick<DownloadItem, "status">): DownloadItem {
  return {
    track: { id: "abc123", title: "Song", artist: "Artist", duration: 200 },
    path: null,
    progress: 0,
    downloaded: 0,
    total: 0,
    ...overrides,
  };
}

function seed(id: string, value: DownloadItem) {
  useLibrary.setState({ downloads: { ...useLibrary.getState().downloads, [id]: value } });
}

function toastMessages(): string[] {
  return useUI.getState().toasts.map((toast) => toast.message);
}

beforeEach(() => {
  useLibrary.setState({ downloads: {} });
  useUI.setState({ toasts: [], pendingToasts: [], dialog: null });
  useSettings.setState({
    downloadDir: null,
    downloadQuality: "lossless",
    exportDownloads: false,
    downloadWifiOnly: false,
    keepPlaylistsUpdated: true,
  });
  network.type = "wifi";
  resolve.mockReset().mockResolvedValue({ url: "https://rr.test/stream", mime: "audio/mp4", lufs: null });
  bridge.downloadStart.mockReset().mockResolvedValue(undefined);
  bridge.downloadCancel.mockReset().mockResolvedValue(true);
  bridge.downloadQueue.mockReset().mockResolvedValue([]);
  bridge.listenDownloadEvents.mockReset().mockResolvedValue(() => {});
  bridge.openFolder.mockReset().mockResolvedValue(undefined);
  bridge.pickFolder.mockReset();
  bridge.revealPath.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startDownload", () => {
  it("queues the song and sends the resolved https url with the default folder", async () => {
    await startDownload(SONG);

    expect(resolve).toHaveBeenCalledWith("abc123", true, undefined, true);
    expect(bridge.downloadStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: "abc123", title: "Song", artist: "Artist", duration: 200 }),
      "https://rr.test/stream",
      undefined,
      false,
      false,
    );
    expect(useLibrary.getState().downloads.abc123.status).toBe("queued");
  });

  it("caps the stream bitrate for standard and high quality", async () => {
    useSettings.setState({ downloadQuality: "standard" });
    await startDownload(SONG);
    useSettings.setState({ downloadQuality: "high" });
    await startDownload({ ...SONG, id: "def456" });

    expect(resolve).toHaveBeenNthCalledWith(1, "abc123", true, 128, true);
    expect(resolve).toHaveBeenNthCalledWith(2, "def456", true, 192, true);
  });

  it("passes the saved folder and the export setting to the backend", async () => {
    useSettings.setState({ downloadDir: "D:/Music/Saved", exportDownloads: true });
    await startDownload(SONG);

    expect(bridge.downloadStart).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "D:/Music/Saved",
      true,
      false,
    );
  });

  it("does nothing for a song that is already queued or downloading", async () => {
    seed("abc123", item({ status: "downloading" }));
    await startDownload(SONG);
    seed("abc123", item({ status: "queued" }));
    await startDownload(SONG);

    expect(resolve).not.toHaveBeenCalled();
    expect(bridge.downloadStart).not.toHaveBeenCalled();
  });

  it("explains that a finished song is already saved", async () => {
    seed("abc123", item({ status: "done", path: "/music/a.m4a" }));
    await startDownload(SONG);

    expect(toastMessages()).toEqual(["Already downloaded — see the Downloads view"]);
    expect(bridge.downloadStart).not.toHaveBeenCalled();
  });

  it("marks the row failed and toasts when the stream cannot be resolved", async () => {
    resolve.mockRejectedValueOnce(new Error("boom"));
    await startDownload(SONG);

    expect(useLibrary.getState().downloads.abc123).toMatchObject({ status: "failed", progress: 0 });
    expect(toastMessages()).toEqual(["Download failed: boom"]);
  });
});

describe("autoDownloadLiked", () => {
  const VIDEO: DownloadSource = { ...SONG, id: "dQw4w9WgXcQ" };

  beforeEach(() => {
    useSettings.setState({ autoDownloadLiked: false });
  });

  it("does nothing while the setting is off", () => {
    autoDownloadLiked(VIDEO);
    expect(resolve).not.toHaveBeenCalled();
    expect(useLibrary.getState().downloads.dQw4w9WgXcQ).toBeUndefined();
  });

  it("queues a YouTube song once when the setting is on", async () => {
    useSettings.setState({ autoDownloadLiked: true });
    autoDownloadLiked(VIDEO);
    autoDownloadLiked(VIDEO);
    await vi.waitFor(() => expect(bridge.downloadStart).toHaveBeenCalledTimes(1));
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(useLibrary.getState().downloads.dQw4w9WgXcQ.status).toBe("queued");
  });

  it("skips songs that are already downloaded or queued", () => {
    useSettings.setState({ autoDownloadLiked: true });
    seed("aaaaaaaaaaa", item({ status: "done", path: "D:/Music/done.m4a" }));
    seed("bbbbbbbbbbb", item({ status: "queued" }));
    seed("ccccccccccc", item({ status: "downloading" }));
    autoDownloadLiked({ ...VIDEO, id: "aaaaaaaaaaa" });
    autoDownloadLiked({ ...VIDEO, id: "bbbbbbbbbbb" });
    autoDownloadLiked({ ...VIDEO, id: "ccccccccccc" });
    expect(resolve).not.toHaveBeenCalled();
    expect(toastMessages()).toEqual([]);
  });

  it("skips songs that are not YouTube videos", () => {
    useSettings.setState({ autoDownloadLiked: true });
    autoDownloadLiked({ ...VIDEO, id: "net:abcdefghij" });
    autoDownloadLiked({ ...VIDEO, id: "local:abcdefghijk" });
    autoDownloadLiked({ ...VIDEO, id: "short" });
    expect(resolve).not.toHaveBeenCalled();
    expect(useLibrary.getState().downloads).toEqual({});
  });
});

describe("handleDownloadEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seed("abc123", item({ status: "queued" }));
    handleDownloadEvent({ type: "cancelled", id: "abc123" });
    seed("abc123", item({ status: "queued" }));
  });

  it("moves a queued row to downloading on start", () => {
    handleDownloadEvent({ type: "start", id: "abc123" });

    expect(useLibrary.getState().downloads.abc123).toMatchObject({ status: "downloading", progress: 0 });
  });

  it("applies only the latest progress once per tick", () => {
    handleDownloadEvent({ type: "start", id: "abc123" });
    handleDownloadEvent({ type: "progress", id: "abc123", downloaded: 10, total: 100 });
    handleDownloadEvent({ type: "progress", id: "abc123", downloaded: 50, total: 100 });

    expect(useLibrary.getState().downloads.abc123.progress).toBe(0);
    vi.advanceTimersByTime(500);
    expect(useLibrary.getState().downloads.abc123).toMatchObject({ downloaded: 50, total: 100, progress: 0.5 });
  });

  it("marks the row done with its path and announces when nothing else runs", () => {
    handleDownloadEvent({ type: "done", id: "abc123", path: "/music/Hushio/Artist - Song.m4a" });

    expect(useLibrary.getState().downloads.abc123).toMatchObject({
      status: "done",
      path: "/music/Hushio/Artist - Song.m4a",
      progress: 1,
    });
    expect(toastMessages()).toEqual(["Downloads finished"]);
  });

  it("keeps the announcement quiet while another song still runs", () => {
    seed("other", item({ status: "downloading" }));
    handleDownloadEvent({ type: "done", id: "abc123", path: "/music/a.m4a" });

    expect(toastMessages()).toEqual([]);
  });

  it("ignores a done event without a path", () => {
    handleDownloadEvent({ type: "done", id: "abc123" });

    expect(useLibrary.getState().downloads.abc123.status).toBe("queued");
  });

  it("marks the row failed with the reason", () => {
    handleDownloadEvent({ type: "failed", id: "abc123", reason: "disk full" });

    expect(useLibrary.getState().downloads.abc123).toMatchObject({ status: "failed", progress: 0 });
    expect(toastMessages()).toEqual(["Download failed: disk full"]);
  });

  it("removes the row on cancelled", () => {
    handleDownloadEvent({ type: "cancelled", id: "abc123" });

    expect(useLibrary.getState().downloads.abc123).toBeUndefined();
  });

  it("ignores events for songs that have no row", () => {
    handleDownloadEvent({ type: "start", id: "ghost" });
    handleDownloadEvent({ type: "failed", id: "ghost", reason: "x" });

    expect(useLibrary.getState().downloads).toEqual({ abc123: expect.objectContaining({ status: "queued" }) });
    expect(toastMessages()).toEqual([]);
  });
});

describe("expired links", () => {
  const FIRST = { url: "https://rr.test/one", mime: "audio/mp4", lufs: null, itag: 251, clen: 1000 };
  const SECOND = { url: "https://rr.test/two", mime: "audio/mp4", lufs: null, itag: 251, clen: 1000 };

  beforeEach(() => {
    resolve.mockResolvedValue(FIRST);
  });

  it("re-resolves once and resumes from the bytes already on disk when the stream matches", async () => {
    await startDownload(SONG);
    resolve.mockResolvedValue(SECOND);
    handleDownloadEvent({ type: "expired", id: "abc123" });
    await vi.waitFor(() => expect(bridge.downloadStart).toHaveBeenCalledTimes(2));

    expect(resolve).toHaveBeenLastCalledWith("abc123", true, undefined, true);
    expect(bridge.downloadStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "abc123" }),
      "https://rr.test/two",
      undefined,
      false,
      true,
    );
    expect(toastMessages()).toEqual([]);
  });

  it("keeps the saved folder when it restarts", async () => {
    useSettings.setState({ downloadDir: "D:/Music/Saved" });
    await startDownload(SONG);
    resolve.mockResolvedValue(SECOND);
    handleDownloadEvent({ type: "expired", id: "abc123" });
    await vi.waitFor(() => expect(bridge.downloadStart).toHaveBeenCalledTimes(2));

    expect(bridge.downloadStart).toHaveBeenLastCalledWith(
      expect.anything(),
      "https://rr.test/two",
      "D:/Music/Saved",
      false,
      true,
    );
  });

  it("restarts from zero when the fresh stream is a different encoding", async () => {
    await startDownload(SONG);
    resolve.mockResolvedValue({ ...SECOND, itag: 140 });
    handleDownloadEvent({ type: "expired", id: "abc123" });
    await vi.waitFor(() => expect(bridge.downloadStart).toHaveBeenCalledTimes(2));

    expect(bridge.downloadStart).toHaveBeenLastCalledWith(
      expect.anything(),
      "https://rr.test/two",
      undefined,
      false,
      false,
    );
  });

  it("fails with a clear message when the fresh link expires too", async () => {
    await startDownload(SONG);
    resolve.mockResolvedValue(SECOND);
    handleDownloadEvent({ type: "expired", id: "abc123" });
    await vi.waitFor(() => expect(bridge.downloadStart).toHaveBeenCalledTimes(2));
    handleDownloadEvent({ type: "expired", id: "abc123" });

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(bridge.downloadStart).toHaveBeenCalledTimes(2);
    expect(useLibrary.getState().downloads.abc123.status).toBe("failed");
    expect(toastMessages()).toEqual(["Download failed: The link expired. Try again."]);
  });

  it("shows an expiry reported by the backend after a resumed run without re-resolving", async () => {
    await startDownload(SONG);
    handleDownloadEvent({ type: "failed", id: "abc123", reason: "The link expired. Try again." });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(useLibrary.getState().downloads.abc123.status).toBe("failed");
    expect(toastMessages()).toEqual(["Download failed: The link expired. Try again."]);
  });

  it("does not re-resolve for other failures", async () => {
    await startDownload(SONG);
    handleDownloadEvent({ type: "failed", id: "abc123", reason: "HTTP 503" });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(bridge.downloadStart).toHaveBeenCalledTimes(1);
    expect(toastMessages()).toEqual(["Download failed: HTTP 503"]);
  });
});

describe("createProgressBuffer", () => {
  it("applies the latest value after the tick and drops discarded ones", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const buffer = createProgressBuffer(apply, 500);

    buffer.push("a", 1, 10);
    buffer.push("a", 2, 10);
    buffer.push("b", 3, 10);
    buffer.discard("b");
    vi.advanceTimersByTime(499);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("a", 2, 10);
  });
});

describe("reconcileStaleDownloads and listenForDownloadProgress", () => {
  it("marks queued or downloading rows that the backend no longer runs as failed", async () => {
    seed("live", item({ status: "downloading" }));
    seed("lost", item({ status: "queued" }));
    seed("stuck", item({ status: "downloading" }));
    seed("saved", item({ status: "done", path: "/a.m4a" }));
    seed("old", item({ status: "failed" }));
    bridge.downloadQueue.mockResolvedValue([{ id: "live", running: true, downloaded: 1, total: 2 }]);

    await reconcileStaleDownloads();

    const downloads = useLibrary.getState().downloads;
    expect(downloads.live.status).toBe("downloading");
    expect(downloads.lost).toMatchObject({ status: "failed", progress: 0 });
    expect(downloads.stuck).toMatchObject({ status: "failed", progress: 0 });
    expect(downloads.saved.status).toBe("done");
    expect(downloads.old.status).toBe("failed");
  });

  it("leaves rows alone when the queue cannot be read", async () => {
    seed("lost", item({ status: "queued" }));
    bridge.downloadQueue.mockRejectedValue(new Error("offline"));

    await reconcileStaleDownloads();

    expect(useLibrary.getState().downloads.lost.status).toBe("queued");
  });

  it("reconciles before subscribing to events", async () => {
    seed("lost", item({ status: "queued" }));
    const calls: string[] = [];
    bridge.downloadQueue.mockImplementation(async () => {
      calls.push("queue");
      return [];
    });
    bridge.listenDownloadEvents.mockImplementation(async () => {
      calls.push("listen");
      return () => {};
    });

    const unlisten = await listenForDownloadProgress();

    expect(calls).toEqual(["queue", "listen"]);
    expect(bridge.listenDownloadEvents).toHaveBeenCalledWith(handleDownloadEvent);
    expect(typeof unlisten).toBe("function");
  });
});

describe("downloadAll", () => {
  const songs = (count: number, prefix = "s"): DownloadSource[] =>
    Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, title: `T${index}`, artist: "A" }));

  it("starts up to 25 songs at once, once per id", async () => {
    downloadAll([...songs(2), songs(1)[0], { id: "local:1", title: "Local", artist: "A" }], "Album X");
    await vi.waitFor(() => expect(bridge.downloadStart).toHaveBeenCalledTimes(2));

    expect(toastMessages()).toEqual(["Downloading 2 songs from Album X"]);
  });

  it("skips saved, queued and running songs", () => {
    seed("s0", item({ status: "done", path: "/a.m4a" }));
    seed("s1", item({ status: "queued" }));
    seed("s2", item({ status: "downloading" }));
    seed("s3", item({ status: "failed" }));
    downloadAll(songs(4), "Mix");

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("s3", true, undefined, true);
  });

  it("says when everything is already saved", () => {
    seed("s0", item({ status: "done", path: "/a.m4a" }));
    downloadAll(songs(1), "Mix");

    expect(toastMessages()).toEqual(["Everything in Mix is already downloaded"]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("asks first for more than 25 songs and sizes the download in GB", async () => {
    downloadAll(songs(30), "Big list");

    const dialog = useUI.getState().dialog;
    expect(dialog?.title).toBe("Download 30 songs?");
    expect(dialog?.body).toBe(
      "That's roughly 1.2 GB. They download two at a time; you can cancel any of them in Downloads.",
    );
    expect(dialog?.confirmLabel).toBe("Download all");
    expect(resolve).not.toHaveBeenCalled();

    dialog?.onConfirm("");
    await vi.waitFor(() => expect(bridge.downloadStart).toHaveBeenCalledTimes(30));
  });

  it("rounds the size estimate to a tenth of a GB", () => {
    downloadAll(songs(26), "Tiny");
    expect(useUI.getState().dialog?.body).toContain("roughly 1 GB");
  });
});

describe("cancelDownload", () => {
  it("cancels in the backend and removes the row", async () => {
    seed("abc123", item({ status: "downloading" }));
    await cancelDownload("abc123");

    expect(bridge.downloadCancel).toHaveBeenCalledWith("abc123");
    expect(useLibrary.getState().downloads.abc123).toBeUndefined();
  });

  it("keeps the row and reports the error when the backend refuses", async () => {
    seed("abc123", item({ status: "downloading" }));
    bridge.downloadCancel.mockRejectedValue(new Error("gone"));
    await cancelDownload("abc123");

    expect(useLibrary.getState().downloads.abc123.status).toBe("downloading");
    expect(toastMessages()).toEqual(["Couldn't cancel the download: gone"]);
  });
});

describe("folders and reveal", () => {
  it("reveals a saved file and toasts when the backend refuses", async () => {
    revealDownload("/music/a.m4a");
    expect(bridge.revealPath).toHaveBeenCalledWith("/music/a.m4a");

    bridge.revealPath.mockRejectedValue(new Error("nope"));
    revealDownload("/music/b.m4a");
    await vi.waitFor(() => expect(toastMessages()).toEqual(["Couldn't show the file: nope"]));
  });

  it("opens the default folder when no custom folder is set", () => {
    openDownloadFolder();
    expect(bridge.openFolder).toHaveBeenCalledWith(undefined);

    useSettings.setState({ downloadDir: "D:/Keep" });
    openDownloadFolder();
    expect(bridge.openFolder).toHaveBeenLastCalledWith("D:/Keep");
  });

  it("stores a picked folder and confirms it", async () => {
    bridge.pickFolder.mockResolvedValue("D:/Picked");
    await chooseDownloadFolder();

    expect(useSettings.getState().downloadDir).toBe("D:/Picked");
    expect(toastMessages()).toEqual(["Download folder updated"]);
  });

  it("keeps the folder when the picker is cancelled", async () => {
    bridge.pickFolder.mockResolvedValue(null);
    await chooseDownloadFolder();

    expect(useSettings.getState().downloadDir).toBeNull();
    expect(toastMessages()).toEqual([]);
  });

  it("toasts when the picker cannot open", async () => {
    bridge.pickFolder.mockRejectedValue(new Error("no dialog"));
    await chooseDownloadFolder();

    expect(toastMessages()).toEqual(["Couldn't open the folder picker"]);
  });
});

describe("downloadedPath", () => {
  it("returns a path only for songs that are done", () => {
    seed("abc123", item({ status: "done", path: "/a.m4a" }));
    seed("def456", item({ status: "failed", path: "/b.m4a" }));

    expect(downloadedPath("abc123")).toBe("/a.m4a");
    expect(downloadedPath("def456")).toBeNull();
    expect(downloadedPath("none")).toBeNull();
  });
});

describe("downloadMenuItems", () => {
  const labels = (items: ReturnType<typeof downloadMenuItems>) =>
    items.filter((entry) => !entry.subject).map((entry) => entry.label);

  it("offers retry and remove for a failed song", () => {
    const items = downloadMenuItems(item({ status: "failed" }));

    expect(labels(items)).toEqual(["Retry download", "Remove download"]);
    expect(items.every((entry) => !entry.disabled)).toBe(true);
  });

  it("offers cancel only while a song is queued or downloading", () => {
    expect(labels(downloadMenuItems(item({ status: "queued" })))).toEqual(["Cancel download"]);
    expect(labels(downloadMenuItems(item({ status: "downloading" })))).toEqual(["Cancel download"]);
  });

  it("offers show in folder and remove for a saved song", () => {
    const items = downloadMenuItems(item({ status: "done", path: "/a.m4a" }));

    expect(labels(items)).toEqual(["Show in folder", "Remove download"]);
    const subject = items.find((entry) => entry.subject)?.subject;
    expect(subject).toEqual({ title: "Song", subtitle: "Artist", thumb: null });
  });

  it("runs the matching action when selected", () => {
    const saved = downloadMenuItems(item({ status: "done", path: "/a.m4a" }));
    saved.find((entry) => entry.label === "Show in folder")?.onSelect?.();
    expect(bridge.revealPath).toHaveBeenCalledWith("/a.m4a");

    seed("abc123", item({ status: "done", path: "/a.m4a" }));
    downloadMenuItems(useLibrary.getState().downloads.abc123)
      .find((entry) => entry.label === "Remove download")
      ?.onSelect?.();
    expect(useLibrary.getState().downloads.abc123).toBeUndefined();
  });
});

describe("removeDownload", () => {
  it("deletes the file of a finished download and forgets it", () => {
    seed("abc123", item({ status: "done", path: "/a.m4a" }));
    removeDownload("abc123");
    expect(bridge.downloadDeleteFile).toHaveBeenCalledWith("/a.m4a");
    expect(useLibrary.getState().downloads.abc123).toBeUndefined();
  });
});

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("Wi-Fi only downloads", () => {
  it("holds a download on cellular and starts it once Wi-Fi returns", async () => {
    useSettings.setState({ downloadWifiOnly: true });
    network.type = "cellular";
    await startDownload(SONG);
    expect(useLibrary.getState().downloads.abc123.status).toBe("waiting");
    expect(resolve).not.toHaveBeenCalled();
    expect(bridge.downloadStart).not.toHaveBeenCalled();

    network.type = "wifi";
    releaseWaitingDownloads();
    await vi.waitFor(() => expect(bridge.downloadStart).toHaveBeenCalledTimes(1));
    expect(useLibrary.getState().downloads.abc123.status).toBe("queued");
  });

  it("keeps waiting while the device is still on cellular", async () => {
    useSettings.setState({ downloadWifiOnly: true });
    network.type = "cellular";
    await startDownload(SONG);
    releaseWaitingDownloads();
    await settle();
    expect(useLibrary.getState().downloads.abc123.status).toBe("waiting");
    expect(bridge.downloadStart).not.toHaveBeenCalled();
  });

  it("starts right away on cellular when the setting is off", async () => {
    network.type = "cellular";
    await startDownload(SONG);
    expect(useLibrary.getState().downloads.abc123.status).toBe("queued");
    expect(bridge.downloadStart).toHaveBeenCalledTimes(1);
  });

  it("removes a waiting download on cancel without asking the backend", async () => {
    useSettings.setState({ downloadWifiOnly: true });
    network.type = "cellular";
    await startDownload(SONG);
    await cancelDownload("abc123");
    expect(bridge.downloadCancel).not.toHaveBeenCalled();
    expect(useLibrary.getState().downloads.abc123).toBeUndefined();
  });

  it("holds only on cellular while the setting is on", () => {
    expect(shouldHoldForWifi(true, "cellular")).toBe(true);
    expect(shouldHoldForWifi(false, "cellular")).toBe(false);
    expect(shouldHoldForWifi(true, "wifi")).toBe(false);
    expect(shouldHoldForWifi(true, "unknown")).toBe(false);
  });
});

describe("autoDownloadAdded", () => {
  const SAVED: DownloadSource = { id: "plA", title: "A", artist: "Artist" };
  const NEW: DownloadSource = { id: "plB", title: "B", artist: "Artist" };

  it("downloads a new song when every song already in the playlist is saved", async () => {
    seed("plA", item({ status: "done", path: "/music/a.m4a" }));
    autoDownloadAdded([SAVED, NEW], ["plB"]);
    await vi.waitFor(() =>
      expect(bridge.downloadStart).toHaveBeenCalledWith(expect.objectContaining({ id: "plB" }), expect.any(String), undefined, false, false),
    );
    expect(bridge.downloadStart).toHaveBeenCalledTimes(1);
  });

  it("does nothing when a song already in the playlist is not saved", async () => {
    seed("plA", item({ status: "failed" }));
    autoDownloadAdded([SAVED, NEW], ["plB"]);
    await settle();
    expect(bridge.downloadStart).not.toHaveBeenCalled();
    expect(useLibrary.getState().downloads.plB).toBeUndefined();
  });

  it("does nothing while keeping playlists updated is off", async () => {
    useSettings.setState({ keepPlaylistsUpdated: false });
    seed("plA", item({ status: "done", path: "/music/a.m4a" }));
    autoDownloadAdded([SAVED, NEW], ["plB"]);
    await settle();
    expect(bridge.downloadStart).not.toHaveBeenCalled();
  });

  it("skips a new song that is already saved", async () => {
    seed("plA", item({ status: "done", path: "/music/a.m4a" }));
    seed("plB", item({ status: "done", path: "/music/b.m4a" }));
    autoDownloadAdded([SAVED, NEW], ["plB"]);
    await settle();
    expect(bridge.downloadStart).not.toHaveBeenCalled();
  });
});
