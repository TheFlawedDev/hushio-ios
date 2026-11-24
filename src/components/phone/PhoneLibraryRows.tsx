import { useState, type ReactNode } from "react";
import { Heart, PushPin, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { focusRing } from "../HomeShelves";
import { thumbArtwork } from "../../lib/artwork";
import { pressTap, reducedMotion } from "../../lib/motion";
import type { Point } from "../../lib/touchGesture";
import { PhoneIcon } from "./PhoneIcon";
import { PressRow } from "./PressRow";
import { useCardLongPress } from "./useCardLongPress";

function CoverImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      decoding="async"
      src={src}
      alt=""
      loading="lazy"
      onLoad={() => setLoaded(true)}
      className={`size-full object-cover motion-safe:transition-opacity motion-safe:duration-reading ${loaded ? "opacity-100" : "opacity-0"}`}
    />
  );
}

const TILE_PIXELS = 120;
const TILE_ART_PIXELS = 320;
const TILE_SHAPE = "relative aspect-square w-full overflow-hidden rounded-[10px] [corner-shape:squircle]";
const TILE_SPRING = { type: "spring", stiffness: 520, damping: 34 } as const;

type PhoneCollageProps = {
  covers: string[];
  fallback: PhosphorIcon;
  sizeClass: string;
  radiusClass: string;
};

export function PhoneCollage({ covers, fallback, sizeClass, radiusClass }: PhoneCollageProps) {
  const urls = covers
    .map((cover) => thumbArtwork(cover, TILE_PIXELS))
    .filter((url) => url !== "")
    .slice(0, 4);
  const shape = `${sizeClass} relative shrink-0 overflow-hidden bg-elevated text-ink-1 ${radiusClass} [corner-shape:squircle]`;
  if (urls.length === 0) {
    return (
      <span aria-hidden="true" className={`${shape} grid place-items-center`}>
        <PhoneIcon icon={fallback} />
      </span>
    );
  }
  if (urls.length < 4) {
    return (
      <span aria-hidden="true" className={shape}>
        <CoverImage key={urls[0]} src={urls[0]} />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${shape} grid grid-cols-2 grid-rows-2`}>
      {urls.map((url) => (
        <CoverImage key={url} src={url} />
      ))}
    </span>
  );
}

function PinnedSubtitle({ pinned, text }: { pinned?: boolean; text: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      {pinned && (
        <>
          <span className="sr-only">Pinned, </span>
          <span aria-hidden="true" className="inline-flex shrink-0">
            <PhoneIcon icon={PushPin} size={12} fill="currentColor" />
          </span>
        </>
      )}
      <span className="truncate">{text}</span>
    </span>
  );
}

type PhoneLibraryRowProps = {
  title: string;
  subtitle: string;
  pinned?: boolean;
  art: ReactNode;
  onOpen: () => void;
  onLongPress?: (point: Point) => void;
};

export function PhoneLibraryRow({ title, subtitle, pinned, art, onOpen, onLongPress }: PhoneLibraryRowProps) {
  return (
    <PressRow className="h-16" contentClassName="gap-3" onPress={onOpen} onLongPress={onLongPress}>
      {art}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body leading-[22px] text-ink-1">{title}</span>
        <span className="block text-meta leading-[18px] tabular-nums text-ink-2">
          <PinnedSubtitle pinned={pinned} text={subtitle} />
        </span>
      </span>
    </PressRow>
  );
}

const TILE_ICON_SIZE = 40;

type TileArtProps = {
  covers: string[];
  fallback: PhosphorIcon;
  heart?: boolean;
  outlined?: boolean;
};

function TileArt({ covers, fallback, heart, outlined }: TileArtProps) {
  if (heart) {
    return (
      <span aria-hidden="true" className={`${TILE_SHAPE} grid place-items-center bg-accent text-on-accent`}>
        <PhoneIcon icon={Heart} size={TILE_ICON_SIZE} fill="currentColor" />
      </span>
    );
  }
  const urls = covers
    .map((cover) => thumbArtwork(cover, TILE_ART_PIXELS))
    .filter((url) => url !== "")
    .slice(0, 4);
  if (outlined || urls.length === 0) {
    return (
      <span
        aria-hidden="true"
        className={`${TILE_SHAPE} grid place-items-center text-accent ${outlined ? "border border-line bg-surface" : "bg-wash"}`}
      >
        <PhoneIcon icon={fallback} size={TILE_ICON_SIZE} />
      </span>
    );
  }
  if (urls.length < 4) {
    return (
      <span aria-hidden="true" className={`${TILE_SHAPE} bg-wash`}>
        <CoverImage key={urls[0]} src={urls[0]} />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${TILE_SHAPE} grid grid-cols-2 grid-rows-2 bg-wash`}>
      {urls.map((url) => (
        <CoverImage key={url} src={url} />
      ))}
    </span>
  );
}

type PhoneLibraryTileProps = TileArtProps & {
  title: string;
  subtitle: string;
  pinned?: boolean;
  onOpen: () => void;
  onLongPress?: (point: Point) => void;
};

export function PhoneLibraryTile({ title, subtitle, pinned, covers = [], fallback, heart, outlined, onOpen, onLongPress }: PhoneLibraryTileProps) {
  const reduced = reducedMotion();
  const hold = useCardLongPress(onLongPress);

  return (
    <motion.button
      type="button"
      {...hold.bind}
      onClick={() => {
        if (!hold.consumeHold()) onOpen();
      }}
      whileTap={pressTap(reduced)}
      transition={reduced ? { duration: 0 } : TILE_SPRING}
      className={`flex w-full min-w-0 flex-col rounded-[12px] text-left touch-pan-y select-none ${focusRing}`}
    >
      <TileArt covers={covers} fallback={fallback} heart={heart} outlined={outlined} />
      <span className="mt-2 block truncate text-body font-semibold leading-5 text-ink-1">{title}</span>
      <span className="mt-0.5 block text-meta leading-[18px] tabular-nums text-ink-2">
        <PinnedSubtitle pinned={pinned} text={subtitle} />
      </span>
    </motion.button>
  );
}

