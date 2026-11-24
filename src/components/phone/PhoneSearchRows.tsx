import { ActionMenu } from "../ActionMenu";
import { ExplicitBadge } from "../ExplicitBadge";
import { openMenuAtPointer, openMenuFromKey } from "../ContextMenu";
import { Artwork, TYPE_LABEL } from "../SearchRows";
import { browseMenuItems } from "../../lib/browseActions";
import { normalizeCredit } from "../../lib/credits";
import { openBrowse, playSong } from "../../lib/searchActions";
import { trackMenuItems } from "../../lib/trackActions";
import { joinSubtitle } from "../../lib/subtitle";
import type { BrowseItem, SearchSong } from "../../lib/searchParse";
import { currentTrack, usePlayer } from "../../stores/player";
import { EqBars } from "../EqBars";
import { reducedMotion } from "../../lib/motion";
import { usePageVisible } from "../../lib/usePageVisible";

const ROW =
  "flex h-14 w-full min-w-0 items-center gap-3 text-left motion-safe:transition-opacity motion-safe:duration-press active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

const FEATURED_ROW =
  "flex w-full min-w-0 items-center gap-4 text-left motion-safe:transition-opacity motion-safe:duration-press active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

const ICON_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 motion-safe:transition-colors hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function PhoneBrowseRow({ item, query, featured = false }: { item: BrowseItem; query: string; featured?: boolean }) {
  const menu = () => browseMenuItems(item);
  const artist = item.type === "artist";
  return (
    <button
      type="button"
      onClick={() => openBrowse(item, query)}
      onContextMenu={(event) => openMenuAtPointer(event, menu)}
      onKeyDown={(event) => void openMenuFromKey(event, menu)}
      className={featured ? FEATURED_ROW : ROW}
    >
      <Artwork
        src={item.thumb}
        round={artist}
        size={featured ? "h-16 w-16" : "h-12 w-12"}
        radius={artist ? undefined : featured ? "rounded-[10px]" : "rounded-[6px]"}
      />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-ink-1 ${featured ? "text-card-title leading-[22px] font-semibold" : "text-body leading-[22px] font-normal"}`}>
          {item.title}
        </span>
        <span className="block truncate text-meta leading-[18px] text-ink-2">{joinSubtitle(TYPE_LABEL[item.type], item.subtitle)}</span>
      </span>
    </button>
  );
}

export function PhoneTopSong({ song, query }: { song: SearchSong; query: string }) {
  return (
    <button type="button" onClick={() => playSong(song, query)} className={FEATURED_ROW}>
      <Artwork src={song.thumb} size="h-16 w-16" radius="rounded-[10px]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-card-title leading-[22px] font-semibold text-ink-1">{song.title}</span>
        {song.artist && <span className="block truncate text-meta leading-[18px] text-ink-2">{normalizeCredit(song.artist)}</span>}
      </span>
    </button>
  );
}

export function PhoneTrackRow({ song, query }: { song: SearchSong; query: string }) {
  const currentId = usePlayer((state) => currentTrack(state)?.id);
  const current = currentId === song.id;
  const playing = usePlayer((state) => state.playing);
  const visible = usePageVisible();
  const animate = current && playing && visible && !reducedMotion();
  const menu = () => trackMenuItems(song);
  return (
    <li
      onContextMenu={(event) => openMenuAtPointer(event, menu)}
      onKeyDown={(event) => void openMenuFromKey(event, menu)}
      className="flex h-14 items-center"
    >
      <button
        type="button"
        aria-current={current ? "true" : undefined}
        onClick={() => playSong(song, query)}
        className="flex h-full min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span aria-hidden="true" className="relative block size-12 shrink-0">
          <Artwork src={song.thumb} size="h-12 w-12" radius="rounded-[6px]" />
          {current && (
            <span aria-hidden="true" className="absolute inset-0 grid place-items-center rounded-[6px] bg-scrim/40 text-on-scrim">
              <EqBars playing={animate} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            title={song.title}
            className={`flex min-w-0 items-center text-body leading-[22px] ${current ? "font-medium text-accent" : "font-normal text-ink-1"}`}
          >
            {song.explicit && <ExplicitBadge />}
            <span className="truncate">{song.title}</span>
          </span>
          {song.artist && (
            <span className="block truncate text-meta leading-[18px] text-ink-2">{normalizeCredit(song.artist)}</span>
          )}
        </span>
      </button>
      <ActionMenu items={menu} label={`More options for ${song.title}`} triggerClass={ICON_BUTTON} />
    </li>
  );
}
