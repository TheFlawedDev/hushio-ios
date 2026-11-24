import { homeTracks } from "./home";
import { getRadio, type RadioItem, type RadioSeed } from "./innertube";
import { randomSeed, seededShuffle } from "./queue";
import type { Track } from "../types";

export const MAX_TAIL = 25;
export const LOW_WATER = 5;
export const RETRY_AFTER_MS = 60_000;
export const AUTOPLAY_EMPTY_MESSAGE = "AutoPlay couldn't find more songs right now";

const MAX_PAGES = 3;
const HOME_FALLBACK_MAX = 10;
const PER_ARTIST = 2;
const SEED_ARTIST_CAP = 3;
const MIN_SONG_S = 60;
const MAX_SONG_S = 900;
const VERSION_WORDS = /remix|cover|live|acoustic|instrumental|unplugged|karaoke|slowed|reverb|sped|lo-?fi|version/i;
const BRACKETED = /[([【「][^)\]】」]*[)\]】」]/g;
const NON_WORD = /[^\p{L}\p{M}\p{N}]+/gu;

export type Exclusions = { excludeIds: ReadonlySet<string>; excludeKeys: ReadonlySet<string> };

export type PickOptions = Exclusions & { limit: number; seed: RadioSeed | null };

export function isRadioSeed(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(BRACKETED, (group) => (VERSION_WORDS.test(group) ? group : " "))
    .replace(/ - (?:official|lyrics|audio|video|visualiser|visualizer|from\b).*$/, "")
    .replace(/ (?:feat\.|ft\.|featuring\b).*$/, "")
    .replace(NON_WORD, " ")
    .trim();
}

export function artistKey(artist: string): string {
  const first = artist.normalize("NFKC").toLowerCase().split(/,|&| x | feat\.| ft\./)[0] ?? "";
  return first.replace(NON_WORD, " ").trim();
}

export function recordingKey(track: Pick<Track, "title" | "artist">): string | null {
  const title = normalizeTitle(track.title);
  return title ? `${title}|${artistKey(track.artist)}` : null;
}

export function exclusionsFor(tracks: readonly Track[]): Exclusions {
  const keys = tracks.map(recordingKey).filter((key): key is string => key !== null);
  return { excludeIds: new Set(tracks.map((track) => track.id)), excludeKeys: new Set(keys) };
}

function outsideSongLength(duration: number): boolean {
  return duration > 0 && (duration < MIN_SONG_S || duration > MAX_SONG_S);
}

function isSeedArtist(candidate: RadioItem, seed: RadioSeed | null): boolean {
  if (!seed) return false;
  if (seed.artistId !== null && candidate.artistId === seed.artistId) return true;
  return artistKey(candidate.artist) === artistKey(seed.artist);
}

export function pickSuggestions(candidates: readonly RadioItem[], options: PickOptions): Track[] {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.id !== "" &&
      !options.excludeIds.has(candidate.id) &&
      candidate.videoType !== "episode" &&
      !outsideSongLength(candidate.duration),
  );
  const songs = eligible.filter((candidate) => candidate.videoType !== "video" && candidate.videoType !== "upload");

  const picked: RadioItem[] = [];
  const pickedIds = new Set<string>();
  const pickedKeys = new Set<string>();
  const perArtist = new Map<string, number>();

  const take = (pool: readonly RadioItem[]) => {
    for (const candidate of pool) {
      if (picked.length >= options.limit) return;
      const key = recordingKey(candidate);
      if (pickedIds.has(candidate.id)) continue;
      if (key !== null && (options.excludeKeys.has(key) || pickedKeys.has(key))) continue;
      const artist = artistKey(candidate.artist);
      const cap = isSeedArtist(candidate, options.seed) ? SEED_ARTIST_CAP : PER_ARTIST;
      if ((perArtist.get(artist) ?? 0) >= cap) continue;

      picked.push(candidate);
      pickedIds.add(candidate.id);
      if (key !== null) pickedKeys.add(key);
      perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
    }
  };

  take(songs);

  // `duration` is what tells the player how long the song really is. These picks used to
  // drop it, so every autoplay/radio track played with no known length and the native
  // engine fell back to the container's length — which is inflated for the fragmented
  // MP4 streams served by the CDN (see docs/ios-port/BUGFIX_LOG.md C7).
  return picked.map(({ id, title, artist, thumb, duration }) => ({ id, title, artist, thumb, duration }));
}

async function radioPicks(seedId: string, exclusions: Exclusions, limit: number): Promise<Track[]> {
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const radio = await getRadio(seedId, token);
    if (!radio) return [];
    const picks = pickSuggestions(radio.items, { ...exclusions, limit, seed: radio.seed });
    if (picks.length > 0) return picks;
    if (!radio.continuation) return [];
    token = radio.continuation;
  }
  return [];
}

async function homePicks(exclusions: Exclusions, limit: number): Promise<Track[]> {
  const pool = seededShuffle(await homeTracks(), randomSeed());
  // Keep whatever length the home feed supplied: a track without one plays with the
  // container's (inflated) length instead of the real song length.
  const candidates = pool.map((track) => ({
    ...track,
    artistId: null,
    duration: track.duration ?? 0,
    explicit: false,
    videoType: "song" as const,
  }));
  return pickSuggestions(candidates, { ...exclusions, limit: Math.min(limit, HOME_FALLBACK_MAX), seed: null });
}

export async function fetchSuggestions(seedIds: readonly string[], exclusions: Exclusions, limit: number): Promise<Track[]> {
  for (const seedId of new Set(seedIds)) {
    if (!isRadioSeed(seedId)) continue;
    const picks = await radioPicks(seedId, exclusions, limit);
    if (picks.length > 0) return picks;
  }
  return [];
}

export async function fetchRefill(seedIds: readonly string[], exclusions: Exclusions, limit: number): Promise<Track[]> {
  const picks = await fetchSuggestions(seedIds, exclusions, limit);
  return picks.length > 0 ? picks : homePicks(exclusions, limit);
}
