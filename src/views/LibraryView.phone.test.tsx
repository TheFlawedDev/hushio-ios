import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { audio, playStream, play, pause, seekTo, setVolume, setMuted } = vi.hoisted(() => ({
  audio: new Audio(),
  playStream: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seekTo: vi.fn(),
  setVolume: vi.fn(),
  setMuted: vi.fn(),
}));

vi.mock("../lib/usePhone", () => ({ usePhone: () => true }));
vi.mock("../lib/audio", () => ({ audio, playStream, play, pause, seekTo, setVolume, setMuted }));
vi.mock("../lib/persist", () => ({
  persistStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

import { LibraryView } from "./LibraryView";
import { type LibraryTrack, useLibrary } from "../stores/library";
import { useNavigation } from "../stores/navigation";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";

const song = (i: number): LibraryTrack => ({
  id: `s${i}`,
  title: `Song ${i}`,
  artist: "Artist",
  thumb: null,
  album: null,
  duration: 200,
  explicit: false,
});

const initialLibrary = useLibrary.getState();
const initialNavigation = useNavigation.getState();
const initialUI = useUI.getState();
const initialLayout = useSettings.getState().libraryLayout;

beforeEach(() => {
  useLibrary.setState(initialLibrary, true);
  useNavigation.setState(initialNavigation, true);
  useUI.setState({ ...initialUI, dialog: null }, true);
  useSettings.setState({ libraryLayout: "grid" });
});

afterEach(() => {
  useSettings.setState({ libraryLayout: initialLayout });
});

afterEach(cleanup);

describe("Library on phone", () => {
  it("shows a Library title with Create and the profile button, and no stats line", () => {
    render(<LibraryView />);
    expect(screen.getByRole("heading", { level: 1, name: "Library" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Profile and settings" })).toBeTruthy();
    expect(screen.queryByText(/playlists · .* folders/)).toBeNull();
  });

  it("lists the collection rows without the Collections heading or a Playlists nav row", () => {
    render(<LibraryView />);
    expect(screen.queryByRole("region", { name: "Collections" })).toBeNull();
    for (const name of ["Liked Songs", "Downloads", "Local music"]) {
      expect(screen.getByText(name, { selector: "span.truncate" }).closest("button")).toBeTruthy();
    }
    expect(screen.queryAllByRole("button", { name: "Playlists" })).toHaveLength(0);
  });

  it("draws the Liked Songs heart filled on its accent tile", () => {
    render(<LibraryView />);
    const liked = screen.getByText("Liked Songs").closest("button") as HTMLElement;
    expect(liked.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  });

  it("shows the liked song count and the On this device subtitle", () => {
    useLibrary.setState({ liked: [song(1), song(2)] });
    render(<LibraryView />);
    const liked = within(screen.getByText("Liked Songs").closest("button") as HTMLElement);
    expect(liked.getByText("Pinned,")).toBeTruthy();
    expect(liked.getByText("2 songs")).toBeTruthy();
    expect(screen.getByText("On this device")).toBeTruthy();
  });

  it("explains the liked row when nothing is liked yet", () => {
    useLibrary.setState({ liked: [], pinnedSingles: { ...initialLibrary.pinnedSingles, liked: false } });
    render(<LibraryView />);
    expect(screen.getByText("Songs you like land here")).toBeTruthy();
  });

  it("starts a new playlist from the empty Playlists row", () => {
    render(<LibraryView />);
    expect(screen.getByText("Start one with songs you like")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /New playlist/ }));
    expect(useUI.getState().dialog?.title).toBe("New playlist");
  });

  it("opens Import from a tile in the grid", () => {
    render(<LibraryView />);
    fireEvent.click(screen.getByRole("button", { name: /Import/ }));
    expect(useNavigation.getState().view).toEqual({ name: "import" });
  });

  it("opens Downloads from its row", () => {
    render(<LibraryView />);
    fireEvent.click(screen.getByText("Downloads", { selector: "span.truncate" }).closest("button") as HTMLElement);
    expect(useNavigation.getState().view).toEqual({ name: "downloads" });
  });

  it("shows playlists under a Playlists heading with the song count", () => {
    useLibrary.setState({
      playlists: [
        { id: "a", name: "Road", folderId: null, pinned: false, tracks: [] },
      ],
      folders: [],
    });
    render(<LibraryView />);
    const section = within(screen.getByRole("region", { name: "Playlists" }));
    expect(section.getByRole("heading", { name: "Playlists" })).toBeTruthy();
    expect(section.getByText("Road")).toBeTruthy();
    expect(section.getByText("Playlist · 0 songs")).toBeTruthy();
  });

  it("marks a pinned playlist with a pin glyph and a Pinned label for screen readers", () => {
    useLibrary.setState({
      playlists: [{ id: "a", name: "Road", folderId: null, pinned: true, tracks: [song(1), song(2)] }],
      folders: [],
    });
    render(<LibraryView />);
    const tile = screen.getByRole("button", { name: /Road/ });
    expect(within(tile).getByText("Pinned,")).toBeTruthy();
    expect(within(tile).getByText("Playlist · 2 songs")).toBeTruthy();
    expect(tile.querySelector("svg")).toBeTruthy();
    const section = within(screen.getByRole("region", { name: "Playlists" }));
    expect(section.queryByText("Start one with songs you like")).toBeTruthy();
  });

  it("draws the grid by default with an outlined New playlist tile at the end", () => {
    useLibrary.setState({
      playlists: [{ id: "a", name: "Road", folderId: null, pinned: false, tracks: [] }],
      folders: [],
    });
    render(<LibraryView />);
    const section = screen.getByRole("region", { name: "Playlists" });
    const list = section.querySelector("ul");
    expect(list?.className).toContain("grid-cols-2");
    const newPlaylist = within(section).getByRole("button", { name: /New playlist/ });
    expect(newPlaylist.querySelector(".border-line.bg-surface.text-accent")).toBeTruthy();
    expect(list?.lastElementChild?.contains(newPlaylist)).toBe(true);
  });

  it("switches to rows and back, and keeps the choice in the device settings", () => {
    render(<LibraryView />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to list view" }));
    expect(useSettings.getState().libraryLayout).toBe("list");
    expect(screen.getByRole("button", { name: "Switch to grid view" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Playlists" }).querySelector("ul")?.className ?? "").not.toContain(
      "grid-cols-2",
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch to grid view" }));
    expect(useSettings.getState().libraryLayout).toBe("grid");
  });

  it("renders the saved list layout on mount", () => {
    useSettings.setState({ libraryLayout: "list" });
    render(<LibraryView />);
    expect(screen.getByRole("button", { name: "Switch to grid view" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Liked Songs/ }).closest("li")?.parentElement?.className ?? "").not.toContain(
      "grid-cols-2",
    );
  });
});
