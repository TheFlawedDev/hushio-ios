import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, type AnimationPlaybackControls } from "motion/react";
import { X } from "@phosphor-icons/react";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { PhoneIcon } from "./PhoneIcon";
import { useSheetDrag } from "./useSheetDrag";
import { useArtTint } from "../../lib/palette";
import { useCountUp } from "../../lib/countUp";
import { plural } from "../../lib/plural";
import { PHONE_MS, fade, phoneSmooth, phoneTween, reducedMotion } from "../../lib/motion";
import { INSET_TOP } from "../../lib/phoneNav";
import {
  REPLAY_PERIODS,
  activeDayCount,
  dayPartShares,
  fmtHours,
  fmtMinutes,
  isThinHistory,
  peakHour,
  replayEmptyMessage,
  topDayPart,
  type ReplayData,
  type ReplayPeriod,
} from "../../lib/replay";
import type { ReplayLoad } from "../../lib/replayData";

const SLIDE_MS = 6000;
const HOLD_MS = 180;
const TAP_SLOP_PX = 10;
const BACK_SHARE_OF_SCREEN = 0.3;

export type StorySlide = "intro" | "songs" | "artists" | "time" | "share";

export function storySlides(data: ReplayData): StorySlide[] {
  const slides: StorySlide[] = ["intro"];
  if (data.tracks.length > 0) slides.push("songs");
  if (data.artists.length > 0) slides.push("artists");
  if (data.hours.some((value) => value > 0)) slides.push("time");
  slides.push("share");
  return slides;
}

type ReplayStoriesProps = {
  load: ReplayLoad;
  period: ReplayPeriod;
  label: string;
  onPeriod: (period: ReplayPeriod) => void;
  onRetry: () => void;
  onShare: () => void;
  onClose: () => void;
};

const stopPointer = (event: PointerEvent) => event.stopPropagation();

export function ReplayStories({ load, period, label, onPeriod, onRetry, onShare, onClose }: ReplayStoriesProps) {
  const reduced = reducedMotion();
  const ready = load.status === "ready" ? load.data : null;
  const thin = ready !== null && isThinHistory(ready);
  const slides = ready && !thin ? storySlides(ready) : [];
  const count = slides.length;
  const last = count - 1;
  const [index, setIndex] = useState(0);
  const at = Math.min(index, Math.max(last, 0));
  const [paused, setPaused] = useState(false);
  const progress = useMotionValue(0);
  const run = useRef<AnimationPlaybackControls | null>(null);
  const pausedRef = useRef(false);
  const press = useRef<{ x: number; y: number; held: boolean } | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const drag = useSheetDrag(onClose, () => "grab");
  const tint = useArtTint(ready?.tracks[0]?.thumb ?? "");

  useEffect(() => {
    if (count === 0) return;
    progress.set(0);
    if (reduced) {
      progress.set(1);
      return;
    }
    const isLast = at >= last;
    const timeline = animate(progress, 1, {
      duration: SLIDE_MS / 1000,
      ease: "linear",
      onComplete: () => {
        if (!isLast) setIndex(at + 1);
      },
    });
    run.current = timeline;
    if (pausedRef.current) timeline.pause();
    return () => timeline.stop();
  }, [at, count, last, reduced, progress]);

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) run.current?.pause();
    else run.current?.play();
  }, [paused]);

  const goForward = () => {
    if (count === 0) return;
    if (at >= last) onClose();
    else setIndex(at + 1);
  };

  const goBack = () => {
    if (count === 0 || at === 0) return;
    setIndex(at - 1);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") goForward();
      else if (event.key === "ArrowLeft") goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.handlers.onPointerDown?.(event);
    press.current = { x: event.clientX, y: event.clientY, held: false };
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      if (press.current) press.current.held = true;
      setPaused(true);
    }, HOLD_MS);
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    drag.handlers.onPointerMove?.(event);
  };

  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    drag.handlers.onPointerUp?.(event);
    window.clearTimeout(holdTimer.current);
    const start = press.current;
    press.current = null;
    if (!start) return;
    if (start.held) {
      setPaused(false);
      return;
    }
    if (Math.abs(event.clientX - start.x) > TAP_SLOP_PX || Math.abs(event.clientY - start.y) > TAP_SLOP_PX) return;
    if (event.clientX < window.innerWidth * BACK_SHARE_OF_SCREEN) goBack();
    else goForward();
  };

  const onCancel = (event: PointerEvent<HTMLDivElement>) => {
    drag.handlers.onPointerCancel?.(event);
    window.clearTimeout(holdTimer.current);
    press.current = null;
    setPaused(false);
  };

  const choose = (next: ReplayPeriod) => {
    setIndex(0);
    onPeriod(next);
  };

  let body: ReactNode;
  if (load.status === "loading") {
    body = <div aria-busy="true" aria-label="Loading your Replay" className="m-auto size-16 rounded-full bt-skeleton bg-white/15" />;
  } else if (load.status === "error") {
    body = (
      <div className="m-auto w-full" onPointerDown={stopPointer}>
        <ErrorState
          title="Replay couldn't load"
          message="Your listening stats couldn't be read."
          action={{ label: "Try again", onClick: onRetry }}
        />
      </div>
    );
  } else if (thin) {
    body = (
      <div className="m-auto flex w-full flex-col items-center gap-8">
        <EmptyState title="Not enough listening yet" message={replayEmptyMessage(period)} centered />
        <div onPointerDown={stopPointer}>
          <PeriodPills value={period} onChange={choose} />
        </div>
      </div>
    );
  } else if (ready) {
    const slide = slides[at];
    body = (
      <AnimatePresence initial={false}>
        <motion.section
          key={slide}
          aria-label={slideTitle(slide)}
          className="absolute inset-0 flex flex-col px-6 pb-10 pt-12"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={reduced ? fade : phoneSmooth}
        >
          {slide === "intro" && (
            <IntroSlide label={label} data={ready} period={period} onChoose={choose} />
          )}
          {slide === "songs" && <SongsSlide data={ready} />}
          {slide === "artists" && <ArtistsSlide data={ready} />}
          {slide === "time" && <TimeSlide hours={ready.hours} />}
          {slide === "share" && <ShareSlide onShare={onShare} />}
        </motion.section>
      </AnimatePresence>
    );
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Your Replay"
      className="fixed inset-0 z-[120] flex flex-col overflow-hidden bg-black text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? fade : phoneTween(PHONE_MS.scrim)}
    >
      <motion.div
        className="relative flex min-h-0 flex-1 touch-none flex-col"
        style={{ y: drag.y, backgroundColor: `rgb(${tint})` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/55" />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col" style={{ paddingTop: `calc(${INSET_TOP} + 10px)` }}>
          <div className="flex gap-1 px-3">
            {slides.map((slide, i) => (
              <span key={slide} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                <motion.span
                  className="absolute inset-0 origin-left bg-white"
                  style={{ scaleX: i < at ? 1 : i === at ? progress : 0 }}
                />
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 pt-2">
            <p className="text-body font-semibold text-white/85">Replay</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous slide"
                disabled={at === 0}
                onPointerDown={stopPointer}
                onClick={goBack}
                className="sr-only focus:not-sr-only focus:relative focus:z-20 focus:rounded-full focus:bg-white/20 focus:px-3 focus:py-1 focus:text-meta focus:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Previous slide
              </button>
              <button
                type="button"
                aria-label="Next slide"
                disabled={count === 0}
                onPointerDown={stopPointer}
                onClick={goForward}
                className="sr-only focus:not-sr-only focus:relative focus:z-20 focus:rounded-full focus:bg-white/20 focus:px-3 focus:py-1 focus:text-meta focus:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Next slide
              </button>
              <button
                type="button"
                aria-label="Close Replay"
                onPointerDown={stopPointer}
                onClick={onClose}
                className="grid size-11 place-items-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <PhoneIcon icon={X} />
              </button>
            </div>
          </div>
          {count > 0 && at < count && (
            <span className="sr-only" aria-live="polite" aria-atomic="true">
              {`Slide ${at + 1} of ${count}: ${slideTitle(slides[at])}`}
            </span>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col">{body}</div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function slideTitle(slide: StorySlide): string {
  switch (slide) {
    case "intro":
      return "Your Replay";
    case "songs":
      return "Top songs";
    case "artists":
      return "Top artists";
    case "time":
      return "Listening time";
    case "share":
      return "Share your Replay";
  }
}

function PeriodPills({ value, onChange }: { value: ReplayPeriod; onChange: (period: ReplayPeriod) => void }) {
  return (
    <div role="radiogroup" aria-label="Replay period" className="flex flex-wrap gap-2">
      {REPLAY_PERIODS.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(item.id)}
            className={`rounded-full px-3.5 py-2 text-meta font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
              selected ? "bg-white text-black" : "bg-white/15 text-white"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function IntroSlide({
  data,
  label,
  period,
  onChoose,
}: {
  data: ReplayData;
  label: string;
  period: ReplayPeriod;
  onChoose: (period: ReplayPeriod) => void;
}) {
  const minutes = useCountUp(fmtMinutes(data.totalMs));
  return (
    <>
      <p className="text-body font-medium text-white/75">{label}</p>
      <p className="mt-4 font-display text-[92px] font-extrabold leading-none tabular-nums tracking-[-0.04em]">
        {minutes.toLocaleString()}
      </p>
      <p className="mt-3 text-card-title text-white/90">minutes listened</p>
      <p className="mt-4 text-body tabular-nums text-white/75">
        {plural(data.plays, "play", "plays")} · {plural(activeDayCount(data.days), "day", "days")} with music
      </p>
      <div className="mt-auto pt-10" onPointerDown={stopPointer}>
        <PeriodPills value={period} onChange={onChoose} />
      </div>
    </>
  );
}

function SongsSlide({ data }: { data: ReplayData }) {
  return (
    <>
      <h2 className="font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em]">Top songs</h2>
      <ol className="mt-6 m-0 list-none space-y-4 p-0">
        {data.tracks.slice(0, 5).map((track, index) => (
          <li key={track.id} className="flex items-center gap-4">
            <span className="w-5 shrink-0 text-body tabular-nums text-white/60">{index + 1}</span>
            {track.thumb ? (
              <img loading="lazy" decoding="async" src={track.thumb} alt="" className="size-[52px] shrink-0 rounded-[10px] object-cover" />
            ) : (
              <span aria-hidden="true" className="size-[52px] shrink-0 rounded-[10px] bg-white/15" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold">{track.title}</span>
              <span className="block truncate text-body text-white/75">{track.artist}</span>
            </span>
            <span className="shrink-0 text-right text-meta tabular-nums text-white/85">{fmtHours(track.ms)}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function ArtistsSlide({ data }: { data: ReplayData }) {
  const [top, ...rest] = data.artists.slice(0, 5);
  return (
    <>
      <h2 className="font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em]">Top artists</h2>
      {top && (
        <div className="mt-8">
          <p className="text-body font-medium text-white/70">Number one</p>
          <p className="mt-2 truncate font-display text-[44px] font-extrabold leading-tight tracking-[-0.02em]">{top.name}</p>
          <p className="mt-1 text-body tabular-nums text-white/80">{fmtHours(top.ms)}</p>
        </div>
      )}
      <ol className="mt-8 m-0 list-none space-y-3 p-0">
        {rest.map((artist, index) => (
          <li key={artist.name} className="flex items-center gap-4 text-card-title">
            <span className="w-5 shrink-0 text-body tabular-nums text-white/60">{index + 2}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{artist.name}</span>
            <span className="shrink-0 text-body tabular-nums text-white/80">{fmtHours(artist.ms)}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function TimeSlide({ hours }: { hours: number[] }) {
  const part = topDayPart(hours);
  const peak = peakHour(hours);
  const shares = dayPartShares(hours);
  return (
    <>
      <h2 className="font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em]">You listen most in the</h2>
      {part && (
        <p className="mt-4 font-display text-[64px] font-extrabold leading-none tracking-[-0.03em]">{part.label.toLowerCase()}</p>
      )}
      {part && (
        <p className="mt-3 text-body text-white/85">
          {Math.round(part.share * 100)}% of your listening
          {peak !== null &&
            ` · peak around ${new Date(2000, 0, 1, peak).toLocaleTimeString("en-US", { hour: "numeric" })}`}
        </p>
      )}
      <ul className="mt-auto m-0 list-none space-y-4 p-0">
        {shares.map((share) => (
          <li key={share.id} className="grid grid-cols-[88px_1fr_44px] items-center gap-3 text-body">
            <span className="text-white/85">{share.label}</span>
            <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-white/15">
              <span className="block h-full rounded-full bg-white" style={{ width: `${Math.max(share.share * 100, 1)}%` }} />
            </span>
            <span className="text-right tabular-nums text-white/85">{Math.round(share.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function ShareSlide({ onShare }: { onShare: () => void }) {
  return (
    <>
      <h2 className="font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em]">That is your Replay</h2>
      <p className="mt-3 text-body text-white/85">Share one card sized for a story, or tap the right side to finish.</p>
      <div className="mt-auto" onPointerDown={stopPointer}>
        <button
          type="button"
          onClick={onShare}
          className="h-12 w-full rounded-full bg-white text-body font-semibold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Share card
        </button>
      </div>
    </>
  );
}
