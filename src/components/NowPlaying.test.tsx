import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ListPlus } from "@phosphor-icons/react";

const { lyricsGet, setFullScreen, platformState, watchWindowMaximized } = vi.hoisted(() => ({
  lyricsGet: vi.fn(),
  setFullScreen: vi.fn(),
  platformState: { value: "windows" as "windows" | "macos" | "linux" | "android" | "ios" },
  watchWindowMaximized: vi.fn(async () => () => {}),
}));

vi.mock("../lib/audio", () => ({
  audio: new Audio(),
  playStream: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seekTo: vi.fn(),
  setVolume: vi.fn(),
  setMuted: vi.fn(),
  getPlaybackPosition: vi.fn(() => 0),
  TEST_SONG_ID: "test-song-id",
  TEST_SONG_TITLE: "Test song",
}));

vi.mock("../lib/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/bridge")>()),
  lyricsGet,
  setFullScreen,
  watchWindowMaximized,
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  closeWindow: vi.fn(),
  get platform() {
    return platformState.value;
  },
}));

vi.mock("../lib/persist", () => ({
  persistStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

import { NowPlaying } from "./NowPlaying";
import { canvasClipFor, rememberCanvasClip } from "../lib/canvas";
import { useLibrary } from "../stores/library";
import { useLyricsNudge } from "../stores/lyricsNudge";
import { useNavigation } from "../stores/navigation";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";

let seq = 0;
let track = { id: "np-0", title: "Blue Song", artist: "The Band", thumb: null as string | null };

function setTrack(current: typeof track | null, playing = false) {
  usePlayer.setState({ queue: current ? [current] : [], index: 0, position: 0, duration: 0, playing });
}

function openView() {
  act(() => {
    useUI.setState({ nowPlayingOpen: true });
  });
}

function region() {
  return screen.queryByRole("dialog", { name: "Now Playing" });
}

describe("NowPlaying", () => {
  beforeEach(() => {
    cleanup();
    seq += 1;
    track = { id: `np-${seq}`, title: "Blue Song", artist: "The Band", thumb: null };
    platformState.value = "windows";
    lyricsGet.mockReset();
    lyricsGet.mockResolvedValue(null);
    setFullScreen.mockReset();
    setFullScreen.mockResolvedValue(undefined);
    useLyricsNudge.setState({ nudges: {} });
    useLibrary.setState({ liked: [] });
    useSettings.setState({ lyricsOffset: 0, animatedCovers: false, fullBleedArtwork: true });
    useUI.setState({ nowPlayingOpen: false, lyricsCenter: false, osFullscreen: false, contextMenu: null, dialog: null, playlistPicker: null });
    setTrack(track);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders nothing while closed", () => {
    render(<NowPlaying />);
    expect(region()).toBeNull();
    expect(setFullScreen).not.toHaveBeenCalled();
  });

  it("keeps the close control below the roll strip", () => {
    render(<NowPlaying />);
    openView();
    const close = screen.getByRole("button", { name: "Close Now Playing" });
    expect(region()?.contains(close)).toBe(true);
    expect(region()?.style.paddingTop).toBe("84px");
    expect(screen.getByRole("button", { name: "Hide Now Playing" })).toBeTruthy();
  });

  it("opens with the track, the Esc hint and a request for full screen", () => {
    render(<NowPlaying />);
    openView();
    expect(region()).not.toBeNull();
    expect(screen.getByText("Blue Song")).toBeTruthy();
    expect(screen.getByText("The Band")).toBeTruthy();
    expect(screen.getByText("To exit full screen, press")).toBeTruthy();
    expect(setFullScreen).toHaveBeenLastCalledWith(true);
  });

  it("closes from the close button and leaves the full screen it entered", async () => {
    render(<NowPlaying />);
    openView();
    fireEvent.click(screen.getByRole("button", { name: "Close Now Playing" }));
    expect(useUI.getState().nowPlayingOpen).toBe(false);
    await waitFor(() => expect(region()).toBeNull());
    expect(setFullScreen).toHaveBeenLastCalledWith(false);
  });

  it("stays in full screen when the window was already full screen", async () => {
    useUI.setState({ osFullscreen: true });
    render(<NowPlaying />);
    openView();
    fireEvent.click(screen.getByRole("button", { name: "Close Now Playing" }));
    await waitFor(() => expect(region()).toBeNull());
    expect(setFullScreen).not.toHaveBeenCalledWith(false);
  });

  it("shows the empty state when nothing is playing", () => {
    setTrack(null);
    render(<NowPlaying />);
    openView();
    expect(screen.getByText("Nothing playing yet")).toBeTruthy();
    expect(screen.getByText("Play something and it will show up here.")).toBeTruthy();
  });

  it("swaps the cover for its looping clip only while animated covers are on", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    rememberCanvasClip(track.id, { url: "blob:clip" });
    const { container } = render(<NowPlaying />);
    openView();
    expect(container.querySelector("video")).toBeNull();

    act(() => {
      useSettings.setState({ animatedCovers: true });
    });
    expect(container.querySelector("video")?.getAttribute("src")).toBe("blob:clip");
    expect(canvasClipFor(track.id)).toEqual({ url: "blob:clip" });
  });

  it("switches the side panel between lyrics and queue", () => {
    render(<NowPlaying />);
    openView();
    const group = within(screen.getByRole("group", { name: "Now Playing panel" }));
    expect(group.getByRole("button", { name: "Lyrics" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(group.getByRole("button", { name: "Queue" }));
    expect(group.getByRole("button", { name: "Queue" }).getAttribute("aria-pressed")).toBe("true");
    expect(group.getByRole("button", { name: "Lyrics" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("gives the Lyrics/Queue control squircle corners", () => {
    render(<NowPlaying />);
    openView();
    const group = screen.getByRole("group", { name: "Now Playing panel" });
    expect(group.className).toContain("[corner-shape:squircle]");
    expect(group.className).toContain("rounded-[12px]");
    expect(within(group).getByRole("button", { name: "Lyrics" }).className).toContain("[corner-shape:squircle]");
  });

  it("hides the chrome after three seconds of playback and shows it again on pointer movement", () => {
    vi.useFakeTimers();
    setTrack(track, true);
    render(<NowPlaying />);
    openView();
    const section = region();
    expect(section?.getAttribute("data-idle")).toBe("false");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(section?.getAttribute("data-idle")).toBe("true");

    fireEvent(window, new Event("pointermove"));
    expect(section?.getAttribute("data-idle")).toBe("false");
  });

  it("keeps the chrome while nothing is playing", () => {
    vi.useFakeTimers();
    render(<NowPlaying />);
    openView();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(region()?.getAttribute("data-idle")).toBe("false");
  });

  it("nudges the song's lyrics with the bracket keys while open", () => {
    render(<NowPlaying />);
    openView();
    fireEvent.keyDown(window, { code: "BracketRight" });
    expect(useLyricsNudge.getState().nudges[track.id]).toBe(0.25);
    fireEvent.keyDown(window, { code: "BracketLeft" });
    fireEvent.keyDown(window, { code: "BracketLeft" });
    expect(useLyricsNudge.getState().nudges[track.id]).toBe(-0.25);
  });

  it("leaves the bracket keys to the lyrics centre while it is open", () => {
    useUI.setState({ lyricsCenter: true });
    render(<NowPlaying />);
    openView();
    fireEvent.keyDown(window, { code: "BracketRight" });
    expect(useLyricsNudge.getState().nudges).toEqual({});
  });

  it("puts the Add to Library heart in the transport row and drops the pill", () => {
    render(<NowPlaying />);
    openView();
    expect(screen.queryByText("In Your Library")).toBeNull();
    const controls = within(screen.getByRole("group", { name: "Transport" }));
    const heart = controls.getByRole("button", { name: "Add to Library" });
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(heart);
    expect(useLibrary.getState().liked.map((item) => item.id)).toEqual([track.id]);
    const liked = within(screen.getByRole("group", { name: "Transport" })).getByRole("button", { name: "Add to Library" });
    expect(liked.getAttribute("aria-pressed")).toBe("true");
    expect(liked.getAttribute("aria-label")).toBe("Add to Library");
    expect(liked.className).toContain("[&_path]:fill-current");
  });

  it("keeps a static accessible label for the heart toggle button to avoid contradictory VoiceOver announcements", () => {
    render(<NowPlaying />);
    openView();
    const controls = within(screen.getByRole("group", { name: "Transport" }));
    const heart = controls.getByRole("button", { name: "Add to Library" });
    expect(heart.getAttribute("aria-label")).toBe("Add to Library");
    expect(heart.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(heart);
    expect(heart.getAttribute("aria-label")).toBe("Add to Library");
    expect(heart.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(heart);
    expect(heart.getAttribute("aria-label")).toBe("Add to Library");
    expect(heart.getAttribute("aria-pressed")).toBe("false");
  });

  it("hides dead Cast control on iOS while keeping it on Android", () => {
    platformState.value = "ios";
    const { unmount } = render(<NowPlaying />);
    openView();
    expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
    unmount();

    platformState.value = "android";
    render(<NowPlaying />);
    openView();
    expect(screen.getByRole("button", { name: "Cast" })).toBeTruthy();
  });

  it("gives the exit chevron the 40px squircle shape of the search and tabs", () => {
    render(<NowPlaying />);
    openView();
    const exit = screen.getByRole("button", { name: "Close Now Playing" });
    expect(exit.className).toContain("h-10");
    expect(exit.className).toContain("rounded-[12px]");
    expect(exit.className).toContain("[corner-shape:squircle]");
    expect(exit.className).toContain("hover:bg-art/[0.12]");
    expect(exit.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search" }).className).toContain("h-10");
  });

  it("gives the caption buttons 40px squircle hovers, no gaps and 16px right padding in the strip", () => {
    platformState.value = "windows";
    render(<NowPlaying />);
    openView();
    const minimize = screen.getByRole("button", { name: "Minimize" });
    const header = minimize.closest("header");
    expect(header?.className).toContain("pr-4");
    expect(minimize.parentElement?.className).toContain("gap-0");
    expect(minimize.parentElement?.className).toContain("items-center");
    for (const name of ["Minimize", "Maximise", "Close"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("h-10");
      expect(button.className).toContain("w-10");
      expect(button.className).toContain("rounded-[12px]");
      expect(button.className).toContain("[corner-shape:squircle]");
      expect(button.querySelector("svg")).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "Close" }).className).toContain("hover:bg-[rgb(var(--danger))]");
  });

  it("draws the Add to playlist control with the list-plus icon", () => {
    render(<NowPlaying />);
    openView();
    const add = within(screen.getByRole("group", { name: "Transport" })).getByRole("button", { name: "Add to playlist" });
    const svg = add.querySelector("svg");
    const reference = render(<ListPlus size={20} />).container.querySelector("svg");
    expect(svg?.innerHTML).toBe(reference?.innerHTML);
  });

  it("gives the Lyrics and Queue tabs the same width, height and radius", () => {
    render(<NowPlaying />);
    openView();
    const tabs = within(screen.getByRole("group", { name: "Now Playing panel" })).getAllByRole("button");
    expect(tabs).toHaveLength(2);
    const shape = (tab: HTMLElement) => tab.className.split(" ").filter((name) => !/^(bg-|text-|hover:)/.test(name)).join(" ");
    expect(shape(tabs[0])).toBe(shape(tabs[1]));
    for (const tab of tabs) {
      expect(tab.className).toContain("w-24");
      expect(tab.className).toContain("h-8");
      expect(tab.className).toContain("rounded-[8px]");
    }
  });

  it("centres the Lyrics/Queue switch in the top strip", () => {
    render(<NowPlaying />);
    openView();
    const group = screen.getByRole("group", { name: "Now Playing panel" });
    const header = group.closest("header");
    const unit = group.parentElement;
    const centreCell = unit?.parentElement;
    expect(header?.className).toContain("h-14");
    expect(header?.className).toContain("grid-cols-[1fr_auto_1fr]");
    expect(header?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(centreCell?.parentElement).toBe(header);
    expect(centreCell?.className).toContain("justify-center");
    expect(unit?.className).toContain("gap-3");
    const search = screen.getByRole("searchbox", { name: "Search" });
    expect(group.nextElementSibling?.contains(search)).toBe(true);
    expect(group.nextElementSibling?.parentElement).toBe(unit);
  });

  it("shows the caption buttons on Windows", () => {
    platformState.value = "windows";
    render(<NowPlaying />);
    openView();
    expect(screen.getByRole("button", { name: "Minimize" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("shows the caption buttons on Linux", () => {
    platformState.value = "linux";
    render(<NowPlaying />);
    openView();
    expect(screen.getByRole("button", { name: "Minimize" })).toBeTruthy();
  });

  it("omits the caption buttons on macOS", () => {
    platformState.value = "macos";
    render(<NowPlaying />);
    openView();
    expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close Now Playing" })).toBeTruthy();
  });

  it("renders the ambient backdrop behind a transparent root", () => {
    useSettings.setState({ movingBackground: false });
    render(<NowPlaying />);
    openView();
    const section = region();
    const backdrop = section?.querySelector("[data-ambient-backdrop]");
    expect(backdrop).not.toBeNull();
    expect(section?.firstElementChild).toBe(backdrop);
    expect(section?.className).not.toContain("bg-surface");
  });

  it("shows a flat cover-colour backdrop even when the old moving setting is on", () => {
    useSettings.setState({ movingBackground: true });
    render(<NowPlaying />);
    openView();
    const section = region();
    expect(section?.querySelector("canvas")).toBeNull();
    expect(section?.querySelector("[data-ambient-backdrop]")).not.toBeNull();
  });

  it("renders no bottom player strip in Now Playing", () => {
    render(<NowPlaying />);
    openView();
    expect(screen.queryByLabelText("Player")).toBeNull();
  });

  it("lays the transport row as seven justified items the width of the timeline with play centred", () => {
    render(<NowPlaying />);
    openView();
    const row = screen.getByRole("group", { name: "Transport" });
    expect(row.children).toHaveLength(7);
    expect(row.className).toContain("justify-between");
    expect(row.className).toContain("w-full");
    const timeline = screen.getByRole("slider", { name: "Seek" }).closest(".mt-5");
    expect(timeline?.classList.contains("w-full")).toBe(true);
    const heart = within(row).getByRole("button", { name: "Add to Library" });
    const add = within(row).getByRole("button", { name: "Add to playlist" });
    const play = within(row).getByRole("button", { name: /^(Play|Pause)$/ });
    expect(row.firstElementChild?.contains(heart)).toBe(true);
    expect(row.lastElementChild?.contains(add)).toBe(true);
    expect(row.children[3].contains(play)).toBe(true);
    expect(play.className).toContain("h-16 w-16");
    expect(row.firstElementChild?.className).toContain("-ml-[10px]");
    expect(row.lastElementChild?.className).toContain("-mr-[10px]");
  });

  it("puts a full-width volume row with a mute icon left and a full-volume icon right", () => {
    usePlayer.setState({ volume: 0.5, muted: false });
    render(<NowPlaying />);
    openView();
    const row = screen.getByRole("group", { name: "Volume" });
    expect(row.className).toContain("w-full");
    const mute = within(row).getByRole("button", { name: "Mute" });
    const full = within(row).getByRole("button", { name: "Full volume" });
    const slider = within(row).getByRole("slider", { name: "Volume" });
    expect(mute.className).toContain("-ml-[10px]");
    expect(full.className).toContain("-mr-[10px]");
    expect(mute.compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slider.compareDocumentPosition(full) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(mute);
    expect(usePlayer.getState().muted).toBe(true);
    fireEvent.click(within(row).getByRole("button", { name: "Unmute" }));
    fireEvent.click(full);
    expect(usePlayer.getState().volume).toBe(1);
    expect(usePlayer.getState().muted).toBe(false);
  });

  it("steps the volume slider with the arrow keys", () => {
    usePlayer.setState({ volume: 0.5, muted: false });
    render(<NowPlaying />);
    openView();
    const controls = within(screen.getByRole("group", { name: "Volume" }));
    const slider = controls.getByRole("slider", { name: "Volume" });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(usePlayer.getState().volume).toBeCloseTo(0.55);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(usePlayer.getState().volume).toBeCloseTo(0.45);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(usePlayer.getState().volume).toBeCloseTo(0.5);
  });

  it("searches from the top strip on Enter and closes Now Playing", () => {
    render(<NowPlaying />);
    openView();
    const field = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(field, { target: { value: "dua lipa" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useNavigation.getState().view.name).toBe("search");
    expect(useUI.getState().searchQuery).toBe("dua lipa");
    expect(useUI.getState().nowPlayingOpen).toBe(false);
  });

  it("shows only one clear button in the top search when it has text", () => {
    useUI.setState({ searchQuery: "" });
    render(<NowPlaying />);
    openView();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "dua" } });
    expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(1);
  });

  it("draws the lyrics and titles in the on-art ink", async () => {
    lyricsGet.mockResolvedValue({
      synced: [
        { time: 0, text: "Opening line" },
        { time: 5, text: "Second line" },
      ],
      plain: null,
      source: "Test Source",
      wordSynced: false,
    });
    render(<NowPlaying />);
    openView();
    const active = await screen.findByText("Opening line");
    const lineButton = active.closest("button[data-line]");
    expect(lineButton?.className).toContain("text-art");
    expect(lineButton?.className).not.toContain("text-ink-1");
    const other = screen.getByText("Second line").closest("button[data-line]");
    expect(other?.className).toContain("text-art/[0.45]");
    expect(screen.getByRole("heading", { level: 2, name: "Blue Song" }).className).toContain("text-art");
  });

  it("keeps unavailable lyrics distinct from the queue", async () => {
    usePlayer.setState({
      queue: [track, { id: "np-next", title: "Next Song", artist: "Other", thumb: null }],
      index: 0,
    });
    render(<NowPlaying />);
    openView();
    expect(await screen.findByText("No lyrics for this song")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Up Next" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
    expect(screen.getByRole("heading", { name: "Queue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Next Song/ })).toBeTruthy();
  });

  it("fits the artwork in a square with object-cover", () => {
    track = { ...track, thumb: "https://i.ytimg.com/vi/abc/hqdefault.jpg" };
    setTrack(track);
    render(<NowPlaying />);
    openView();
    const image = region()?.querySelector(".now-playing-artwork img");
    expect(image?.className).toContain("object-cover");
    expect(image?.closest(".now-playing-artwork")).toBeTruthy();
  });

  it("keeps the transport row to exactly seven buttons and no volume slider", () => {
    render(<NowPlaying />);
    openView();
    const row = within(screen.getByRole("group", { name: "Transport" }));
    expect(row.getAllByRole("button")).toHaveLength(7);
    expect(row.queryByRole("slider", { name: "Volume" })).toBeNull();
  });

  it("uses no extrabold weight in Now Playing", async () => {
    lyricsGet.mockResolvedValue({
      synced: [
        { time: 0, text: "Opening line" },
        { time: 5, text: "Second line" },
      ],
      plain: null,
      source: "Test Source",
      wordSynced: false,
    });
    render(<NowPlaying />);
    openView();
    await screen.findByText("Opening line");
    expect(region()?.innerHTML).not.toContain("font-extrabold");
  });

  it("gives only the active lyric semibold weight", async () => {
    lyricsGet.mockResolvedValue({
      synced: [
        { time: 0, text: "Opening line" },
        { time: 5, text: "Second line" },
      ],
      plain: null,
      source: "Test Source",
      wordSynced: false,
    });
    render(<NowPlaying />);
    openView();
    await screen.findByText("Opening line");
    const semibold = Array.from(region()?.querySelectorAll("button[data-line] .font-semibold") ?? []);
    expect(semibold.map((node) => node.textContent)).toEqual(["Opening line"]);
    expect(screen.getByText("Second line").className).toContain("font-medium");
  });

  it("blurs only the lines far from the active one, by at most 1px, and never glows", async () => {
    lyricsGet.mockResolvedValue({
      synced: [
        { time: 0, text: "Opening line" },
        { time: 5, text: "Second line" },
        { time: 10, text: "Third line" },
        { time: 15, text: "Fourth line" },
      ],
      plain: null,
      source: "Test Source",
      wordSynced: false,
    });
    render(<NowPlaying />);
    openView();
    await screen.findByText("Opening line");
    const lines = Array.from(region()?.querySelectorAll<HTMLElement>("button[data-line]") ?? []);
    expect(lines).toHaveLength(4);
    expect(lines[0].style.transform).toBe("scale(1.06)");
    expect(lines[0].style.filter).toBe("");
    expect(lines[2].style.filter).toBe("");
    expect(lines[3].style.filter).toBe("blur(1px)");
    expect(lines[1].style.transform).toBe("");
    expect(region()?.innerHTML).not.toContain("drop-shadow");
  });

  it("fades the lyrics column top and bottom at a fixed reading width", async () => {
    lyricsGet.mockResolvedValue({
      synced: [{ time: 0, text: "Opening line" }],
      plain: null,
      source: "Test Source",
      wordSynced: false,
    });
    render(<NowPlaying />);
    openView();
    const line = await screen.findByText("Opening line");
    const column = line.closest<HTMLElement>("[class*=\"max-w-[720px]\"]");
    expect(column?.className).toContain("pr-16");
    const scroller = line.closest<HTMLElement>("[class*=\"overflow-y-auto\"]");
    expect(scroller?.getAttribute("style")).toContain("12%");
    expect(scroller?.getAttribute("style")).toContain("88%");
  });

  it("keeps a full title with a tooltip and a 16px artist line in the art column", () => {
    render(<NowPlaying />);
    openView();
    const title = screen.getByRole("heading", { level: 2, name: "Blue Song" });
    expect(title.getAttribute("title")).toBe("Blue Song");
    expect(title.firstElementChild?.className).toContain("truncate");
    expect(title.tabIndex).toBe(0);
    expect(screen.getByText("The Band").className).toContain("text-body");
    expect(screen.getByText("The Band").className).toContain("text-art/[0.72]");
  });

  it("gives the lyrics column left and right padding around its reading width", async () => {
    lyricsGet.mockResolvedValue({ synced: [{ time: 0, text: "Opening line" }], plain: null, source: "Test Source", wordSynced: false });
    render(<NowPlaying />);
    openView();
    const line = await screen.findByText("Opening line");
    const column = line.closest<HTMLElement>("[class*=\"max-w-[720px]\"]");
    expect(column?.className).toContain("pl-6");
    expect(column?.className).toContain("pr-16");
  });

  it("puts a seek slider under the title", () => {
    render(<NowPlaying />);
    openView();
    expect(screen.getByRole("slider", { name: "Seek" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Transport" })).toBeTruthy();
  });
});

describe("NowPlaying track change", () => {
  it("shows only the new track title and artist after a switch", async () => {
    lyricsGet.mockReturnValue(Promise.resolve(null));
    const first = { id: "np-shape", title: "Shape of You", artist: "Ed Sheeran", thumb: null as string | null };
    const second = { id: "np-arrest", title: "You're Under Arrest", artist: "ILLIT", thumb: null as string | null };
    setTrack(first, true);
    openView();
    render(<NowPlaying />);
    expect(screen.getByText("Shape of You")).toBeTruthy();
    act(() => {
      setTrack(second, true);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    const scope = region();
    expect(scope).toBeTruthy();
    expect(within(scope as HTMLElement).getByRole("heading", { level: 2, name: "You're Under Arrest" })).toBeTruthy();
    expect(within(scope as HTMLElement).getByRole("heading", { level: 2, name: "You're Under Arrest" })).toBeTruthy();
    expect(screen.queryByText("Shape of You")).toBeNull();
    expect(screen.queryByText("Ed Sheeran")).toBeNull();
    expect(screen.getByText(/illit/i)).toBeTruthy();
  });
});
