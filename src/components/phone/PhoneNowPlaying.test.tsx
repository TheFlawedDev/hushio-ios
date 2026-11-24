import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Track } from "../../types";
import { INSET_TOP } from "../../lib/phoneNav";

if (!("PointerEvent" in window)) {
  Object.defineProperty(window, "PointerEvent", { configurable: true, value: class PointerEvent extends MouseEvent {} });
}

const { audio, playStream, play, pause, seekTo, setVolume, setMuted, getPlaybackPosition } = vi.hoisted(() => ({
  audio: new Audio(),
  playStream: vi.fn(() => Promise.resolve()),
  play: vi.fn(() => Promise.resolve()),
  pause: vi.fn(),
  seekTo: vi.fn(),
  setVolume: vi.fn(),
  setMuted: vi.fn(),
  getPlaybackPosition: vi.fn(() => 0),
}));

vi.mock("../../lib/audio", () => ({ audio, playStream, play, pause, seekTo, setVolume, setMuted, getPlaybackPosition }));
vi.mock("../../lib/lyrics", () => ({ prefetchLyrics: () => {} }));
const { lyricsState, useTrackLyricsSpy } = vi.hoisted(() => ({
  lyricsState: { lyrics: null as import("../../lib/bridge").LyricsResult | null, loading: false },
  useTrackLyricsSpy: vi.fn(),
}));

vi.mock("../../lib/useTrackLyrics", () => ({
  useTrackLyrics: (...args: unknown[]) => {
    useTrackLyricsSpy(...args);
    return { ...lyricsState, reload: () => {} };
  },
}));
vi.mock("../../lib/persist", () => ({
  persistStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

import { PhoneNowPlaying } from "./PhoneNowPlaying";
import { usePlayer } from "../../stores/player";
import { useUI } from "../../stores/ui";

const track = (i: number): Track => ({ id: `t${i}`, title: `Track ${i}`, artist: `Artist ${i}`, thumb: null });

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", target: Element, clientY: number, time: number) {
  const event = createEvent[type](target, { clientX: 120, clientY });
  Object.defineProperty(event, "timeStamp", { value: time });
  fireEvent(target, event);
}

function header(): HTMLElement {
  return screen.getByRole("dialog", { name: "Now playing" }).querySelector("header") as HTMLElement;
}

beforeEach(() => {
  usePlayer.setState({ queue: [track(1), track(2)], index: 0, playing: false, buffering: false, position: 50, duration: 200 });
  lyricsState.lyrics = null;
  lyricsState.loading = false;
  useUI.setState({ nowPlayingOpen: true, phoneQueueOpen: false, phoneLyricsOpen: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PhoneNowPlaying", () => {
  it("renders nothing when closed", () => {
    useUI.setState({ nowPlayingOpen: false });
    render(<PhoneNowPlaying />);
    expect(screen.queryByRole("dialog", { name: "Now playing" })).toBeNull();
  });

  it("covers the whole screen and keeps the header below the status inset", () => {
    render(<PhoneNowPlaying />);
    const close = screen.getByRole("button", { name: "Close Now Playing" });
    const section = screen.getByRole("dialog", { name: "Now playing" });
    expect(section.className).toContain("inset-0");
    const backdrop = section.firstElementChild as HTMLElement;
    expect(backdrop.className).toContain("bg-base");
    expect(backdrop.className).not.toContain("rounded");
    expect(screen.getByRole("button", { name: "More options" })).toBeTruthy();
    const body = close.closest<HTMLElement>("[data-sheet-body]");
    expect(body && section.contains(body)).toBe(true);
    expect(body?.style.paddingTop).toBe(INSET_TOP);
    expect(document.querySelector("[data-roll-strip]")).toBeNull();
  });

  it("shows the transport and secondary controls and no timing nudge", () => {
    render(<PhoneNowPlaying />);
    expect(screen.getByRole("dialog", { name: "Now playing" })).toBeTruthy();
    for (const name of [
      "Enable shuffle",
      "Previous",
      "Play",
      "Next",
      "Repeat all",
      "Like",
      "Download",
      "Lyrics",
      "Queue",
      "Cast",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.queryByLabelText(/nudge|timing/i)).toBeNull();
  });

  it("has exactly one more button, in the header", () => {
    render(<PhoneNowPlaying />);
    const more = screen.getAllByRole("button", { name: /more/i });
    expect(more).toHaveLength(1);
    expect(more[0].getAttribute("aria-label")).toBe("More options");
    expect(header().contains(more[0])).toBe(true);
  });

  it("shows --:-- for the duration when it is unknown and keeps the fill at zero", () => {
    usePlayer.setState({ duration: 0, position: 125 });
    render(<PhoneNowPlaying />);
    expect(screen.getByText("--:--")).toBeTruthy();
    const slider = screen.getByRole("slider", { name: "Seek" });
    expect(slider.querySelector("[style*='scaleX(0)']")).toBeTruthy();
  });

  it("closes from the down chevron", async () => {
    render(<PhoneNowPlaying />);
    fireEvent.click(screen.getByRole("button", { name: "Close Now Playing" }));
    await waitFor(() => expect(useUI.getState().nowPlayingOpen).toBe(false), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Now playing" })).toBeNull(), { timeout: 3000 });
  });

  it("seeks to the tapped point of the seek bar", () => {
    render(<PhoneNowPlaying />);
    const slider = screen.getByRole("slider", { name: "Seek" });
    slider.getBoundingClientRect = () =>
      ({ left: 100, width: 200, top: 0, right: 300, bottom: 0, height: 0, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(slider, { clientX: 150, clientY: 0 });
    fireEvent.pointerUp(slider, { clientX: 150, clientY: 0 });
    expect(seekTo).toHaveBeenLastCalledWith(50);
  });

  it("seeks to where a drag ends, not only where it starts", () => {
    render(<PhoneNowPlaying />);
    const slider = screen.getByRole("slider", { name: "Seek" });
    slider.getBoundingClientRect = () =>
      ({ left: 100, width: 200, top: 0, right: 300, bottom: 0, height: 0, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(slider, { clientX: 150, clientY: 0 });
    fireEvent.pointerMove(slider, { clientX: 250, clientY: 0 });
    fireEvent.pointerUp(slider, { clientX: 250, clientY: 0 });
    expect(seekTo).toHaveBeenLastCalledWith(150);
  });

  it("puts Cast on the left, the Lyrics label in the centre and Queue on the right of one bottom row", () => {
    render(<PhoneNowPlaying />);
    const cast = screen.getByRole("button", { name: "Cast" });
    const lyrics = screen.getByRole("button", { name: "Lyrics" });
    const queue = screen.getByRole("button", { name: "Queue" });
    const row = cast.parentElement as HTMLElement;
    expect(lyrics.closest("[data-lyrics-hint]")?.parentElement).toBe(row);
    expect(queue.parentElement).toBe(row);
    expect(row.children).toHaveLength(3);
    expect(row.firstElementChild).toBe(cast);
    expect(row.children[1]).toBe(lyrics.closest("[data-lyrics-hint]"));
    expect(row.lastElementChild).toBe(queue);
  });

  it("opens lyrics, not the queue, on an upward swipe over the artwork", () => {
    render(<PhoneNowPlaying />);
    const pages = screen.getByRole("group", { name: "Now playing pages" });
    fireEvent.pointerDown(pages, { clientX: 300, clientY: 400 });
    fireEvent.pointerMove(pages, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(pages, { clientX: 300, clientY: 50 });
    fireEvent.pointerUp(pages, { clientX: 300, clientY: 50 });
    expect(useUI.getState().phoneLyricsOpen).toBe(true);
    expect(useUI.getState().phoneQueueOpen).toBe(false);
  });

  it("opens lyrics on an upward swipe over the transport and bottom row", () => {
    render(<PhoneNowPlaying />);
    const transport = screen.getByRole("group", { name: "Transport" });
    fireEvent.pointerDown(transport, { clientX: 300, clientY: 400 });
    fireEvent.pointerMove(transport, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(transport, { clientX: 300, clientY: 50 });
    fireEvent.pointerUp(transport, { clientX: 300, clientY: 50 });
    expect(useUI.getState().phoneLyricsOpen).toBe(true);
    expect(useUI.getState().phoneQueueOpen).toBe(false);
  });

  it("does not open lyrics from an upward drag on the seek bar", () => {
    render(<PhoneNowPlaying />);
    const slider = screen.getByRole("slider", { name: "Seek" });
    fireEvent.pointerDown(slider, { clientX: 300, clientY: 400 });
    fireEvent.pointerMove(slider, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(slider, { clientX: 300, clientY: 50 });
    fireEvent.pointerUp(slider, { clientX: 300, clientY: 50 });
    expect(useUI.getState().phoneLyricsOpen).toBe(false);
  });

  it("closes the lyrics from a downward drag on the panel header", () => {
    useUI.setState({ phoneLyricsOpen: true });
    render(<PhoneNowPlaying />);
    const row = document.querySelector("[data-queue-thumb]")?.parentElement as HTMLElement;
    pointer("pointerDown", row, 100, 1000);
    pointer("pointerMove", row, 600, 2000);
    pointer("pointerUp", row, 600, 2000);
    expect(useUI.getState().phoneLyricsOpen).toBe(false);
  });

  it("opens the queue from the Queue button only", () => {
    render(<PhoneNowPlaying />);
    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
    expect(useUI.getState().phoneQueueOpen).toBe(true);
    expect(useUI.getState().phoneLyricsOpen).toBe(false);
  });

  it("opens the lyrics from the centre Lyrics label when the track has lyrics", () => {
    lyricsState.lyrics = { synced: [{ time: 1, text: "line" }], plain: null, source: "LRCLIB", wordSynced: false };
    render(<PhoneNowPlaying />);
    fireEvent.click(screen.getByRole("button", { name: "Lyrics" }));
    expect(useUI.getState().phoneLyricsOpen).toBe(true);
  });

  it("hides the Lyrics label when the track has no lyrics", () => {
    render(<PhoneNowPlaying />);
    const hint = screen.getByRole("button", { name: "Lyrics" }).closest("[data-lyrics-hint]");
    expect(hint?.className).toContain("hidden");
  });

  it("starts loading the current track's lyrics when Now Playing opens", () => {
    render(<PhoneNowPlaying />);
    expect(useTrackLyricsSpy).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), 200);
  });

  it("does not skip the track on a swipe over the artwork", () => {
    render(<PhoneNowPlaying />);
    const pages = screen.getByRole("group", { name: "Now playing pages" });
    fireEvent.pointerDown(pages, { clientX: 300, clientY: 300 });
    fireEvent(pages, createEvent.pointerUp(pages, { clientX: 100, clientY: 300 }));
    expect(usePlayer.getState().index).toBe(0);
  });

  it("follows a downward drag from the header and closes past 40%", async () => {
    render(<PhoneNowPlaying />);
    pointer("pointerDown", header(), 100, 1000);
    pointer("pointerMove", header(), 520, 2000);
    pointer("pointerUp", header(), 520, 2000);
    await waitFor(() => expect(useUI.getState().nowPlayingOpen).toBe(false), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Now playing" })).toBeNull(), { timeout: 3000 });
  });

  it("stays open after a short, slow drag", () => {
    render(<PhoneNowPlaying />);
    pointer("pointerDown", header(), 100, 1000);
    pointer("pointerMove", header(), 150, 2000);
    pointer("pointerUp", header(), 150, 2000);
    expect(useUI.getState().nowPlayingOpen).toBe(true);
  });

  it("closes on a fast downward release even when short", async () => {
    render(<PhoneNowPlaying />);
    pointer("pointerDown", header(), 100, 1000);
    pointer("pointerMove", header(), 200, 1100);
    pointer("pointerUp", header(), 200, 1100);
    await waitFor(() => expect(useUI.getState().nowPlayingOpen).toBe(false), { timeout: 3000 });
  });

  it("centres the title between download and like", () => {
    render(<PhoneNowPlaying />);
    const title = screen.getAllByText("Track 1")[0];
    expect(title.className).toContain("text-section");
    expect(title.className).toContain("font-semibold");
    expect(title.className).toContain("truncate");
    expect(title.className).toContain("text-center");
    const like = screen.getByRole("button", { name: "Like" });
    const download = screen.getByRole("button", { name: "Download" });
    const row = like.parentElement as HTMLElement;
    expect(row.contains(title)).toBe(true);
    expect(row.firstElementChild?.contains(download)).toBe(true);
    expect(row.lastElementChild?.contains(like)).toBe(true);
    expect(row.contains(screen.getByRole("button", { name: "Cast" }))).toBe(false);
  });

  it("keeps like a single tap away from the title", () => {
    render(<PhoneNowPlaying />);
    const like = screen.getByRole("button", { name: "Like" });
    expect(like.className).toContain("h-11");
    expect(like.className).toContain("w-11");
  });

  it("labels Cast and Queue by aria-label only, and shows the Lyrics label as text", () => {
    render(<PhoneNowPlaying />);
    for (const name of ["Queue", "Cast"]) {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("aria-label")).toBe(name);
      expect(button.getAttribute("title")).toBe(name);
      expect(button.textContent).toBe("");
    }
    expect(screen.getByRole("button", { name: "Lyrics" }).textContent).toBe("Lyrics");
  });

  it("keeps the flat artwork backdrop out when the track has no artwork", () => {
    render(<PhoneNowPlaying />);
    expect(document.querySelector("[data-ambient-backdrop]")).toBeNull();
  });
});


describe("phone seeking safeguards", () => {
  function slider() {
    const el = screen.getByRole("slider", { name: "Seek" });
    el.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
    return el;
  }

  it("announces the dragged position before committing playback", () => {
    render(<PhoneNowPlaying />);
    const el = slider();
    fireEvent.pointerDown(el, { clientX: 40 });
    fireEvent.pointerMove(el, { clientX: 150 });
    expect(el.getAttribute("aria-valuenow")).toBe("150");
    expect(seekTo).not.toHaveBeenCalled();
    fireEvent.pointerUp(el, { clientX: 150 });
    expect(seekTo).toHaveBeenLastCalledWith(150);
  });

  it("cancels a seek when the track changes during the gesture", () => {
    render(<PhoneNowPlaying />);
    const el = slider();
    fireEvent.pointerDown(el, { clientX: 40 });
    act(() => { usePlayer.setState({ index: 1, position: 0, duration: 240 }); });
    fireEvent.pointerUp(el, { clientX: 150 });
    expect(seekTo).not.toHaveBeenCalled();
    expect(el.getAttribute("aria-valuenow")).toBe("0");
  });

  it("does not commit cancelled gestures", () => {
    render(<PhoneNowPlaying />);
    const el = slider();
    fireEvent.pointerDown(el, { clientX: 40 });
    fireEvent.pointerCancel(el);
    fireEvent.pointerUp(el, { clientX: 150 });
    expect(seekTo).not.toHaveBeenCalled();
  });

  it("supports Home, End and vertical arrow keys", () => {
    render(<PhoneNowPlaying />);
    const el = slider();
    fireEvent.keyDown(el, { key: "Home" });
    expect(seekTo).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(el, { key: "End" });
    expect(seekTo).toHaveBeenLastCalledWith(200);
    act(() => { usePlayer.setState({ position: 50 }); });
    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(seekTo).toHaveBeenLastCalledWith(55);
  });

  it("disables unknown-duration seeking and clamps invalid positions", () => {
    usePlayer.setState({ position: Number.NaN, duration: Infinity });
    render(<PhoneNowPlaying />);
    const el = slider();
    expect(el.getAttribute("aria-valuenow")).toBe("0");
    expect(el.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(el, { key: "End" });
    expect(seekTo).not.toHaveBeenCalled();
  });

  it("moves initial focus to the Close button and closes on Escape", async () => {
    useUI.setState({ nowPlayingOpen: true });
    render(<PhoneNowPlaying />);
    const closeBtn = screen.getByRole("button", { name: "Close Now Playing" });
    await waitFor(() => expect(document.activeElement).toBe(closeBtn));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(useUI.getState().nowPlayingOpen).toBe(false));
  });

  it("contains focus within the dialog when Tab is pressed", async () => {
    useUI.setState({ nowPlayingOpen: true });
    render(<PhoneNowPlaying />);
    const dialog = screen.getByRole("dialog", { name: "Now playing" });
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(first);
  });

  it("cycles repeat button accessible names matching the next action", () => {
    usePlayer.setState({ repeat: "off" });
    const { rerender } = render(<PhoneNowPlaying />);
    const repeatOff = screen.getByRole("button", { name: "Repeat all" });
    expect(repeatOff).toBeTruthy();
    expect(repeatOff.getAttribute("aria-pressed")).toBe("false");

    usePlayer.setState({ repeat: "all" });
    rerender(<PhoneNowPlaying />);
    const repeatAll = screen.getByRole("button", { name: "Repeat one" });
    expect(repeatAll).toBeTruthy();
    expect(repeatAll.getAttribute("aria-pressed")).toBe("true");

    usePlayer.setState({ repeat: "one" });
    rerender(<PhoneNowPlaying />);
    const repeatOne = screen.getByRole("button", { name: "Repeat off" });
    expect(repeatOne).toBeTruthy();
    expect(repeatOne.getAttribute("aria-pressed")).toBe("true");
  });

  it("exposes popup and expanded semantics for More options and Queue buttons", () => {
    render(<PhoneNowPlaying />);
    const moreBtn = screen.getByRole("button", { name: "More options" });
    expect(moreBtn.getAttribute("aria-haspopup")).toBe("menu");
    expect(moreBtn.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(moreBtn);
    expect(useUI.getState().contextMenu).not.toBeNull();
    expect(moreBtn.getAttribute("aria-expanded")).toBe("true");

    const queueBtn = screen.getByRole("button", { name: "Queue" });
    expect(queueBtn.getAttribute("aria-haspopup")).toBe("dialog");
    expect(queueBtn.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(queueBtn);
    expect(useUI.getState().phoneQueueOpen).toBe(true);
    expect(queueBtn.getAttribute("aria-expanded")).toBe("true");
  });
});
