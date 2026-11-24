import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const { audio, seekTo, getPlaybackPosition } = vi.hoisted(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  }
  return {
    audio: new Audio(),
    seekTo: vi.fn(),
    getPlaybackPosition: vi.fn(() => 0),
  };
});

vi.mock("../lib/audio", () => ({
  audio,
  playStream: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seekTo,
  setVolume: vi.fn(),
  setMuted: vi.fn(),
  getPlaybackPosition,
  TEST_SONG_ID: "test-song-id",
  TEST_SONG_TITLE: "Test song",
}));

vi.mock("../lib/persist", () => ({
  persistStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

import { SyncedLyrics } from "./SyncedLyrics";
import { LYRICS_LOADING_LINES } from "../lib/lyricsPhrases";
import type { LyricsResult, SyncedLyricLine } from "../lib/bridge";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";

const SETTINGS_DEFAULTS = {
  syncedLyrics: true,
  blurUnfocusedLyrics: true,
  romanizeLyrics: false,
  reduceAnimation: false,
  reduceDynamicBlur: false,
  lyricsOffset: 0,
};

function lyricsWith(synced: SyncedLyricLine[] | null, extra: Partial<LyricsResult> = {}): LyricsResult {
  return { synced, plain: null, source: "Test Source", wordSynced: false, ...extra };
}

const FOUR_LINES = [
  { time: 1, text: "First line" },
  { time: 2, text: "Second line" },
  { time: 3, text: "Third line" },
  { time: 4, text: "Fourth line" },
];

const SIX_LINES = [
  { time: 1, text: "One" },
  { time: 2, text: "Two" },
  { time: 3, text: "Three" },
  { time: 4, text: "Four" },
  { time: 5, text: "Five" },
  { time: 6, text: "Six" },
];

let frames: FrameRequestCallback[] = [];

function flushFrames(now: number) {
  const pending = frames.splice(0);
  for (const callback of pending) callback(now);
}

function firePointer(type: string, target: Element, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1 });
  fireEvent(target, event);
}

function rect(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

function scrollerOf(container: HTMLElement) {
  return container.querySelector<HTMLDivElement>(".no-scrollbar.absolute")!;
}

function lineButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-line]"));
}

describe("SyncedLyrics", () => {
  beforeEach(() => {
    usePlayer.setState({ position: 0, playing: false });
    useSettings.setState(SETTINGS_DEFAULTS);
    seekTo.mockClear();
    getPlaybackPosition.mockReturnValue(0);
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a loading phrase only after the 300 ms delay", () => {
    vi.useFakeTimers();
    const { container } = render(<SyncedLyrics lyrics={null} loading trackKey="track-1" />);
    expect(container.querySelector("p")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const phrase = container.querySelector("p")?.textContent ?? "";
    expect(LYRICS_LOADING_LINES).toContain(phrase);
  });

  it("shows the not-found text when there is no lyric text", () => {
    render(<SyncedLyrics lyrics={null} loading={false} />);
    expect(screen.getByText("No lyrics available for this track.")).toBeTruthy();
  });

  it("treats a result of only gap markers as not found", () => {
    render(<SyncedLyrics lyrics={lyricsWith([{ time: 1, text: "", gap: true }])} loading={false} />);
    expect(screen.getByText("No lyrics available for this track.")).toBeTruthy();
  });

  it("shows plain text when synced lyrics are off", () => {
    useSettings.setState({ syncedLyrics: false });
    render(
      <SyncedLyrics
        lyrics={lyricsWith(FOUR_LINES, { plain: "Plain words\nsecond plain line" })}
        loading={false}
      />,
    );
    expect(screen.getByText(/Plain words/).textContent).toContain("second plain line");
    expect(screen.queryAllByRole("button", { name: "Jump here" })).toHaveLength(0);
    expect(screen.getByText("Lyrics from Test Source")).toBeTruthy();
  });

  it("renders one button per visible line and highlights the active one", () => {
    usePlayer.setState({ position: 2.2 });
    render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} />);
    const buttons = lineButtons();
    expect(buttons).toHaveLength(4);
    expect(buttons[1].className).toContain("text-ink-1");
    expect(buttons[0].className).toContain("text-ink-2");
    expect(buttons[2].className).toContain("text-ink-2");
    expect(buttons[3].className).toContain("text-ink-2");
    expect(buttons[2].style.filter).toBe("");
    expect(buttons[1].getAttribute("aria-current")).toBe("true");
    expect(buttons[0].getAttribute("aria-current")).toBeNull();
    expect(buttons[1].getAttribute("title")).toBeNull();
  });

  it("keeps every line at full opacity and steps the ink by distance", () => {
    usePlayer.setState({ position: 0.2 });
    render(<SyncedLyrics lyrics={lyricsWith(SIX_LINES)} loading={false} />);
    const buttons = lineButtons();
    for (const button of buttons) expect(button.style.opacity).toBe("1");
    expect(buttons[0].className).toContain("text-ink-1");
    expect(buttons[1].className).toContain("text-ink-2");
    expect(buttons[2].className).toContain("text-ink-2");
    expect(buttons[3].className).toContain("text-ink-3");
    expect(buttons[5].className).toContain("text-ink-3");
  });

  it("uses line 0 as the reference before the first timestamp", () => {
    usePlayer.setState({ position: 0 });
    render(<SyncedLyrics lyrics={lyricsWith([{ time: 5, text: "Late one" }, ...FOUR_LINES])} loading={false} />);
    const buttons = lineButtons();
    expect(buttons[0].className).toContain("text-ink-1");
    expect(buttons[1].className).toContain("text-ink-2");
    expect(buttons[0].style.opacity).toBe("1");
    expect(buttons[1].style.opacity).toBe("1");
  });

  it("shows no blur while paused", () => {
    usePlayer.setState({ position: 3.2, playing: false });
    render(<SyncedLyrics lyrics={lyricsWith(SIX_LINES)} loading={false} />);
    expect(lineButtons().some((button) => button.style.filter.includes("blur"))).toBe(false);
  });

  it("uses the 0.35 s lookahead to pick the active line", () => {
    usePlayer.setState({ position: 0.7 });
    render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} />);
    expect(Number(lineButtons()[0].style.opacity)).toBeCloseTo(1, 5);
  });

  it("seeks to the line time less the 0.15 s lead-in", () => {
    render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} />);
    fireEvent.click(lineButtons()[1]);
    expect(seekTo.mock.calls.at(-1)?.[0]).toBeCloseTo(1.85, 5);
  });

  it("adds the offset to the seek target", () => {
    render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} offset={0.5} />);
    fireEvent.click(lineButtons()[1]);
    expect(seekTo.mock.calls.at(-1)?.[0]).toBeCloseTo(2.35, 5);
  });

  it("hides opening credit lines and keeps the sung lines", () => {
    render(
      <SyncedLyrics
        lyrics={lyricsWith([
          { time: 0, text: "Lyrics by: Writer" },
          { time: 1, text: "Opening words" },
        ])}
        loading={false}
      />,
    );
    const buttons = lineButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("Opening words");
  });

  it("renders a bracketed section label as a heading", () => {
    render(<SyncedLyrics lyrics={lyricsWith([...FOUR_LINES, { time: 5, text: "[Chorus]" }])} loading={false} />);
    expect(screen.getByRole("heading", { name: "Chorus" })).toBeTruthy();
    expect(lineButtons()).toHaveLength(4);
  });

  it("shows an instrumental gap marker", () => {
    render(<SyncedLyrics lyrics={lyricsWith([{ time: 1, text: "", gap: true }, ...FOUR_LINES])} loading={false} />);
    expect(screen.getByRole("img", { name: "Instrumental" })).toBeTruthy();
  });

  it("adds a romanized reading when the setting is on", () => {
    useSettings.setState({ romanizeLyrics: true });
    render(<SyncedLyrics lyrics={lyricsWith([{ time: 1, text: "안녕하세요" }])} loading={false} />);
    expect(screen.getByText("annyeonghaseyo")).toBeTruthy();
  });

  it("leaves the romanized reading out when the setting is off", () => {
    render(<SyncedLyrics lyrics={lyricsWith([{ time: 1, text: "안녕하세요" }])} loading={false} />);
    expect(screen.queryByText("annyeonghaseyo")).toBeNull();
  });

  it("moves focus between lines with the arrow keys", () => {
    render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} />);
    const buttons = lineButtons();
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("highlights words of the active line when word timing is present", () => {
    usePlayer.setState({ position: 1.2 });
    const words = [
      { start: 1, end: 1.5, text: "Hello" },
      { start: 1.5, end: 2, text: "world" },
    ];
    const { container } = render(
      <SyncedLyrics lyrics={lyricsWith([{ time: 1, text: "Hello world", words, end: 2 }])} loading={false} />,
    );
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(container.querySelector('[style*="linear-gradient"]')).not.toBeNull();
  });

  it("jumps the scroll position at once when reduce motion is on", () => {
    useSettings.setState({ reduceAnimation: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-line")) {
        const index = Array.from(this.parentElement!.children).indexOf(this);
        return rect(100 + index * 100, 40);
      }
      return rect(0, 400);
    });
    const { container } = render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} />);
    const scroller = scrollerOf(container);
    Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });

    act(() => {
      usePlayer.setState({ position: 2.2 });
    });
    act(() => flushFrames(0));

    expect(scroller.scrollTop).toBe(20);
  });

  it("glides to the active line on a quartic ease-out curve", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-line")) {
        const index = Array.from(this.parentElement!.children).indexOf(this);
        return rect(100 + index * 100, 40);
      }
      return rect(0, 400);
    });
    const { container } = render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} />);
    const scroller = scrollerOf(container);
    Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });

    act(() => {
      usePlayer.setState({ position: 2.2 });
    });
    act(() => flushFrames(1000));
    act(() => flushFrames(1300));
    expect(scroller.scrollTop).toBeCloseTo(20 * (1 - 0.5 ** 4), 5);
    act(() => flushFrames(1600));
    expect(scroller.scrollTop).toBeCloseTo(20, 5);
  });

  it("turns off the depth transition when reduce motion is on", () => {
    useSettings.setState({ reduceAnimation: true });
    render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} />);
    expect(lineButtons()[0].style.transition).toBe("none");
  });

  it("steps the blur by distance while playing, capped at 2 px: none near the active line, 1.5 px, then 2 px", () => {
    render(<SyncedLyrics lyrics={lyricsWith(SIX_LINES)} loading={false} />);
    act(() => {
      usePlayer.setState({ position: 3.2, playing: true });
    });
    const filters = lineButtons().map((button) => button.style.filter);
    expect(filters[0]).toBe("blur(1.5px)");
    expect(filters[1]).toBe("");
    expect(filters[2]).toContain("drop-shadow");
    expect(filters[2]).not.toContain("blur");
    expect(filters[3]).toBe("");
    expect(filters[4]).toBe("blur(1.5px)");
    expect(filters[5]).toBe("blur(2px)");
  });

  it("shows no blur under reduce motion or reduce transparency", () => {
    useSettings.setState({ reduceDynamicBlur: true });
    const first = render(<SyncedLyrics lyrics={lyricsWith(SIX_LINES)} loading={false} />);
    act(() => {
      usePlayer.setState({ position: 3.2 });
    });
    expect(lineButtons().some((button) => button.style.filter.includes("blur"))).toBe(false);
    first.unmount();

    useSettings.setState({ reduceDynamicBlur: false, reduceAnimation: true });
    render(<SyncedLyrics lyrics={lyricsWith(SIX_LINES)} loading={false} />);
    expect(lineButtons().some((button) => button.style.filter.includes("blur"))).toBe(false);
  });

  it("clears focus mode while the list is scrolled by hand and restores it 3 s after the last scroll", () => {
    vi.useFakeTimers();
    const { container } = render(<SyncedLyrics lyrics={lyricsWith(SIX_LINES)} loading={false} />);
    act(() => {
      usePlayer.setState({ position: 3.2, playing: true });
    });
    expect(lineButtons()[5].style.filter).toBe("blur(2px)");

    fireEvent.wheel(scrollerOf(container));
    expect(lineButtons()[5].style.filter).toBe("");
    expect(lineButtons()[5].style.opacity).toBe("1");
    expect(lineButtons()[0].style.opacity).toBe("1");

    act(() => {
      vi.advanceTimersByTime(2900);
    });
    fireEvent.wheel(scrollerOf(container));
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(lineButtons()[5].style.filter).toBe("");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(lineButtons()[5].style.filter).toBe("blur(2px)");
  });

  it("restores focus mode at once when a line is clicked", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const { container } = render(<SyncedLyrics lyrics={lyricsWith(SIX_LINES)} loading={false} />);
    act(() => {
      usePlayer.setState({ position: 3.2, playing: true });
    });
    fireEvent.touchMove(scrollerOf(container));
    expect(lineButtons()[5].style.filter).toBe("");
    now.mockReturnValue(1300);
    fireEvent.click(lineButtons()[5]);
    expect(lineButtons()[2].style.filter).toBe("blur(2px)");
  });

  it("seeks on a plain click with the pointer still", () => {
    const { container } = render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} />);
    firePointer("pointerdown", scrollerOf(container), 10, 10);
    firePointer("pointerup", scrollerOf(container), 10, 10);
    fireEvent.click(lineButtons()[1]);
    expect(seekTo.mock.calls.at(-1)?.[0]).toBeCloseTo(1.85, 5);
  });

  it("does not seek when a drag over the lyrics is released on a line", () => {
    const { container } = render(<SyncedLyrics lyrics={lyricsWith(SIX_LINES)} loading={false} />);
    firePointer("pointerdown", scrollerOf(container), 10, 100);
    firePointer("pointermove", scrollerOf(container), 10, 180);
    firePointer("pointerup", scrollerOf(container), 10, 180);
    fireEvent.click(lineButtons()[2]);
    expect(seekTo).not.toHaveBeenCalled();
  });

  it("does not seek when the pointer moved more than 5 px before release", () => {
    const { container } = render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} />);
    firePointer("pointerdown", scrollerOf(container), 10, 10);
    firePointer("pointerup", scrollerOf(container), 10, 16);
    fireEvent.click(lineButtons()[1]);
    expect(seekTo).not.toHaveBeenCalled();
  });

  it("keeps lyrics to vertical scrolling: clipped sideways and pan-y touch only", () => {
    const { container } = render(<SyncedLyrics lyrics={lyricsWith(SIX_LINES)} loading={false} />);
    const scroller = scrollerOf(container);
    expect(scroller.className).toContain("overflow-x-hidden");
    expect(scroller.className).toContain("touch-pan-y");
    firePointer("pointerdown", scroller, 10, 100);
    firePointer("pointermove", scroller, 120, 100);
    firePointer("pointerup", scroller, 120, 100);
    expect(scroller.scrollLeft).toBe(0);
    for (const line of lineButtons()) expect(line.style.transform).not.toContain("translate");
  });

  it("ignores a line click within 250 ms of a manual scroll", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const { container } = render(<SyncedLyrics lyrics={lyricsWith(FOUR_LINES)} loading={false} />);
    fireEvent.wheel(scrollerOf(container));
    now.mockReturnValue(1200);
    fireEvent.click(lineButtons()[1]);
    expect(seekTo).not.toHaveBeenCalled();
    now.mockReturnValue(1300);
    fireEvent.click(lineButtons()[1]);
    expect(seekTo.mock.calls.at(-1)?.[0]).toBeCloseTo(1.85, 5);
  });

  it("does not leave focus mode for a plain tap on the list", () => {
    const { container } = render(<SyncedLyrics lyrics={lyricsWith(SIX_LINES)} loading={false} />);
    act(() => {
      usePlayer.setState({ position: 3.2, playing: true });
    });
    firePointer("pointerdown", scrollerOf(container), 10, 10);
    firePointer("pointerup", scrollerOf(container), 10, 10);
    expect(lineButtons()[5].style.filter).toBe("blur(2px)");
  });
});
