import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../lib/palette", () => ({ useArtTint: () => "60 60 64" }));

import { ReplayStories, storySlides } from "./ReplayStories";
import { isoDay, type ReplayData } from "../../lib/replay";

const hours = new Array<number>(24).fill(0);
hours[9] = 3_600_000;
hours[20] = 3_600_000;

const data: ReplayData = {
  period: "month",
  months: ["2026-11"],
  totalMs: 7_200_000,
  plays: 5,
  tracks: [
    { id: "s1", title: "Opening song", artist: "Band A", thumb: null, ms: 3_600_000, plays: 3 },
    { id: "s2", title: "Closing song", artist: "Band B", thumb: null, ms: 3_600_000, plays: 2 },
    { id: "s3", title: "Middle song", artist: "Band C", thumb: null, ms: 0, plays: 1 },
  ],
  artists: [
    { name: "Band A", ms: 3_600_000, plays: 3 },
    { name: "Band B", ms: 3_600_000, plays: 2 },
  ],
  albums: [],
  hours,
  days: [{ date: isoDay(new Date()), ms: 7_200_000 }],
  counts: { tracks: 3, artists: 2, albums: 0 },
};

const empty: ReplayData = {
  ...data,
  totalMs: 0,
  plays: 0,
  tracks: [],
  artists: [],
  hours: new Array<number>(24).fill(0),
  days: [],
  counts: { tracks: 0, artists: 0, albums: 0 },
};

function renderStories(overrides: Partial<Parameters<typeof ReplayStories>[0]> = {}) {
  const props = {
    load: { status: "ready" as const, data },
    period: "month" as const,
    label: "November 2026",
    onPeriod: vi.fn(),
    onRetry: vi.fn(),
    onShare: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ReplayStories {...props} />);
  return props;
}

beforeEach(() => {
  document.documentElement.classList.add("reduce-motion");
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("reduce-motion");
});

describe("storySlides", () => {
  it("opens on the intro and ends on the share card", () => {
    expect(storySlides(data)).toEqual(["intro", "songs", "artists", "time", "share"]);
  });

  it("leaves out a slide with nothing to show", () => {
    expect(storySlides({ ...data, artists: [], hours: new Array<number>(24).fill(0) })).toEqual(["intro", "songs", "share"]);
  });
});

describe("ReplayStories", () => {
  it("is a labelled full-screen dialog with a close button", () => {
    const props = renderStories();
    expect(screen.getByRole("dialog", { name: "Your Replay" })).toBeTruthy();
    screen.getByRole("button", { name: "Close Replay" }).click();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the minutes on the intro", () => {
    renderStories();
    expect(screen.getByText("120")).toBeTruthy();
  });

  it("moves forward when the right side is tapped", async () => {
    renderStories();
    const surface = screen.getByRole("dialog").firstElementChild as HTMLElement;
    fireEvent.pointerDown(surface, { clientX: 900, clientY: 300 });
    fireEvent.pointerUp(surface, { clientX: 900, clientY: 300 });
    expect(await screen.findByRole("region", { name: "Top songs" })).toBeTruthy();
  });

  it("moves back when the left side is tapped", async () => {
    renderStories();
    const surface = screen.getByRole("dialog").firstElementChild as HTMLElement;
    fireEvent.pointerDown(surface, { clientX: 900, clientY: 300 });
    fireEvent.pointerUp(surface, { clientX: 900, clientY: 300 });
    await screen.findByRole("region", { name: "Top songs" });
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 300 });
    fireEvent.pointerUp(surface, { clientX: 100, clientY: 300 });
    expect(await screen.findByRole("region", { name: "Your Replay" })).toBeTruthy();
  });

  it("explains too little history and keeps the period choices", () => {
    renderStories({ load: { status: "ready", data: empty } });
    expect(screen.getByText("Not enough listening yet")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "This year" })).toBeTruthy();
  });

  it("offers a retry when the stats cannot be read", () => {
    const props = renderStories({ load: { status: "error" } });
    screen.getByRole("button", { name: "Try again" }).click();
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("exposes accessible Next and Previous slide buttons that navigate slides", async () => {
    renderStories();
    const prevBtn = screen.getByRole("button", { name: "Previous slide" });
    const nextBtn = screen.getByRole("button", { name: "Next slide" });

    expect(prevBtn).toHaveProperty("disabled", true);
    expect(await screen.findByRole("region", { name: "Your Replay" })).toBeTruthy();

    fireEvent.click(nextBtn);
    expect(await screen.findByRole("region", { name: "Top songs" })).toBeTruthy();
    expect(prevBtn).toHaveProperty("disabled", false);

    fireEvent.click(prevBtn);
    expect(await screen.findByRole("region", { name: "Your Replay" })).toBeTruthy();
    expect(prevBtn).toHaveProperty("disabled", true);
  });
});
