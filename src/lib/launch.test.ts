import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  take: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  listenDeepLink: vi.fn(),
  unlistenDeepLink: vi.fn(),
  dropPaths: vi.fn(),
  playerSetQueue: vi.fn(() => Promise.resolve({ accepted: 1 })),
  playerPlay: vi.fn(() => Promise.resolve()),
  playerTakeLaunch: vi.fn(() => Promise.resolve({} as Record<string, string>)),
  listenPlayerEvent: vi.fn(() => Promise.resolve(() => {})),
  platform: "windows",
  playTrack: vi.fn(),
}));

vi.mock("./bridge", () => ({
  launchTake: hoisted.take,
  listenLaunchPending: hoisted.listen,
  listenPlayerEvent: hoisted.listenPlayerEvent,
  playerSetQueue: hoisted.playerSetQueue,
  playerPlay: hoisted.playerPlay,
  playerTakeLaunch: hoisted.playerTakeLaunch,
  get platform() {
    return hoisted.platform;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (e: { payload: unknown }) => void) =>
    hoisted.listenDeepLink(event, handler),
}));
vi.mock("./localDrop", () => ({ dropPaths: hoisted.dropPaths }));
vi.mock("../stores/player", () => ({ usePlayer: { getState: () => ({ playTrack: hoisted.playTrack }) } }));

import {
  launchActionForUrl,
  playlistBrowseId,
  routeLaunchAction,
  routeLaunchTarget,
  startLaunchActions,
} from "./launch";
import { useNavigation } from "../stores/navigation";

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.platform = "windows";
  hoisted.take.mockResolvedValue([]);
  hoisted.listen.mockResolvedValue(hoisted.unlisten);
  hoisted.listenDeepLink.mockResolvedValue(hoisted.unlistenDeepLink);
  hoisted.dropPaths.mockResolvedValue(undefined);
  hoisted.playerTakeLaunch.mockResolvedValue({});
  hoisted.listenPlayerEvent.mockResolvedValue(hoisted.unlisten);
  useNavigation.setState({ view: { name: "home" }, navPast: [], navFuture: [] });
});

describe("launch actions", () => {
  it("adds the VL prefix to a playlist id once", () => {
    expect(playlistBrowseId("PL123")).toBe("VLPL123");
    expect(playlistBrowseId("VLPL123")).toBe("VLPL123");
  });

  it("plays a file action through the local file path", async () => {
    await routeLaunchAction({ type: "file", path: "C:\\Music\\a.mp3" });
    expect(hoisted.dropPaths).toHaveBeenCalledWith(["C:\\Music\\a.mp3"]);
    expect(useNavigation.getState().view).toEqual({ name: "home" });
  });

  it("opens a playlist action in the YouTube playlist view", async () => {
    await routeLaunchAction({ type: "playlist", id: "PL123" });
    expect(useNavigation.getState().view).toEqual({ name: "ytplaylist", param: "VLPL123" });
    expect(hoisted.dropPaths).not.toHaveBeenCalled();
  });

  it("takes pending actions on start and routes each one", async () => {
    hoisted.take.mockResolvedValue([
      { type: "file", path: "C:\\a.mp3" },
      { type: "playlist", id: "PL9" },
    ]);
    const stop = startLaunchActions();
    await flush();
    expect(hoisted.dropPaths).toHaveBeenCalledWith(["C:\\a.mp3"]);
    expect(useNavigation.getState().view).toEqual({ name: "ytplaylist", param: "VLPL9" });
    stop();
  });

  it("takes pending actions again when the app is poked", async () => {
    const stop = startLaunchActions();
    await flush();
    expect(hoisted.take).toHaveBeenCalledTimes(1);
    hoisted.take.mockResolvedValue([{ type: "file", path: "C:\\b.flac" }]);
    const onPending = hoisted.listen.mock.calls[0][0] as () => void;
    onPending();
    await flush();
    expect(hoisted.dropPaths).toHaveBeenCalledWith(["C:\\b.flac"]);
    stop();
  });

  it("unlistens when stopped", async () => {
    const stop = startLaunchActions();
    await flush();
    stop();
    await flush();
    expect(hoisted.unlisten).toHaveBeenCalledTimes(1);
    expect(hoisted.unlistenDeepLink).toHaveBeenCalledTimes(1);
  });

  it("unlistens at once when stopped before the listener is ready", async () => {
    let resolveListen: (unlisten: () => void) => void = () => {};
    hoisted.listen.mockReturnValue(new Promise((resolve) => (resolveListen = resolve)));
    const stop = startLaunchActions();
    stop();
    resolveListen(hoisted.unlisten);
    await flush();
    expect(hoisted.unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("launch targets", () => {
  it("opens a shared playlist", async () => {
    await routeLaunchTarget({ kind: "playlist", id: "PL9" });
    expect(useNavigation.getState().view).toEqual({ name: "ytplaylist", param: "VLPL9" });
    expect(hoisted.playTrack).not.toHaveBeenCalled();
  });

  it("plays a shared video", async () => {
    await routeLaunchTarget({ kind: "video", id: "dQw4w9WgXcQ" });
    expect(hoisted.playTrack).toHaveBeenCalledWith(expect.objectContaining({ id: "dQw4w9WgXcQ", thumb: null }));
  });

  it("starts an opened audio file on Android at once through the native queue", async () => {
    hoisted.platform = "android";
    const uri = "content://media/external/audio/media/42";
    await routeLaunchTarget({ kind: "file", uri });
    expect(hoisted.playerSetQueue).toHaveBeenCalledWith(
      [expect.objectContaining({ id: uri, contentUri: uri, url: "", expiresAtEpochMs: null })],
      0,
      0,
    );
    expect(hoisted.playerPlay).toHaveBeenCalledTimes(1);
    expect(hoisted.dropPaths).not.toHaveBeenCalled();
  });

  it("defers file launch on iOS with a warning, leaving dropPaths untouched", async () => {
    hoisted.platform = "ios";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await routeLaunchTarget({ kind: "file", uri: "file:///var/mobile/Containers/Data/Music/track.m4a" });
    expect(hoisted.dropPaths).not.toHaveBeenCalled();
    expect(hoisted.playerSetQueue).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("file launch routing on iOS is deferred pending physical device verification"),
    );
    warnSpy.mockRestore();
  });
});

describe("launchActionForUrl", () => {
  it("parses valid hushio custom scheme playlist links", () => {
    expect(launchActionForUrl("hushio://playlist?list=PL123")).toEqual({
      type: "playlist",
      id: "PL123",
    });
    expect(launchActionForUrl("hushio://playlist?list=PL_abc-123&index=1")).toEqual({
      type: "playlist",
      id: "PL_abc-123",
    });
  });

  it("rejects unknown or invalid hushio links", () => {
    expect(launchActionForUrl("hushio://unknown?id=123")).toBeNull();
    expect(launchActionForUrl("hushio://playlist")).toBeNull();
    expect(launchActionForUrl("not-a-url")).toBeNull();
  });

  it("parses file URLs into file launch actions", () => {
    expect(launchActionForUrl("file:///var/mobile/song.mp3")).toEqual({
      type: "file",
      path: "/var/mobile/song.mp3",
    });
  });

  it("parses posix absolute paths on non-windows platforms", () => {
    hoisted.platform = "ios";
    expect(launchActionForUrl("/var/mobile/Containers/song.flac")).toEqual({
      type: "file",
      path: "/var/mobile/Containers/song.flac",
    });
  });
});

describe("startLaunchActions on iOS and desktop deep links", () => {
  it("registers listeners for both launch pending and deep-link new-url events", () => {
    hoisted.platform = "ios";
    const stop = startLaunchActions();
    expect(hoisted.listen).toHaveBeenCalled();
    expect(hoisted.listenDeepLink).toHaveBeenCalledWith("deep-link://new-url", expect.any(Function));
    stop();
  });

  it("routes incoming deep-link events from Tauri plugin", async () => {
    hoisted.platform = "ios";
    const stop = startLaunchActions();
    await flush();

    const onDeepLink = hoisted.listenDeepLink.mock.calls.find(
      (call: unknown[]) => call[0] === "deep-link://new-url",
    )?.[1] as (event: { payload: string[] }) => void;

    expect(onDeepLink).toBeDefined();
    onDeepLink({ payload: ["hushio://playlist?list=PL_ios_launch"] });
    await flush();

    expect(useNavigation.getState().view).toEqual({
      name: "ytplaylist",
      param: "VLPL_ios_launch",
    });
    stop();
  });

  it("handles single string payload from deep link event", async () => {
    hoisted.platform = "ios";
    const stop = startLaunchActions();
    await flush();

    const onDeepLink = hoisted.listenDeepLink.mock.calls.find(
      (call: unknown[]) => call[0] === "deep-link://new-url",
    )?.[1] as (event: { payload: string }) => void;

    onDeepLink({ payload: "hushio://playlist?list=PL_single_string" });
    await flush();

    expect(useNavigation.getState().view).toEqual({
      name: "ytplaylist",
      param: "VLPL_single_string",
    });
    stop();
  });
});

describe("startLaunchActions on Android", () => {
  beforeEach(() => {
    hoisted.platform = "android";
  });

  it("takes a pending launch when it starts and plays it", async () => {
    hoisted.playerTakeLaunch.mockResolvedValueOnce({ kind: "text", value: "https://youtu.be/dQw4w9WgXcQ" });
    const stop = startLaunchActions();
    await vi.waitFor(() => expect(hoisted.playTrack).toHaveBeenCalledTimes(1));
    stop();
  });

  it("does nothing when no launch is pending", async () => {
    const stop = startLaunchActions();
    await vi.waitFor(() => expect(hoisted.playerTakeLaunch).toHaveBeenCalled());
    expect(hoisted.playTrack).not.toHaveBeenCalled();
    expect(hoisted.playerSetQueue).not.toHaveBeenCalled();
    stop();
  });

  it("listens for the launch event", () => {
    startLaunchActions();
    expect(hoisted.listenPlayerEvent).toHaveBeenCalledWith("launch-intent", expect.any(Function));
    expect(hoisted.listen).not.toHaveBeenCalled();
  });
});
