import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadsView } from "./DownloadsView";
import { type DownloadItem, useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import { ContextMenu } from "../components/ContextMenu";

const bridge = vi.hoisted(() => ({
  platform: "windows",
  downloadCancel: vi.fn(),
  downloadDeleteFile: vi.fn(async () => undefined),
  downloadQueue: vi.fn(),
  downloadStart: vi.fn(),
  jsLog: vi.fn(),
  listenDownloadEvents: vi.fn(),
  openFolder: vi.fn(),
  persistRead: vi.fn(async () => null),
  persistWrite: vi.fn(async () => true),
  pickFolder: vi.fn(),
  revealPath: vi.fn(),
}));

const resolve = vi.hoisted(() => vi.fn());

vi.mock("../lib/bridge", () => bridge);
vi.mock("../lib/resolveStream", () => ({ resolveStream: resolve }));

function row(
  id: string,
  title: string,
  status: DownloadItem["status"],
  extra: Partial<DownloadItem> = {},
): DownloadItem {
  return {
    track: { id, title, artist: `${title} artist`, duration: 200 },
    path: null,
    status,
    progress: 0,
    downloaded: 0,
    total: 0,
    ...extra,
  };
}

function seed(items: DownloadItem[]) {
  useLibrary.setState({
    downloads: Object.fromEntries(items.map((item) => [item.track.id, item])),
  });
}

function rowFor(title: string): HTMLElement {
  const element = screen.getByText(title, { selector: "span.block" }).closest("li");
  if (!element) throw new Error(`no row for ${title}`);
  return element;
}

beforeEach(() => {
  useLibrary.setState({ downloads: {} });
  useUI.setState({ toasts: [], pendingToasts: [], contextMenu: null });
  resolve.mockReset().mockResolvedValue({ url: "https://rr.test/s", mime: "audio/mp4", lufs: null });
  bridge.downloadStart.mockReset().mockResolvedValue(undefined);
  bridge.downloadCancel.mockReset().mockResolvedValue(true);
  bridge.revealPath.mockReset().mockResolvedValue(undefined);
  bridge.openFolder.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("Downloads view states", () => {
  it("shows the empty hero and empty state with nothing saved", () => {
    render(<DownloadsView />);

    expect(screen.getByRole("heading", { name: "Downloads" })).toBeTruthy();
    expect(screen.getByText("Nothing saved yet")).toBeTruthy();
    expect(screen.getByText("No downloads yet")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Play Downloads" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Shuffle" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists every status with its text, sorted by title", () => {
    seed([
      row("c", "Charlie", "queued"),
      row("a", "Alpha", "done", { path: "/music/Hushio/Alpha.m4a", progress: 1, track: { id: "a", title: "Alpha", artist: "x", duration: 185 } }),
      row("b", "Bravo", "downloading", { progress: 0.4 }),
      row("d", "Delta", "failed"),
    ]);
    render(<DownloadsView />);

    const titles = screen.getAllByRole("listitem").map((item) => item.querySelector("span.block")?.textContent);
    expect(titles).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(within(rowFor("Alpha")).getByText("Saved")).toBeTruthy();
    expect(within(rowFor("Bravo")).getByText("Downloading · 40%")).toBeTruthy();
    expect(within(rowFor("Charlie")).getByText("Waiting to download")).toBeTruthy();
    expect(within(rowFor("Delta")).getByText("Couldn't download")).toBeTruthy();
  });

  it("summarises saved songs, songs on the way and failures in the hero", () => {
    seed([
      row("a", "Alpha", "done", { path: "/a.m4a", track: { id: "a", title: "Alpha", artist: "x", duration: 200 } }),
      row("b", "Bravo", "downloading"),
      row("c", "Charlie", "failed"),
    ]);
    render(<DownloadsView />);

    expect(screen.getByText(/1 song/)).toBeTruthy();
    expect(screen.getByText("· 1 on the way")).toBeTruthy();
    expect(screen.getByText("· 1 couldn't download")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Play Downloads" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("plays a saved song from its place in the saved list", () => {
    seed([
      row("a", "Alpha", "done", { path: "/a.m4a" }),
      row("b", "Bravo", "done", { path: "/b.m4a" }),
    ]);
    const playQueue = vi.spyOn(usePlayer.getState(), "playQueue").mockImplementation(() => {});
    render(<DownloadsView />);

    fireEvent.doubleClick(screen.getByRole("button", { name: /Bravo/ }));

    expect(playQueue).toHaveBeenCalledWith(
      [
        { id: "a", title: "Alpha", artist: "Alpha artist", thumb: null, album: undefined, duration: 200 },
        { id: "b", title: "Bravo", artist: "Bravo artist", thumb: null, album: undefined, duration: 200 },
      ],
      1,
      "__downloads__",
    );
    playQueue.mockRestore();
  });

  it("selects a row that is not saved yet but does not play it", () => {
    seed([row("c", "Charlie", "queued")]);
    const playQueue = vi.spyOn(usePlayer.getState(), "playQueue").mockImplementation(() => {});
    render(<DownloadsView />);

    const charlie = screen.getByRole("button", { name: /Charlie/ }) as HTMLButtonElement;
    expect(charlie.disabled).toBe(false);
    fireEvent.doubleClick(charlie);
    expect(playQueue).not.toHaveBeenCalled();
  });
});

describe("Downloads row actions", () => {
  it("retries a failed song", async () => {
    seed([row("d", "Delta", "failed")]);
    render(<DownloadsView />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Retry download" }));

    expect(resolve).toHaveBeenCalledWith("d", true, undefined, true);
    expect(bridge.downloadStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d" }),
      "https://rr.test/s",
      undefined,
      false,
      false,
    );
  });

  it("cancels a queued or running song", async () => {
    seed([row("b", "Bravo", "downloading")]);
    render(<DownloadsView />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Cancel download" }));

    expect(bridge.downloadCancel).toHaveBeenCalledWith("b");
  });

  it("shows a saved file in its folder", async () => {
    seed([row("a", "Alpha", "done", { path: "/music/Hushio/Alpha.m4a" })]);
    render(<DownloadsView />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Show in folder" }));

    expect(bridge.revealPath).toHaveBeenCalledWith("/music/Hushio/Alpha.m4a");
  });

  it("removes a finished row from the list", async () => {
    seed([row("a", "Alpha", "done", { path: "/a.m4a" })]);
    render(<DownloadsView />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove download" }));

    expect(useLibrary.getState().downloads).toEqual({});
  });

  it("hides remove while a song is still running", () => {
    seed([row("b", "Bravo", "downloading")]);
    render(<DownloadsView />);

    expect(screen.queryByRole("button", { name: "Remove download" })).toBeNull();
  });

  it("opens the downloads folder from the hero menu", async () => {
    seed([row("a", "Alpha", "done", { path: "/a.m4a" })]);
    render(<><DownloadsView /><ContextMenu /></>);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(screen.getByRole("menuitem", { name: "Open the downloads folder" }));

    expect(bridge.openFolder).toHaveBeenCalledWith(undefined);
  });
});

describe("Downloads row menu", () => {
  it("opens the menu with show in folder and remove for a saved song", () => {
    seed([row("a", "Alpha", "done", { path: "/a.m4a" })]);
    render(<DownloadsView />);

    fireEvent.contextMenu(rowFor("Alpha"));

    const labels = useUI.getState().contextMenu?.items.filter((entry) => !entry.subject).map((entry) => entry.label);
    expect(labels).toEqual(["Show in folder", "Remove download"]);
  });

  it("offers retry for a failed song and cancel for a running one", () => {
    seed([row("d", "Delta", "failed"), row("b", "Bravo", "downloading")]);
    render(<DownloadsView />);

    fireEvent.contextMenu(rowFor("Delta"));
    expect(useUI.getState().contextMenu?.items.map((entry) => entry.label)).toContain("Retry download");

    fireEvent.contextMenu(rowFor("Bravo"));
    expect(useUI.getState().contextMenu?.items.map((entry) => entry.label)).toContain("Cancel download");
  });
});
