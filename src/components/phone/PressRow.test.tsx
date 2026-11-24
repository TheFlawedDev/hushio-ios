import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { PressRow } from "./PressRow";
import { LONG_PRESS_MS } from "../../lib/longPress";
import { haptic } from "../../lib/haptics";

vi.mock("../../lib/haptics", () => ({ haptic: vi.fn() }));

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", target: Element, clientX: number, clientY: number) {
  fireEvent(target, createEvent[type](target, { clientX, clientY }));
}

if (!("PointerEvent" in window)) {
  Object.defineProperty(window, "PointerEvent", { value: class extends MouseEvent {} });
}

describe("PressRow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("gives a select tick when the long press fires", () => {
    render(<PressRow label="Row" onLongPress={vi.fn()}>Row</PressRow>);
    const row = screen.getByRole("button", { name: "Row" });
    pointer("pointerDown", row, 0, 0);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(haptic).toHaveBeenCalledWith("select");
  });

  it("presses on a short tap", () => {
    const onPress = vi.fn();
    render(<PressRow label="Row" onPress={onPress}>Row</PressRow>);
    const row = screen.getByRole("button", { name: "Row" });
    pointer("pointerDown", row, 10, 10);
    pointer("pointerUp", row, 10, 10);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("fires the long press after 300 ms and does not also press", () => {
    const onPress = vi.fn();
    const onLongPress = vi.fn();
    render(<PressRow label="Row" onPress={onPress} onLongPress={onLongPress}>Row</PressRow>);
    const row = screen.getByRole("button", { name: "Row" });
    pointer("pointerDown", row, 40, 80);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).toHaveBeenCalledWith({ x: 40, y: 80 });
    pointer("pointerUp", row, 40, 80);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("a finger that moves more than 5 dp before 300 ms is a scroll, not a long press", () => {
    const onPress = vi.fn();
    const onLongPress = vi.fn();
    render(<PressRow label="Row" onPress={onPress} onLongPress={onLongPress}>Row</PressRow>);
    const row = screen.getByRole("button", { name: "Row" });
    pointer("pointerDown", row, 0, 0);
    pointer("pointerMove", row, 0, 6);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("a press cancels when the finger moves more than 10 dp", () => {
    const onPress = vi.fn();
    render(<PressRow label="Row" onPress={onPress}>Row</PressRow>);
    const row = screen.getByRole("button", { name: "Row" });
    pointer("pointerDown", row, 0, 0);
    pointer("pointerMove", row, 0, 11);
    pointer("pointerUp", row, 0, 11);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows a background highlight on press instead of scaling the row", () => {
    render(<PressRow label="Row" onPress={() => {}}>Row</PressRow>);
    const row = screen.getByRole("button", { name: "Row" });
    expect(row.className).not.toContain("scale");
    pointer("pointerDown", row, 0, 0);
    expect(row.querySelector("[data-press-highlight]")?.className).toContain("opacity-100");
    pointer("pointerUp", row, 0, 0);
    expect(row.querySelector("[data-press-highlight]")?.className).toContain("opacity-0");
    expect(row.querySelector("[data-press-highlight]")?.className).toContain("duration-fade");
  });

  it("a small movement under 10 dp still presses", () => {
    const onPress = vi.fn();
    render(<PressRow label="Row" onPress={onPress}>Row</PressRow>);
    const row = screen.getByRole("button", { name: "Row" });
    pointer("pointerDown", row, 0, 0);
    pointer("pointerMove", row, 0, 9);
    pointer("pointerUp", row, 0, 9);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("derives accessible name from children when label is omitted and exposes aria-current", () => {
    render(
      <PressRow aria-current="true">
        <span>Track Title</span>
        <span>Track Artist</span>
      </PressRow>,
    );
    const row = screen.getByRole("button", { name: "Track Title Track Artist" });
    expect(row).toBeTruthy();
    expect(row.getAttribute("aria-current")).toBe("true");
  });
});
