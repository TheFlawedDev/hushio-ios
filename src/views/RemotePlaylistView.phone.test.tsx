import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ContextMenu } from "../components/ContextMenu";

const { getPlaylistPage } = vi.hoisted(() => ({ getPlaylistPage: vi.fn() }));

vi.mock("../lib/usePhone", () => ({ usePhone: () => true }));
vi.mock("../lib/browse", () => ({ getPlaylistPage }));
vi.mock("../lib/audio", () => ({
  audio: new Audio(),
  playStream: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seekTo: vi.fn(),
  setVolume: vi.fn(),
  setMuted: vi.fn(),
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

import { RemotePlaylistView } from "./RemotePlaylistView";
import { PHONE_PLAY, PHONE_SHUFFLE } from "../components/phone/heroButtons";
import type { SearchSong } from "../lib/searchParse";
import { useNavigation } from "../stores/navigation";
import { usePlayer } from "../stores/player";

const initialPlayer = usePlayer.getState();

function songs(count: number): SearchSong[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    title: `Mix ${index}`,
    artist: "Nova",
    thumb: null,
    artistId: null,
    albumId: null,
    album: "Night Drive",
    duration: 0,
    explicit: false,
    isVideo: false,
  }));
}

function page(credit: string, tracks: SearchSong[]) {
  return {
    title: "Late Night Mix",
    credit,
    year: "2022",
    thumb: null,
    tracks,
    continuation: null,
    meta: `${tracks.length} songs · 2 hr 52 min`,
  };
}

beforeEach(() => {
  useNavigation.setState({ view: { name: "ytplaylist", param: "PLx" } });
});

afterEach(() => {
  cleanup();
  usePlayer.setState(initialPlayer);
  getPlaylistPage.mockReset();
});

describe("RemotePlaylistView on phone", () => {
  it("sets Play and Shuffle side by side under the stacked header", async () => {
    getPlaylistPage.mockResolvedValue(page("Mira", songs(2)));
    render(<><RemotePlaylistView /><ContextMenu /></>);

    const play = await screen.findByRole("button", { name: "Play" });
    const shuffle = screen.getByRole("button", { name: "Shuffle" });
    expect(play.parentElement).toBe(shuffle.parentElement);
    expect(play.className).toBe(PHONE_PLAY);
    expect(shuffle.className).toBe(PHONE_SHUFFLE);
    expect(screen.getByRole("heading", { level: 1, name: "Late Night Mix" })).toBeTruthy();
  });

  it("renders rows as phone song rows with a Play label and no number column", async () => {
    getPlaylistPage.mockResolvedValue(page("Mira", songs(2)));
    render(<><RemotePlaylistView /><ContextMenu /></>);

    expect(await screen.findByRole("button", { name: /Play Mix 0/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Play Mix 1/ })).toBeTruthy();
    expect(screen.queryByText("2")).toBeNull();
  });

  it("drops YouTube Music from the facts line and keeps the other owners", async () => {
    getPlaylistPage.mockResolvedValue(page("YouTube Music", songs(2)));
    const { unmount } = render(<><RemotePlaylistView /><ContextMenu /></>);
    expect(await screen.findByText("2 songs · 2 hr 52 min")).toBeTruthy();
    expect(screen.queryByText(/youtube music/i)).toBeNull();
    unmount();

    getPlaylistPage.mockResolvedValue(page("youtube music • Mira • Ana", songs(2)));
    render(<><RemotePlaylistView /><ContextMenu /></>);
    expect(await screen.findByText("Mira • Ana")).toBeTruthy();
    expect(screen.queryByText(/youtube music/i)).toBeNull();
  });
});
