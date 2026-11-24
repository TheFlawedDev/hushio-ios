import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/persist", () => ({
  persistStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

const mockOpenSuggestion = vi.fn();
const mockSubmitSearch = vi.fn();

vi.mock("../../lib/searchActions", () => ({
  openSuggestion: (...args: unknown[]) => mockOpenSuggestion(...args),
  submitSearch: (...args: unknown[]) => mockSubmitSearch(...args),
}));

const mockRows = [
  { kind: "completion" as const, text: "radiohead" },
];

vi.mock("../SearchSuggestions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SearchSuggestions")>();
  return {
    ...actual,
    useTypeAhead: (query: string, enabled: boolean) => (enabled && query ? mockRows : []),
  };
});

import { PhoneSearchField } from "./PhoneSearchField";
import { useUI } from "../../stores/ui";

beforeEach(() => {
  useUI.setState({ searchQuery: "" });
  mockOpenSuggestion.mockClear();
  mockSubmitSearch.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("PhoneSearchField touch targets", () => {
  it("provides an input touch target of at least 44px on iOS", () => {
    render(<PhoneSearchField />);
    const input = screen.getByRole("combobox", { name: "Search" });
    expect(input.className).toContain("h-11");
    expect(input.className).toContain("min-h-[var(--hit-min,44px)]");
  });

  it("provides a clear button target of at least 44px", () => {
    useUI.setState({ searchQuery: "test" });
    render(<PhoneSearchField />);
    const clearBtn = screen.getByRole("button", { name: "Clear search" });
    expect(clearBtn.className).toContain("h-11");
    expect(clearBtn.className).toContain("w-12");
  });
});

describe("PhoneSearchField blur guard", () => {
  it("keeps suggestions open when blur is preceded by touchstart on a suggestion", async () => {
    render(<PhoneSearchField suggest={true} />);
    const input = screen.getByRole("combobox", { name: "Search" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "rad" } });

    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const suggestion = screen.getByText("radiohead");

    // Touchstart on suggestion occurs before input blur
    fireEvent.touchStart(suggestion);
    fireEvent.blur(input);

    // Blur guard ensures suggestions remain open and combobox stays expanded
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");

    // Activating suggestion triggers pick and closes suggestions
    fireEvent.click(suggestion);
    expect(mockOpenSuggestion).toHaveBeenCalledTimes(1);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("keeps suggestions open when blur is preceded by mousedown on a suggestion", () => {
    render(<PhoneSearchField suggest={true} />);
    const input = screen.getByRole("combobox", { name: "Search" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "rad" } });

    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const suggestion = screen.getByText("radiohead");

    fireEvent.mouseDown(suggestion);
    fireEvent.blur(input);

    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("dismisses suggestions immediately when blur occurs without interacting with suggestions", async () => {
    render(<PhoneSearchField suggest={true} />);
    const input = screen.getByRole("combobox", { name: "Search" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "rad" } });

    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");

    fireEvent.blur(input);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("closes suggestions when tapping outside after interacting", async () => {
    render(<PhoneSearchField suggest={true} />);
    const input = screen.getByRole("combobox", { name: "Search" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "rad" } });

    const suggestion = screen.getByText("radiohead");
    fireEvent.touchStart(suggestion);
    fireEvent.blur(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");

    // Tap outside
    fireEvent.pointerDown(document.body);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });
});
