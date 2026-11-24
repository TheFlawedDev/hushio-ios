import { useState, type MouseEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { HeartBurst } from "../motion/HeartBurst";
import { Heart, DotsThree, ListPlus, SpeakerHigh } from "@phosphor-icons/react";
import { ActionMenu } from "../ActionMenu";
import { openMenuAtPointer, openMenuFromKey, resolveMenu, type MenuSource } from "../ContextMenu";
import { EqBars } from "../EqBars";
import { ExplicitBadge } from "../ExplicitBadge";
import { PhoneIcon } from "./PhoneIcon";
import { PhoneArt } from "./PhoneArt";
import { PressRow } from "./PressRow";
import { SwipeRow } from "./SwipeRow";
import type { RowAction } from "./useSwipeRow";
import { thumbArtwork } from "../../lib/artwork";
import { normalizeCredit } from "../../lib/credits";
import { gate, phoneSnappy, reducedMotion, settle } from "../../lib/motion";
import { LONG_HOLD_MS } from "../../lib/phoneGestures";
import type { SearchSong } from "../../lib/searchParse";
import type { Point } from "../../lib/touchGesture";
import { usePageVisible } from "../../lib/usePageVisible";
import { trackToastOptions } from "../../lib/toastStack";
import type { SortableRowProps } from "../../lib/useSortable";
import { useLibrary } from "../../stores/library";
import { usePlayer } from "../../stores/player";
import { useUI } from "../../stores/ui";
import type { Track } from "../../types";
import { prefetchTrack } from "../../lib/prefetch";

export const PHONE_ROW_DP = 60;
const ROW_THUMB_TARGET = 48;

type PhoneTrackRowProps = {
  track: Track;
  index: number;
  active?: boolean;
  dragOffset?: number;
  dragging?: boolean;
  onPress: () => void;
  onLongPress?: (point: Point) => void;
  onMore: (event: MouseEvent<HTMLButtonElement>) => void;
  swipeLeft?: RowAction;
  swipeRight?: RowAction;
  handle?: ReactNode;
};

export function PhoneTrackRow({
  track,
  index,
  active = false,
  dragOffset = 0,
  dragging = false,
  onPress,
  onLongPress,
  onMore,
  swipeLeft,
  swipeRight,
  handle,
}: PhoneTrackRowProps) {
  const reduced = reducedMotion();
  const liftTransition = { y: { duration: 0 }, scale: gate(reduced, phoneSnappy) };
  return (
    <motion.div
      data-index={index}
      animate={{ y: dragOffset, scale: dragging && !reduced ? 1.02 : 1 }}
      transition={dragging ? liftTransition : gate(reduced, settle)}
      className={dragging ? "relative z-10 rounded-[10px] bg-base" : ""}
      style={{ height: PHONE_ROW_DP, boxShadow: dragging ? "var(--shadow-held)" : undefined }}
    >
      <SwipeRow swipeLeft={swipeLeft} swipeRight={swipeRight} enabled={!dragging}>
        <div className="flex h-full items-center">
          <PressRow
            // Composed from the row's metadata (audit P1 #3): an override that named only the
            // title silenced the artist; dropping the override lost the action verb.
            label={`Play ${track.title}${track.artist ? ` by ${track.artist}` : ""}`}
            aria-current={active ? "true" : undefined}
            className="h-full min-w-0 flex-1 pl-4 pr-1"
            contentClassName="gap-3"
            onPress={onPress}
            onLongPress={onLongPress}
            longPressMs={LONG_HOLD_MS}
          >
            <PhoneArt src={thumbArtwork(track.thumb, ROW_THUMB_TARGET) || null} radius="rounded-[6px]" className="block size-12 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate text-body font-medium leading-5 text-ink-1">{track.title}</span>
              <span className="truncate text-meta leading-[18px] text-ink-2">{track.artist}</span>
            </span>
            {active && (
              <span aria-hidden="true" className="shrink-0 text-ink-1">
                <PhoneIcon icon={SpeakerHigh} />
              </span>
            )}
          </PressRow>
          {handle}
          <button
            type="button"
            aria-label={`More options for ${track.title}`}
            onClick={onMore}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-ink-2 motion-safe:transition-transform motion-safe:duration-press motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <PhoneIcon icon={DotsThree} />
          </button>
        </div>
      </SwipeRow>
    </motion.div>
  );
}

type PhoneSongRowProps = {
  index: number;
  song: SearchSong;
  current: boolean;
  playing: boolean;
  menu: MenuSource;
  onPlay: () => void;
  numbered?: boolean;
  showArtist?: boolean;
  rowProps?: SortableRowProps;
};

export function PhoneSongRow({
  index,
  song,
  current,
  playing,
  menu,
  onPlay,
  numbered = false,
  showArtist = true,
  rowProps,
}: PhoneSongRowProps) {
  const artist = song.artist ? normalizeCredit(song.artist) : "";
  const visible = usePageVisible();
  const animate = current && playing && visible && !reducedMotion();
  const liked = useLibrary((state) => state.liked.some((item) => item.id === song.id));
  const [burst, setBurst] = useState(0);
  const sortable = rowProps !== undefined;
  const swipeRight: RowAction = {
    label: "Add to queue",
    icon: ListPlus,
    run: () => {
      const added = usePlayer.getState().addToQueue([song]);
      useUI.getState().toast(added > 0 ? "Added to queue" : "Already in your queue", "info", undefined, undefined, trackToastOptions(song));
    },
  };
  const swipeLeft: RowAction = {
    label: liked ? "Unlike" : "Like",
    icon: Heart,
    tone: "accent",
    run: () => {
      useLibrary.getState().toggleLike(song);
      if (!liked) setBurst((count) => count + 1);
      useUI.getState().toast(liked ? "Removed from Liked Songs" : "Added to Liked Songs", "info", undefined, undefined, trackToastOptions(song));
    },
  };
  return (
    <li
      {...rowProps}
      onContextMenu={(event) => openMenuAtPointer(event, menu)}
      onKeyDown={(event) => {
        if (!openMenuFromKey(event, menu)) rowProps?.onKeyDown(event);
      }}
      className="h-14"
    >
      <SwipeRow swipeLeft={sortable ? undefined : swipeLeft} swipeRight={sortable ? undefined : swipeRight} enabled={!sortable}>
        <div className="flex h-full items-center">
          <PressRow
            label={`Play ${song.title}${song.artist ? ` by ${song.artist}` : ""}`}
            aria-current={current ? "true" : undefined}
            className="h-full min-w-0 flex-1"
            contentClassName="gap-3"
            onPress={onPlay}
            onPressStart={() => void prefetchTrack(song.id)}
            longPressMs={LONG_HOLD_MS}
            onLongPress={sortable ? undefined : (point) => useUI.getState().openContextMenu(point.x, point.y, resolveMenu(menu))}
          >
            {numbered ? (
              <span aria-hidden="true" className="flex w-6 shrink-0 justify-center text-meta tabular-nums text-ink-2">
                {current ? <EqBars playing={animate} /> : index + 1}
              </span>
            ) : (
              <PhoneArt src={thumbArtwork(song.thumb, ROW_THUMB_TARGET) || null} radius="rounded-[6px]" className="block size-12 shrink-0">
                {current && (
                  <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-scrim/40 text-on-scrim">
                    <EqBars playing={animate} />
                  </span>
                )}
              </PhoneArt>
            )}
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span
                title={song.title}
                className={`flex min-w-0 items-center text-body leading-[22px] ${current ? "font-medium text-accent" : "font-normal text-ink-1"}`}
              >
                {song.explicit && <ExplicitBadge />}
                <span className="truncate">{song.title}</span>
              </span>
              {showArtist && artist && <span className="truncate text-meta leading-[18px] text-ink-2">{artist}</span>}
            </span>
          </PressRow>
          {liked && (
            <span role="img" aria-label="Liked" className="relative grid size-6 shrink-0 place-items-center text-accent">
              <PhoneIcon icon={Heart} fill="currentColor" />
              {burst > 0 && !reducedMotion() && <HeartBurst key={burst} />}
            </span>
          )}
          <span data-no-drag className="flex shrink-0 items-center">
            <ActionMenu
              items={menu}
              label={`More options for ${song.title}`}
              triggerClass="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 motion-safe:transition-colors hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </span>
        </div>
      </SwipeRow>
    </li>
  );
}
