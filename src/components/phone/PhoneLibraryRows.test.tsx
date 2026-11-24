import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { Books } from "@phosphor-icons/react";

const { haptic } = vi.hoisted(() => ({ haptic: vi.fn() }));

vi.mock("../../lib/haptics", () => ({ haptic }));

import { PhoneCollage, PhoneLibraryRow, PhoneLibraryTile } from "./PhoneLibraryRows";
import { LONG_HOLD_MS } from "../../lib/phoneGestures";

if (!("PointerEvent" in window)) {
  Object.defineProperty(window, "PointerEvent", { value: class extends MouseEvent {} });
}

const cover = "https://lh3.googleusercontent.com/abc=w120-h120-l90-rj";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  haptic.mockClear();
});

describe("library collage images", () => {
  it("fade in from transparent once the image has loaded", () => {
    const { container } = render(<PhoneCollage covers={[cover]} fallback={Books} sizeClass="size-10" radiusClass="rounded-md" />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.className).toContain("opacity-0");
    expect(img?.className).toContain("motion-safe:transition-opacity");

    fireEvent.load(img!);
    expect(img?.className).toContain("opacity-100");
  });
});

describe("PhoneLibraryTile long press", () => {
  it("opens its menu after the hold with a select tick and skips the click", () => {
    const onOpen = vi.fn();
    const onLongPress = vi.fn();
    render(<PhoneLibraryTile title="Liked" subtitle="3 songs" covers={[]} fallback={Books} onOpen={onOpen} onLongPress={onLongPress} />);
    const tile = screen.getByRole("button", { name: "Liked 3 songs" });

    fireEvent(tile, createEvent.pointerDown(tile, { clientX: 8, clientY: 9 }));
    act(() => {
      vi.advanceTimersByTime(LONG_HOLD_MS);
    });
    fireEvent(tile, createEvent.pointerUp(tile, { clientX: 8, clientY: 9 }));
    fireEvent.click(tile);

    expect(onLongPress).toHaveBeenCalledWith({ x: 8, y: 9 });
    expect(haptic).toHaveBeenCalledWith("select");
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("library tiles without art", () => {
  it("use a neutral wash with the accent icon instead of an accent tint", () => {
    const { container } = render(<PhoneLibraryTile title="Liked Songs" subtitle="3 songs" covers={[]} fallback={Books} onOpen={() => {}} />);
    const art = container.querySelector("[aria-hidden=true].grid");
    expect(art?.className).toContain("bg-wash");
    expect(art?.className).not.toContain("bg-accent");
  });
});

describe("PhoneLibraryRows accessible names", () => {
  it("composes accessible name with title, pinned metadata, and subtitle for PhoneLibraryTile", () => {
    render(
      <PhoneLibraryTile
        title="Favorites"
        subtitle="12 songs"
        pinned={true}
        covers={[]}
        fallback={Books}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Favorites Pinned, 12 songs" })).toBeTruthy();
  });

  it("composes accessible name with title, pinned metadata, and subtitle for PhoneLibraryRow", () => {
    render(
      <PhoneLibraryRow
        title="Favorites"
        subtitle="12 songs"
        pinned={true}
        art={<span aria-hidden="true" />}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Favorites Pinned, 12 songs" })).toBeTruthy();
  });
});
