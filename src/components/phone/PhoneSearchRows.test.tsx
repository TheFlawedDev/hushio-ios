import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const phone = vi.hoisted(() => ({ value: true }));

vi.mock("../../lib/usePhone", () => ({ usePhone: () => phone.value }));
vi.mock("../../lib/persist", () => ({
  persistStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

import { Artwork } from "../SearchRows";
import { PhoneTrackRow } from "./PhoneSearchRows";
import type { SearchSong } from "../../lib/searchParse";
import { usePlayer } from "../../stores/player";

const ART = "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj";

const song: SearchSong = {
  id: "s1",
  title: "Physical",
  artist: "Dua Lipa",
  thumb: ART,
  artistId: null,
  albumId: null,
  album: null,
  duration: 203,
  explicit: false,
  isVideo: false,
};

describe("Artwork on the phone", () => {
  beforeEach(() => {
    phone.value = true;
  });

  afterEach(cleanup);

  it("falls back to the note icon when the thumbnail fails to load", () => {
    const { container } = render(<Artwork src={ART} size="h-12 w-12" radius="rounded-[8px]" />);

    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span.h-12")).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("keeps the image when no error happens", () => {
    const { container } = render(<Artwork src={ART} size="h-12 w-12" radius="rounded-[8px]" />);

    expect(container.querySelector("img")?.getAttribute("src")).toBe(ART);
    expect(container.querySelector("img")?.className).toContain("rounded-[8px]");
  });

  it("leaves the desktop image alone when it fails", () => {
    phone.value = false;
    const { container } = render(<Artwork src={ART} />);

    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    expect(container.querySelector("img")).not.toBeNull();
  });
});

describe("PhoneTrackRow", () => {
  afterEach(cleanup);

  it("renders a 56px row with a 48px cover and a single 44px more button", () => {
    render(
      <ul>
        <PhoneTrackRow song={song} query="dua" />
      </ul>,
    );

    expect(screen.getByRole("listitem").className).toContain("h-14");
    expect(screen.queryByRole("button", { name: "Like" })).toBeNull();
    expect(screen.getByRole("button", { name: "More options for Physical" }).className).toContain("h-11 w-11");
    expect(screen.getByRole("button", { name: /^Physical/ }).querySelector("img")?.className).toContain("h-12 w-12");
  });

  it("exposes song title and artist in accessible name and sets aria-current when playing", () => {
    usePlayer.setState({
      queue: [{ id: song.id, title: song.title, artist: song.artist, thumb: song.thumb, duration: song.duration, album: null }],
      index: 0,
      playing: true,
    });

    const { rerender } = render(
      <ul>
        <PhoneTrackRow song={song} query="dua" />
      </ul>,
    );

    const playingButton = screen.getByRole("button", { name: "Physical Dua Lipa" });
    expect(playingButton).toBeTruthy();
    expect(playingButton.getAttribute("aria-current")).toBe("true");

    usePlayer.setState({ queue: [], index: 0, playing: false });
    rerender(
      <ul>
        <PhoneTrackRow song={song} query="dua" />
      </ul>,
    );

    const idleButton = screen.getByRole("button", { name: "Physical Dua Lipa" });
    expect(idleButton.getAttribute("aria-current")).toBeNull();
  });
});
