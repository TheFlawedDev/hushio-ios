import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RadioItem, RadioPage } from "./innertube";
import type { Track } from "../types";

const { getRadio, homeTracks } = vi.hoisted(() => ({ getRadio: vi.fn(), homeTracks: vi.fn() }));

vi.mock("./innertube", () => ({ getRadio }));
vi.mock("./home", () => ({ homeTracks }));

import {
  artistKey,
  exclusionsFor,
  fetchRefill,
  fetchSuggestions,
  isRadioSeed,
  normalizeTitle,
  pickSuggestions,
  recordingKey,
} from "./autoplay";

const vid = (n: number) => `v${String(n).padStart(10, "0")}`;

const item = (n: number, overrides: Partial<RadioItem> = {}): RadioItem => ({
  id: vid(n),
  title: `Song ${n}`,
  artist: `Artist ${n}`,
  artistId: `UC${n}`,
  thumb: `https://img.example/${n}.jpg`,
  duration: 200,
  explicit: false,
  videoType: "song",
  ...overrides,
});

const NO_EXCLUSIONS = { excludeIds: new Set<string>(), excludeKeys: new Set<string>() };
const options = (overrides: Partial<Parameters<typeof pickSuggestions>[1]> = {}) => ({
  ...NO_EXCLUSIONS,
  limit: 25,
  seed: null,
  ...overrides,
});
const ids = (tracks: Track[]) => tracks.map((track) => track.id);

describe("normalizeTitle", () => {
  it("drops a bracketed tag that is not a version word", () => {
    expect(normalizeTitle("Blinding Lights (Official Video)")).toBe("blinding lights");
    expect(normalizeTitle("Song [Lyrics]")).toBe("song");
  });

  it("keeps bracketed version words so a remix is a different recording", () => {
    expect(normalizeTitle("Song (Live at Wembley)")).toBe("song live at wembley");
    expect(normalizeTitle("Song (Acoustic)")).not.toBe(normalizeTitle("Song"));
  });

  it("drops a trailing dash tag and a trailing featuring credit", () => {
    expect(normalizeTitle("Song - Official Music Video")).toBe("song");
    expect(normalizeTitle("Song - from the film")).toBe("song");
    expect(normalizeTitle("Song feat. Someone Else")).toBe("song");
    expect(normalizeTitle("Song ft. Someone")).toBe("song");
  });

  it("folds width and punctuation", () => {
    expect(normalizeTitle("Ｈｅｌｌｏ, World!")).toBe("hello world");
  });
});

describe("artistKey and recordingKey", () => {
  it("keeps only the first credited artist", () => {
    expect(artistKey("Daft Punk, Pharrell Williams")).toBe("daft punk");
    expect(artistKey("Simon & Garfunkel")).toBe("simon");
    expect(artistKey("Jay x Kay")).toBe("jay");
    expect(artistKey("Alpha feat. Beta")).toBe("alpha");
    expect(artistKey("Gamma ft. Delta")).toBe("gamma");
  });

  it("builds the same key for an official video and the plain song", () => {
    const plain = recordingKey({ title: "Song", artist: "Artist" });
    const video = recordingKey({ title: "Song (Official Video)", artist: "Artist, Other" });
    expect(video).toBe(plain);
  });

  it("gives no key when the title is empty after normalising", () => {
    expect(recordingKey({ title: "(Official)", artist: "Artist" })).toBeNull();
  });
});

describe("isRadioSeed", () => {
  it("accepts only bare 11-character YouTube ids", () => {
    expect(isRadioSeed("dQw4w9WgXcQ")).toBe(true);
    expect(isRadioSeed("local-file")).toBe(false);
    expect(isRadioSeed("")).toBe(false);
  });
});

describe("pickSuggestions", () => {
  it("drops excluded ids, podcast episodes, and songs shorter than 60 s or longer than 900 s", () => {
    const candidates = [
      item(1),
      item(2),
      item(3, { videoType: "episode" }),
      item(4, { duration: 59 }),
      item(5, { duration: 901 }),
      item(6, { duration: 0 }),
    ];
    const picks = pickSuggestions(candidates, options({ excludeIds: new Set([vid(2)]) }));
    expect(ids(picks)).toEqual([vid(1), vid(6)]);
  });

  it("returns only the track fields", () => {
    const [pick] = pickSuggestions([item(1, { duration: 120, explicit: true })], options());
    // `duration` is kept: without it the player cannot know the real song length.
    expect(pick).toEqual({
      id: vid(1),
      title: "Song 1",
      artist: "Artist 1",
      thumb: `https://img.example/1.jpg`,
      duration: 120,
    });
  });

  it("keeps one copy of a recording that appears as an official video and as the song", () => {
    const candidates = [
      item(1, { title: "Hello", artist: "Adele" }),
      item(2, { title: "Hello (Official Video)", artist: "Adele" }),
    ];
    expect(ids(pickSuggestions(candidates, options()))).toEqual([vid(1)]);
  });

  it("does not repeat an id twice in one batch", () => {
    expect(ids(pickSuggestions([item(1), item(1)], options()))).toEqual([vid(1)]);
  });

  it("skips recordings already excluded by the session", () => {
    const played = exclusionsFor([{ id: "played-1", title: "Hello", artist: "Adele", thumb: null }]);
    const candidates = [item(9, { title: "Hello (Official Video)", artist: "Adele", artistId: "UCadele" })];
    expect(pickSuggestions(candidates, options(played))).toEqual([]);
  });

  it("keeps a live version separate from the studio song", () => {
    const candidates = [item(1, { title: "Hello", artist: "Adele" }), item(2, { title: "Hello (Live)", artist: "Adele" })];
    expect(ids(pickSuggestions(candidates, options()))).toEqual([vid(1), vid(2)]);
  });

  it("allows two songs per artist", () => {
    const candidates = [1, 2, 3].map((n) => item(n, { artist: "Solo", artistId: "UCsolo" }));
    expect(ids(pickSuggestions(candidates, options()))).toEqual([vid(1), vid(2)]);
  });

  it("allows three songs from the seed artist, matched by artist id", () => {
    const candidates = [1, 2, 3, 4].map((n) => item(n, { artist: "Seed", artistId: "UCseed" }));
    const seed = { title: "Seed", artist: "Other name", artistId: "UCseed", thumb: null, duration: 0 };
    expect(ids(pickSuggestions(candidates, options({ seed })))).toEqual([vid(1), vid(2), vid(3)]);
  });

  it("matches the seed artist by normalised name when the id is missing", () => {
    const candidates = [1, 2, 3, 4].map((n) => item(n, { artist: "Seed Band", artistId: null }));
    const seed = { title: "Seed", artist: "seed band, guest", artistId: null, thumb: null, duration: 0 };
    expect(ids(pickSuggestions(candidates, options({ seed })))).toEqual([vid(1), vid(2), vid(3)]);
  });

  it("stops at the limit", () => {
    const candidates = [1, 2, 3, 4].map((n) => item(n));
    expect(pickSuggestions(candidates, options({ limit: 2 }))).toHaveLength(2);
  });

  it("keeps AutoPlay on song recordings even when fewer than three are available", () => {
    const songs = [item(1), item(2)];
    const videos = [item(3, { videoType: "video" }), item(4, { videoType: "video" })];
    expect(ids(pickSuggestions([...videos, ...songs], options()))).toEqual([vid(1), vid(2)]);

    const enough = [item(1), item(2), item(3)];
    expect(ids(pickSuggestions([...videos, ...enough], options()))).toEqual([vid(1), vid(2), vid(3)]);
  });

  it("never silently falls back to video or upload audio", () => {
    const upload = item(5, { videoType: "upload" });
    expect(ids(pickSuggestions([upload, item(6, { videoType: "video" })], options()))).toEqual([]);
    expect(ids(pickSuggestions([upload], options()))).toEqual([]);
  });
});

describe("fetchSuggestions", () => {
  beforeEach(() => {
    getRadio.mockReset();
  });

  const page = (items: RadioItem[], continuation: string | null = null, seed: RadioPage["seed"] = null): RadioPage => ({
    items,
    seed,
    continuation,
  });

  it("reads further radio pages with the continuation token until one yields picks", async () => {
    const exclusions = { ...NO_EXCLUSIONS, excludeIds: new Set([vid(1)]) };
    getRadio.mockResolvedValueOnce(page([item(1)], "tok-2")).mockResolvedValueOnce(page([item(2)]));

    const picks = await fetchSuggestions([vid(0)], exclusions, 10);

    expect(ids(picks)).toEqual([vid(2)]);
    expect(getRadio).toHaveBeenNthCalledWith(1, vid(0), undefined);
    expect(getRadio).toHaveBeenNthCalledWith(2, vid(0), "tok-2");
  });

  it("stops without a token and returns nothing when every page is empty", async () => {
    getRadio.mockResolvedValueOnce(page([item(1)], null));
    expect(await fetchSuggestions([vid(0)], { ...NO_EXCLUSIONS, excludeIds: new Set([vid(1)]) }, 10)).toEqual([]);
    expect(getRadio).toHaveBeenCalledTimes(1);
  });

  it("gives up after three pages", async () => {
    getRadio.mockResolvedValue(page([], "more"));
    expect(await fetchSuggestions([vid(0)], NO_EXCLUSIONS, 10)).toEqual([]);
    expect(getRadio).toHaveBeenCalledTimes(3);
  });

  it("falls back to the next seed when the first one yields nothing", async () => {
    getRadio.mockResolvedValueOnce(null).mockResolvedValueOnce(page([item(3)]));
    const picks = await fetchSuggestions([vid(1), vid(2)], NO_EXCLUSIONS, 10);
    expect(ids(picks)).toEqual([vid(3)]);
    expect(getRadio).toHaveBeenNthCalledWith(2, vid(2), undefined);
  });

  it("never asks for radio from a local file id", async () => {
    expect(await fetchSuggestions(["local-file"], NO_EXCLUSIONS, 10)).toEqual([]);
    expect(getRadio).not.toHaveBeenCalled();
  });

  it("calls each seed once when it is listed twice", async () => {
    getRadio.mockResolvedValue(null);
    await fetchSuggestions([vid(1), vid(1)], NO_EXCLUSIONS, 10);
    expect(getRadio).toHaveBeenCalledTimes(1);
  });
});

describe("seed exclusion in radio", () => {
  beforeEach(() => {
    getRadio.mockReset();
  });

  it("never returns the seed song from its own radio", async () => {
    getRadio.mockResolvedValueOnce({ items: [item(0), item(1)], seed: null, continuation: null });
    const exclusions = exclusionsFor([{ id: vid(0), title: "Song 0", artist: "Artist 0", thumb: null }]);

    expect(ids(await fetchSuggestions([vid(0)], exclusions, 10))).toEqual([vid(1)]);
  });
});

describe("fetchRefill home fallback", () => {
  const homePool = (count: number): Track[] =>
    Array.from({ length: count }, (_, n) => ({ id: vid(100 + n), title: `Home ${n}`, artist: `Home artist ${n}`, thumb: null }));

  beforeEach(() => {
    getRadio.mockReset();
    homeTracks.mockReset();
    homeTracks.mockResolvedValue([]);
  });

  it("keeps radio picks and skips Home when radio has songs", async () => {
    getRadio.mockResolvedValueOnce({ items: [item(1)], seed: null, continuation: null });

    expect(ids(await fetchRefill([vid(0)], NO_EXCLUSIONS, 10))).toEqual([vid(1)]);
    expect(homeTracks).not.toHaveBeenCalled();
  });

  it("fills from the Home songs when radio is empty, at most ten", async () => {
    getRadio.mockResolvedValueOnce({ items: [], seed: null, continuation: null });
    homeTracks.mockResolvedValue(homePool(15));

    const picks = await fetchRefill([vid(0)], NO_EXCLUSIONS, 25);

    expect(picks).toHaveLength(10);
    const poolIds = new Set(homePool(15).map((track) => track.id));
    expect(picks.every((track) => poolIds.has(track.id))).toBe(true);
  });

  it("respects the session exclusions when using Home songs", async () => {
    getRadio.mockResolvedValueOnce(null);
    const pool = homePool(4);
    homeTracks.mockResolvedValue([...pool, { id: vid(200), title: "Played", artist: "Someone", thumb: null }]);
    const exclusions = { excludeIds: new Set([pool[0]!.id, pool[1]!.id]), excludeKeys: new Set<string>() };

    const picked = ids(await fetchRefill([vid(0)], exclusions, 10));
    expect(picked.sort()).toEqual([pool[2]!.id, pool[3]!.id, vid(200)].sort());
  });

  it("returns nothing when radio and Home are both empty", async () => {
    getRadio.mockResolvedValueOnce(null);

    expect(await fetchRefill([vid(0)], NO_EXCLUSIONS, 10)).toEqual([]);
  });

  it("does not use Home for start radio", async () => {
    getRadio.mockResolvedValueOnce(null);
    homeTracks.mockResolvedValue(homePool(5));

    expect(await fetchSuggestions([vid(0)], NO_EXCLUSIONS, 10)).toEqual([]);
    expect(homeTracks).not.toHaveBeenCalled();
  });
});
