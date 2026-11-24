import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";

const { haptic } = vi.hoisted(() => ({ haptic: vi.fn() }));

vi.mock("../../lib/haptics", () => ({ haptic }));

vi.mock("../../lib/persist", () => ({
  persistStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

import { PhoneQueueList } from "./PhoneQueueSheet";
import { Sheet } from "./Sheet";
import { usePlayer } from "../../stores/player";
import { useSettings } from "../../stores/settings";
import { useUI } from "../../stores/ui";
import type { Track } from "../../types";

const first: Track = { id: "q1", title: "First", artist: "Band", thumb: null };
const second: Track = { id: "q2", title: "Second", artist: "Band", thumb: null };
const third: Track = { id: "q3", title: "Third", artist: "Band", thumb: null };

if (!("PointerEvent" in window)) {
  Object.defineProperty(window, "PointerEvent", { value: class extends MouseEvent {} });
}

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", target: Element, clientY: number) {
  fireEvent(target, createEvent[type](target, { clientX: 0, clientY }));
}

beforeEach(() => {
  usePlayer.setState({ queue: [first, second], index: 0, playing: false, buffering: false, position: 0, duration: 200 });
});

afterEach(() => {
  cleanup();
  haptic.mockClear();
});

describe("PhoneQueueList rows", () => {
  it("draws the now playing row on the page with no background block", () => {
    const { container } = render(<PhoneQueueList />);

    expect(screen.getByRole("heading", { name: "Now playing" })).toBeTruthy();
    const row = container.querySelector('[data-index="0"]');
    expect(row).toBeTruthy();
    expect(row?.className).not.toContain("bg-base");
  });

  it("keeps the row content transparent so the tinted page shows through", () => {
    const { container } = render(<PhoneQueueList />);
    const content = container.querySelector("[data-swipe-row] > div");
    expect(content?.className).not.toContain("bg-base");
    expect(container.querySelector('[role="group"][aria-label="Playback modes"]')?.className).not.toContain("bg-wash");
  });

  it("shows a grip handle on each up next row that takes touch over", () => {
    render(<PhoneQueueList />);
    const handle = screen.getByRole("button", { name: "Drag Second to reorder" });
    expect(handle.className).toContain("touch-none");
    expect(screen.queryByRole("button", { name: "Drag First to reorder" })).toBeNull();
  });

  it("drags an up next row by its handle and drops it at the new slot", () => {
    usePlayer.setState({ queue: [first, second, third], index: 0 });
    render(<PhoneQueueList />);
    const handle = screen.getByRole("button", { name: "Drag Third to reorder" });

    pointer("pointerDown", handle, 200);
    pointer("pointerMove", handle, 140);
    pointer("pointerUp", handle, 140);

    expect(usePlayer.getState().queue.map((track) => track.id)).toEqual(["q1", "q3", "q2"]);
    expect(haptic).toHaveBeenCalledWith("tick");
  });

  it("leaves the queue alone when the handle is released in place", () => {
    usePlayer.setState({ queue: [first, second, third], index: 0 });
    render(<PhoneQueueList />);
    const handle = screen.getByRole("button", { name: "Drag Second to reorder" });

    pointer("pointerDown", handle, 200);
    pointer("pointerUp", handle, 200);

    expect(usePlayer.getState().queue.map((track) => track.id)).toEqual(["q1", "q2", "q3"]);
  });
});

describe("PhoneQueueList sections and modes", () => {
  const fourth: Track = { id: "q4", title: "Fourth", artist: "Band", thumb: null };

  beforeEach(() => {
    usePlayer.setState({ queue: [first, second, third, fourth], index: 2, autoplayCount: 0, playingFrom: null, shuffle: false, repeat: "off" });
    useSettings.setState({ autoplay: true });
  });

  it("hides previously played tracks until the user asks for them", () => {
    render(<PhoneQueueList />);
    expect(screen.queryByText("First")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show previously played" }));
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide previously played" }));
    expect(screen.queryByText("First")).toBeNull();
  });

  it("hides the previously played toggle on the first track", () => {
    usePlayer.setState({ index: 0 });
    render(<PhoneQueueList />);
    expect(screen.queryByRole("button", { name: "Show previously played" })).toBeNull();
  });

  it("shows where playback started under now playing", () => {
    usePlayer.setState({ playingFrom: "__liked__" });
    render(<PhoneQueueList />);
    expect(screen.getByText("Playing from Liked Songs")).toBeTruthy();
  });

  it("puts the autoplay tail under its own heading with one explanation line", () => {
    usePlayer.setState({ index: 0, autoplayCount: 2 });
    render(<PhoneQueueList />);
    expect(screen.getByRole("button", { name: "Drag Second to reorder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Drag Third to reorder" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Autoplay" })).toBeTruthy();
    expect(screen.getByText("Similar songs play after your queue ends.")).toBeTruthy();
    expect(screen.getByText("Third")).toBeTruthy();
    expect(screen.getByText("Fourth")).toBeTruthy();
  });

  it("shows no autoplay heading when the queue has no autoplay tail", () => {
    render(<PhoneQueueList />);
    expect(screen.queryByRole("heading", { name: "Autoplay" })).toBeNull();
  });

  it("does not let an upnext row drop into the autoplay tail", () => {
    usePlayer.setState({ queue: [first, second, third, fourth], index: 0, autoplayCount: 2 });
    render(<PhoneQueueList />);
    const handle = screen.getByRole("button", { name: "Drag Second to reorder" });
    pointer("pointerDown", handle, 200);
    pointer("pointerMove", handle, 400);
    pointer("pointerUp", handle, 400);
    expect(usePlayer.getState().queue.map((track) => track.id)).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("toggles shuffle from the header row with a tick", () => {
    render(<PhoneQueueList />);
    fireEvent.click(screen.getByRole("button", { name: "Enable shuffle" }));
    expect(usePlayer.getState().shuffle).toBe(true);
    expect(screen.getByRole("button", { name: "Disable shuffle" }).getAttribute("aria-pressed")).toBe("true");
    expect(haptic).toHaveBeenCalledWith("tick");
  });

  it("cycles repeat off, all, one", () => {
    render(<PhoneQueueList />);
    fireEvent.click(screen.getByRole("button", { name: "Enable repeat" }));
    expect(usePlayer.getState().repeat).toBe("all");
    fireEvent.click(screen.getByRole("button", { name: "Disable repeat" }));
    expect(usePlayer.getState().repeat).toBe("one");
  });

  it("turns the autoplay setting off and on", () => {
    render(<PhoneQueueList />);
    fireEvent.click(screen.getByRole("button", { name: "Disable autoplay" }));
    expect(useSettings.getState().autoplay).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Enable autoplay" }));
    expect(useSettings.getState().autoplay).toBe(true);
  });
});

describe("PhoneQueueSheet accessibility", () => {
  const fourth: Track = { id: "q4", title: "Fourth", artist: "Band", thumb: null };

  beforeEach(() => {
    usePlayer.setState({ queue: [first, second, third, fourth], index: 0, autoplayCount: 0 });
  });

  it("exposes accessible Move up and Move down buttons for upcoming tracks", () => {
    render(<PhoneQueueList />);
    const moveDownSecond = screen.getByRole("button", { name: "Move Second down" });

    fireEvent.click(moveDownSecond);
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(["q1", "q3", "q2", "q4"]);

    const moveUpSecond = screen.getByRole("button", { name: "Move Second up" });
    fireEvent.click(moveUpSecond);
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("supports keyboard ArrowUp and ArrowDown reordering on the drag handle", () => {
    render(<PhoneQueueList />);
    const handle = screen.getByRole("button", { name: "Drag Second to reorder" });

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(["q1", "q3", "q2", "q4"]);

    const newHandle = screen.getByRole("button", { name: "Drag Second to reorder" });
    fireEvent.keyDown(newHandle, { key: "ArrowUp" });
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("exposes accessible remove from queue button that removes track", () => {
    render(<PhoneQueueList />);
    const removeBtn = screen.getByRole("button", { name: "Remove Second from queue" });
    fireEvent.click(removeBtn);
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(["q1", "q3", "q4"]);
  });

  it("adds Move and Remove actions to more options context menu", () => {
    render(<PhoneQueueList />);
    const moreBtn = screen.getByRole("button", { name: "More options for Second" });
    fireEvent.click(moreBtn);

    const menu = useUI.getState().contextMenu;
    expect(menu).not.toBeNull();
    const labels = menu?.items.map((i) => i.label);
    expect(labels).toContain("Move down");
    expect(labels).toContain("Remove from queue");
  });

  it("provides at least 44pt touch target on the drag handle", () => {
    render(<PhoneQueueList />);
    const handle = screen.getByRole("button", { name: "Drag Second to reorder" });
    expect(handle.className).toContain("w-11");
    expect(handle.className).toContain("h-12");
  });
});

describe("Sheet accessibility", () => {
  it("provides an accessible Close button and closes when activated", () => {
    const onClose = vi.fn();
    render(
      <Sheet label="Test Sheet" onClose={onClose}>
        <p>Sheet content</p>
      </Sheet>,
    );
    const closeBtn = screen.getByRole("button", { name: "Close" });
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the sheet when Escape key is pressed", () => {
    const onClose = vi.fn();
    render(
      <Sheet label="Test Sheet" onClose={onClose}>
        <p>Sheet content</p>
      </Sheet>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("contains Tab focus inside the sheet", () => {
    render(
      <Sheet label="Test Sheet" onClose={() => {}}>
        <button type="button">Inside Button</button>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Test Sheet" });
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusable.length).toBeGreaterThanOrEqual(2);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    last.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(first);
  });
});
