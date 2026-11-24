import { useEffect, useContext, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, usePresence, useTransform, type AnimationPlaybackControls } from "motion/react";
import { CaretDown, CaretUp, Screencast, DownloadSimple, DotsThree, SkipForward, SkipBack, Queue, Repeat, Shuffle, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { PhoneIcon } from "./PhoneIcon";
import { AmbientBackdrop, paletteCoverFor } from "../AmbientBackdrop";
import { LikeButton } from "../LikeButton";
import { PhoneLyrics } from "./PhoneLyrics";
import { ArtCarousel, PAUSED_SCALE } from "./ArtCarousel";
import { CoverLikeBurst } from "./CoverLikeBurst";
import { useCoverGestures } from "./useCoverGestures";
import { PlayPauseGlyph, useLoopAllowed } from "./PlayPauseGlyph";
import { ActiveDot, ToggleIcon } from "../motion/ToggleIcon";
import { DownloadRing } from "../motion/DownloadRing";
import type { ToggleKind } from "../../lib/toggleMotion";
import { sheetReleaseCloses, useSheetDrag } from "./useSheetDrag";
import { coverFlight, coverRadiusOf, glideSheet, heldBox, measureCover, measureMini, measureWithin, mountSheet, nowPlayingDriver, opennessOf, sheetRadiusOf, sheetY, travelPx, unmountSheet, type Box, type Geometry } from "./sheetTravel";
import { PhoneQueueList } from "./PhoneQueueSheet";
import { PANEL_TRAVEL_SHARE, lyricsHintVisible, panelGestureMode, panelReleaseTarget, scrollHoldsDrag, type PanelKind, type PanelMode } from "./nowPlayingPanel";
import { useTrackLyrics } from "../../lib/useTrackLyrics";
import { haptic } from "../../lib/haptics";
import { castFromNowPlaying } from "../../lib/cast";
import { cancelDownload, isDownloadable, revealDownload, startDownload } from "../../lib/downloads";
import { fmtTime } from "../../lib/format";
import { AMBIENT_FALLBACK } from "../../lib/artworkPalette";
import { shownDuration } from "../../lib/trackLength";
import { viewportHeight } from "../../lib/viewport";
import { VelocityTracker } from "../../lib/velocity";
import { useHeldPalette } from "./useHeldPalette";
import { OnArtContext } from "../../lib/onArt";
import { DURATION_MS, MARQUEE, PHONE_MS, QUEUE_EASE, fade, gate, phoneSmooth, phoneSnappy, phoneTween, pressTap, reducedMotion, scrubSpring } from "../../lib/motion";
import { INSET_BOTTOM, INSET_TOP } from "../../lib/phoneNav";
import { songOf, trackMenuItems } from "../../lib/trackActions";
import { neighbourTracks, swipeAxis, type Axis } from "../../lib/trackSwipe";
import { nowPlayingSourceName } from "../../lib/nowPlayingSource";
import { useLibrary } from "../../stores/library";
import { currentTrack, type RepeatMode, usePlayer } from "../../stores/player";
import { type MenuItem, useUI } from "../../stores/ui";
import type { Track } from "../../types";

const PANEL_HEADER_TOP = "top-12";

type PanelGesture = {
  down: PointerEvent;
  y0: number;
  tracker: VelocityTracker;
  axis: Axis | null;
  mode: PanelMode | null;
  anchorY: number;
  p0: number;
  startOpen: boolean;
  held: boolean;
};

let lyricsHintNudged = false;

const SEEK_STEP_S = 5;
const SCRUB_IDLE_PX = 7;
const SCRUB_ACTIVE_PX = 12;
const EDGE_FADE = "linear-gradient(to right, transparent, #000 16px, #000 calc(100% - 16px), transparent)";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
const ROW = "shrink-0 px-6";
type ControlSize = 44 | 48 | 56;
const SIZE: Record<ControlSize, string> = { 44: "h-11 w-11", 48: "h-12 w-12", 56: "h-14 w-14" };

const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Enable repeat",
  all: "Disable repeat",
  one: "Disable repeat one",
};

function toneFor(onArt: boolean, active: boolean, strong: boolean): string {
  const lit = active || strong;
  if (onArt) return lit ? "text-art" : "text-art/[0.6]";
  return lit ? "text-ink-1" : "text-ink-2";
}

type ControlProps = {
  label: string;
  icon: PhosphorIcon;
  size?: ControlSize;
  glyph?: number;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  strong?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  dot?: boolean;
  spin?: boolean;
  toggleKind?: ToggleKind;
  toggleState?: string;
  badge?: string;
  custom?: ReactNode;
  filled?: boolean;
};

function Control({
  label,
  icon,
  size = 48,
  glyph = 24,
  onClick,
  active = false,
  strong = false,
  pressed,
  disabled = false,
  dot = false,
  spin = false,
  toggleKind,
  toggleState,
  badge,
  custom,
  filled = false,
}: ControlProps) {
  const reduced = reducedMotion();
  const loop = useLoopAllowed();
  const onArt = useContext(OnArtContext);
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : pressTap(reduced)}
      transition={phoneSnappy}
      className={`relative grid shrink-0 place-items-center rounded-full ${SIZE[size]} ${FOCUS} disabled:opacity-[var(--disabled-opacity)] ${toneFor(onArt, active, strong)}`}
    >
      {custom ?? (
        <span className={spin && loop ? "grid animate-spin place-items-center" : "grid place-items-center"}>
          {toggleKind ? (
            <ToggleIcon kind={toggleKind} state={toggleState ?? "off"} badge={badge}>
              <PhoneIcon icon={icon} size={glyph} fill={filled ? "fill" : "none"} />
            </ToggleIcon>
          ) : (
            <PhoneIcon icon={icon} size={glyph} fill={filled ? "fill" : "none"} />
          )}
        </span>
      )}
      {dot && <ActiveDot className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${onArt ? "bg-current" : "bg-accent"}`} />}
    </motion.button>
  );
}

function Marquee({ text, className, delayS }: { text: string; className: string; delayS: number }) {
  const reduced = reducedMotion();
  const frame = useRef<HTMLSpanElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  const crawl = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    if (reduced) return;
    const measure = () => {
      const box = frame.current;
      const line = words.current;
      if (!box || !line) return;
      const width = line.offsetWidth;
      setOverflow(width > box.clientWidth ? width : 0);
    };
    measure();
    if (!frame.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [text, reduced]);

  useEffect(() => {
    const el = crawl.current;
    if (reduced || overflow === 0 || !el || typeof el.animate !== "function") return;
    const distance = overflow + MARQUEE.gapPx;
    const loopS = MARQUEE.restS + distance / MARQUEE.pxPerS;
    const rest = MARQUEE.restS / loopS;
    const animation = el.animate(
      [
        { transform: "translateX(0px)", offset: 0 },
        { transform: "translateX(0px)", offset: rest },
        { transform: `translateX(${-distance}px)`, offset: 1 },
      ],
      { duration: loopS * 1000, iterations: Infinity, delay: delayS * 1000 },
    );
    return () => animation.cancel();
  }, [overflow, reduced, delayS]);

  if (reduced) return <span className={`block truncate ${className}`}>{text}</span>;
  const crawling = overflow > 0;
  return (
    <span ref={frame} className="block overflow-hidden whitespace-nowrap" style={crawling ? { maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE } : undefined}>
      <span ref={crawl} className={`inline-flex ${crawling ? "w-max" : "w-full justify-center"}`}>
        <span ref={words} className={`inline-block truncate ${className}`}>
          {text}
        </span>
        {crawling && (
          <>
            <span aria-hidden="true" className="inline-block" style={{ width: MARQUEE.gapPx }} />
            <span aria-hidden="true" className={`inline-block truncate ${className}`}>
              {text}
            </span>
            <span aria-hidden="true" className="inline-block" style={{ width: MARQUEE.gapPx }} />
          </>
        )}
      </span>
    </span>
  );
}

function DownloadButton({ track }: { track: Track | null }) {
  const item = useLibrary((state) => (track ? state.downloads[track.id] : undefined));
  if (!track || !isDownloadable(track.id)) return <span aria-hidden="true" className="h-11 w-11 shrink-0" />;
  const busy = item?.status === "queued" || item?.status === "downloading";
  const path = item?.status === "done" ? item.path : null;
  const percent = Math.round((item?.progress ?? 0) * 100);
  const label = busy ? `Downloading, ${percent}%` : path ? "Downloaded" : "Download";
  const onClick = () => {
    if (busy) void cancelDownload(track.id);
    else if (path) revealDownload(path);
    else void startDownload(track);
  };
  return (
    <Control
      label={label}
      size={44}
      icon={DownloadSimple}
      active={busy || Boolean(path)}
      custom={<DownloadRing busy={busy} done={Boolean(path)} progress={item?.progress ?? 0} size={24} idle={<PhoneIcon icon={DownloadSimple} size={24} />} />}
      onClick={onClick}
    />
  );
}

function LyricsHint({ visible, onOpen }: { visible: boolean; onOpen: () => void }) {
  const reduced = reducedMotion();
  const [nudge] = useState(() => !reduced && !lyricsHintNudged);
  useEffect(() => {
    if (nudge) lyricsHintNudged = true;
  }, [nudge]);
  return (
    <div data-lyrics-hint="" className={`flex flex-1 justify-center ${visible ? "" : "hidden"}`}>
      <button
        type="button"
        aria-label="Lyrics"
        onClick={onOpen}
        className={`flex min-h-11 items-center rounded-full px-4 text-meta font-medium text-ink-2 motion-safe:transition-transform motion-safe:duration-press motion-safe:active:scale-[0.97] ${FOCUS}`}
      >
        <motion.span
          initial={{ y: 0 }}
          animate={nudge ? { y: [0, -3, 0] } : { y: 0 }}
          transition={{ ...phoneTween(DURATION_MS.reveal), delay: PHONE_MS.lyricsHint / 1000 }}
          className="inline-flex items-center gap-1"
        >
          <span>Lyrics</span>
          <PhoneIcon icon={CaretUp} size={13} />
        </motion.span>
      </button>
    </div>
  );
}

function SeekBar({ current }: { current: Track | null }) {
  const position = usePlayer((state) => state.position);
  const duration = usePlayer((state) => state.duration);
  const seek = usePlayer((state) => state.seek);
  const onArt = useContext(OnArtContext);
  const reduced = reducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const max = shownDuration(duration, current);
  const active = useRef<{ pointerId: number; trackId: string | undefined } | null>(null);
  const safePosition = Number.isFinite(position) ? Math.max(0, Math.min(max, position)) : 0;
  const fraction = max > 0 ? safePosition / max : 0;
  useEffect(() => { active.current = null; setScrub(null); }, [current?.id]);
  const shown = scrub ?? fraction;

  const shareAt = (clientX: number): number | null => {
    const element = track.current;
    if (!element || max <= 0) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const share = shareAt(event.clientX);
    if (share === null) return;
    active.current = { pointerId: event.pointerId, trackId: current?.id };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setScrub(share);
    haptic("tick");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!active.current || active.current.pointerId !== event.pointerId || active.current.trackId !== current?.id) return;
    const share = shareAt(event.clientX);
    if (share !== null) setScrub(share);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!active.current || active.current.pointerId !== event.pointerId || active.current.trackId !== current?.id) return;
    const share = shareAt(event.clientX);
    active.current = null;
    if (share !== null) seek(share * max);
    setScrub(null);
    haptic("tick");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (max <= 0) return;
    const value = shown * max;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") seek(Math.min(max, value + SEEK_STEP_S));
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") seek(Math.max(0, value - SEEK_STEP_S));
    else if (event.key === "Home") seek(0);
    else if (event.key === "End") seek(max);
    else return;
    event.preventDefault();
  };

  const trackTone = onArt ? "bg-art/[0.26]" : "bg-wash";
  const fillTone = onArt ? "bg-art/[0.92]" : "bg-ink-1";

  return (
    <div className="shrink-0">
      <div
        ref={track}
        role="slider"
        tabIndex={max > 0 ? 0 : -1}
        aria-disabled={max <= 0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        aria-valuenow={Math.round(shown * max)}
        aria-valuetext={`${fmtTime(shown * max)} of ${fmtTime(max)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { active.current = null; setScrub(null); }}
        onLostPointerCapture={() => { active.current = null; setScrub(null); }}
        onKeyDown={onKeyDown}
        className={`relative flex h-11 w-full cursor-pointer touch-none items-center rounded-full ${FOCUS}`}
      >
        <motion.div
          initial={false}
          style={{ height: SCRUB_ACTIVE_PX }}
          animate={{ scaleY: scrub === null ? SCRUB_IDLE_PX / SCRUB_ACTIVE_PX : 1 }}
          transition={gate(reduced, scrubSpring)}
          className={`relative w-full rounded-full ${trackTone}`}
        >
          <div
            className={`absolute inset-0 origin-left rounded-full ${fillTone} ${scrub === null && !reduced ? "transition-transform duration-reading ease-linear" : ""}`}
            style={{ transform: `scaleX(${shown})` }}
          />
        </motion.div>
      </div>
      <div className={`mt-1 flex justify-between text-meta leading-4 tabular-nums ${onArt ? "text-art/[0.72]" : "text-ink-2"}`}>
        <span>{fmtTime(shown * max)}</span>
        <span>{max > 0 ? fmtTime(max) : "--:--"}</span>
      </div>
    </div>
  );
}

function NowPlayingSheet() {
  const track = usePlayer(currentTrack);
  const queue = usePlayer((state) => state.queue);
  const index = usePlayer((state) => state.index);
  const playing = usePlayer((state) => state.playing);
  const buffering = usePlayer((state) => state.buffering);
  const shuffle = usePlayer((state) => state.shuffle);
  const repeat = usePlayer((state) => state.repeat);
  const toggle = usePlayer((state) => state.toggle);
  const next = usePlayer((state) => state.next);
  const prev = usePlayer((state) => state.prev);
  const prevTrack = usePlayer((state) => state.prevTrack);
  const toggleShuffle = usePlayer((state) => state.toggleShuffle);
  const cycleRepeat = usePlayer((state) => state.cycleRepeat);
  const closeNowPlaying = useUI((state) => state.closeNowPlaying);
  const openPhoneQueue = useUI((state) => state.openPhoneQueue);
  const closePhoneQueue = useUI((state) => state.closePhoneQueue);
  const queueOpen = useUI((state) => state.phoneQueueOpen);
  const lyricsOpen = useUI((state) => state.phoneLyricsOpen);
  const openPhoneLyrics = useUI((state) => state.openPhoneLyrics);
  const closePhoneLyrics = useUI((state) => state.closePhoneLyrics);
  const panel: PanelKind | null = queueOpen ? "queue" : lyricsOpen ? "lyrics" : null;
  const duration = usePlayer((state) => state.duration);
  const lyricsState = useTrackLyrics(track, duration);
  const hintVisible = lyricsHintVisible(lyricsState);
  const openContextMenu = useUI((state) => state.openContextMenu);
  const coverGestures = useCoverGestures(track, (point) => {
    if (track) openContextMenu(point.x, point.y, trackMenuItems(songOf(track)), { above: true });
  });
  const liked = useLibrary((state) => track !== null && state.liked.some((item) => item.id === track.id));
  const playlists = useLibrary((state) => state.playlists);
  const playingFrom = usePlayer((state) => state.playingFrom);
  const sheet = useRef<HTMLElement>(null);
  const [panelKind, setPanelKind] = useState<PanelKind | null>(null);
  const drag = useSheetDrag(closeNowPlaying, () => "grab", nowPlayingDriver);
  const geometry = useRef<Geometry | null>(null);
  const openness = useTransform(sheetY, opennessOf);
  const sheetShift = useTransform(sheetY, (y) => Math.max(0, y));
  const coverRadius = useTransform(openness, (p) => coverRadiusOf(geometry.current, p));
  const sheetRadius = useTransform(openness, sheetRadiusOf);
  const flightX = useTransform([sheetY, openness], ([y, p]: number[]) => coverFlight(geometry.current, y, p).x);
  const flightY = useTransform([sheetY, openness], ([y, p]: number[]) => coverFlight(geometry.current, y, p).y);
  const flightScale = useTransform([sheetY, openness], ([y, p]: number[]) => coverFlight(geometry.current, y, p).scale);
  const panelP = useMotionValue(0);
  const panelCtl = useRef<AnimationPlaybackControls | null>(null);
  const panelGeo = useRef<{ from: Box; to: Box } | null>(null);
  const gesture = useRef<PanelGesture | null>(null);
  const panelFlightX = useTransform(panelP, (p) => (panelGeo.current ? p * (panelGeo.current.to.left - panelGeo.current.from.left) : 0));
  const panelFlightY = useTransform(panelP, (p) => (panelGeo.current ? p * (panelGeo.current.to.top - panelGeo.current.from.top) : 0));
  const panelFlightScale = useTransform(panelP, (p) => (panelGeo.current ? 1 + p * (panelGeo.current.to.size / panelGeo.current.from.size - 1) : 1));
  const coverX = useTransform([flightX, panelFlightX], ([a, b]: number[]) => a + b);
  const coverY = useTransform([flightY, panelFlightY], ([a, b]: number[]) => a + b);
  const coverScale = useTransform([flightScale, panelFlightScale], ([a, b]: number[]) => a * b);
  const neighbourFade = useTransform(panelP, (p) => 1 - p);
  const lowerFade = useTransform(panelP, [0, 0.4], [1, 0]);
  const overlayOpacity = useTransform(panelP, [0, 0.2], [0, 1]);
  const panelListY = useTransform(panelP, [0, 1], ["100%", "0%"]);

  const measurePanel = () => {
    const section = sheet.current;
    const from = section ? measureCover(section) : null;
    const to = section ? measureWithin(section, "[data-queue-thumb]") : null;
    panelGeo.current = from && to && !reducedMotion() ? { from, to } : null;
  };

  const settlePanel = (target: 0 | 1) => {
    panelCtl.current?.stop();
    const from = panelP.get();
    if (from === target) return;
    if (target === 1) measurePanel();
    if (reducedMotion()) {
      panelP.set(target);
      return;
    }
    panelCtl.current = animate(panelP, target, {
      duration: (DURATION_MS.queue * Math.abs(target - from)) / 1000,
      ease: QUEUE_EASE,
    });
  };

  const openPanelKind = (kind: PanelKind) => {
    if (kind === "queue") {
      closePhoneLyrics();
      openPhoneQueue();
    } else {
      closePhoneQueue();
      openPhoneLyrics();
    }
  };

  const commitPanel = (target: 0 | 1) => {
    if (target === 1) {
      if (panel) settlePanel(1);
      else openPanelKind("lyrics");
    } else if (panel) {
      closePhoneQueue();
      closePhoneLyrics();
    } else {
      settlePanel(0);
    }
  };

  useEffect(() => {
    if (panel) setPanelKind(panel);
    settlePanel(panel ? 1 : 0);
  }, [panel]);

  useEffect(() => {
    if (!lyricsOpen) lyricsState.reload();
  }, [lyricsOpen]);

  useEffect(
    () => () => {
      panelCtl.current?.stop();
      closePhoneQueue();
      closePhoneLyrics();
    },
    [closePhoneQueue, closePhoneLyrics],
  );

  useLayoutEffect(() => {
    const section = sheet.current;
    const thumb = measureMini();
    const from = thumb && heldBox(thumb, usePlayer.getState().playing ? 1 : PAUSED_SCALE);
    const to = section ? measureCover(section) : null;
    geometry.current = !reducedMotion() && from && to ? { from, to } : null;
    mountSheet();
    return unmountSheet;
  }, []);

  const [present, safeToRemove] = usePresence();
  const leaving = useRef(false);
  useEffect(() => {
    if (present) {
      if (leaving.current) glideSheet(0, 0);
      leaving.current = false;
      return;
    }
    leaving.current = true;
    if (reducedMotion() || sheetY.get() >= travelPx() - 1) safeToRemove();
    else glideSheet(travelPx(), 0, safeToRemove);
  }, [present]);

  useEffect(() => {
    const priorFocus = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const closeBtn = sheet.current?.querySelector<HTMLElement>('button[aria-label="Close Now Playing"]');
      if (closeBtn) {
        closeBtn.focus();
      } else {
        sheet.current?.focus();
      }
    }, 16);

    return () => {
      clearTimeout(timer);
      priorFocus?.focus?.();
    };
  }, []);

  const closeRef = useRef(drag.close);
  closeRef.current = drag.close;

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key === "Tab") {
        const container = sheet.current;
        if (!container) return;
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) {
          event.preventDefault();
          container.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const current = document.activeElement;
        if (event.shiftKey && (current === first || !container.contains(current))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && current === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  const pull = useRef(new VelocityTracker());
  const sheetHandlers = {
    ...drag.handlers,
    onPointerDown(event: PointerEvent) {
      pull.current.reset(event.timeStamp, event.clientY);
      drag.handlers.onPointerDown?.(event);
    },
    onPointerMove(event: PointerEvent) {
      pull.current.add(event.timeStamp, event.clientY);
      drag.handlers.onPointerMove?.(event);
    },
    onPointerUp(event: PointerEvent) {
      pull.current.add(event.timeStamp, event.clientY);
      const velocity = pull.current.velocity(event.timeStamp);
      if (sheetReleaseCloses(Math.max(0, sheetY.get()), travelPx(), velocity)) haptic("select");
      drag.handlers.onPointerUp?.(event);
    },
  };
  const artHandlers = {
    onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !event.currentTarget.contains(target)) {
        gesture.current = null;
        return;
      }
      if (target instanceof Element && target.closest('[role="slider"]')) {
        gesture.current = null;
        return;
      }
      const scroller = event.currentTarget.querySelector<HTMLElement>("[data-lyrics-scroll]");
      const tracker = new VelocityTracker();
      tracker.reset(event.timeStamp, event.clientY);
      gesture.current = {
        down: event,
        y0: event.clientY,
        tracker,
        axis: null,
        mode: null,
        anchorY: event.clientY,
        p0: 0,
        startOpen: panel !== null,
        held: scrollHoldsDrag(scroller ? scroller.scrollTop : null),
      };
    },
    onPointerMove(event: PointerEvent) {
      const g = gesture.current;
      if (!g) return;
      g.tracker.add(event.timeStamp, event.clientY);
      if (g.axis === null) {
        g.axis = swipeAxis(event.clientX - g.down.clientX, event.clientY - g.y0);
        if (g.axis === null) return;
      }
      if (g.axis !== "y") return;
      if (g.mode === null) {
        g.mode = panelGestureMode({ open: panel !== null, movedUp: event.clientY < g.y0, held: g.held });
        if (g.mode === "panel") {
          setPanelKind(panel ?? "lyrics");
          measurePanel();
        } else if (g.mode === "sheet") {
          sheetHandlers.onPointerDown(g.down);
        }
        g.anchorY = event.clientY;
        g.p0 = panelP.get();
        panelCtl.current?.stop();
      }
      if (g.mode === "scroll") return;
      if (g.mode === "sheet") {
        sheetHandlers.onPointerMove(event);
        return;
      }
      const travel = viewportHeight() * PANEL_TRAVEL_SHARE;
      panelP.set(Math.min(1, Math.max(0, g.p0 + (g.anchorY - event.clientY) / travel)));
    },
    onPointerUp(event: PointerEvent) {
      const g = gesture.current;
      gesture.current = null;
      if (!g || g.mode === null || g.mode === "scroll") return;
      if (g.mode === "sheet") {
        sheetHandlers.onPointerUp(event);
        return;
      }
      g.tracker.add(event.timeStamp, event.clientY);
      const velocity = g.tracker.velocity(event.timeStamp);
      commitPanel(panelReleaseTarget({ progress: panelP.get(), start: g.p0, velocity, startOpen: g.startOpen }));
    },
    onPointerCancel(event: PointerEvent) {
      const g = gesture.current;
      gesture.current = null;
      if (!g || g.mode === null || g.mode === "scroll") return;
      if (g.mode === "sheet") sheetHandlers.onPointerCancel?.(event);
      else settlePanel(g.startOpen ? 1 : 0);
    },
  };
  const reduced = reducedMotion();
  const empty = track === null;
  const playLabel = playing ? "Pause" : "Play";
  const neighbours = neighbourTracks(queue, index);
  const paletteSrc = paletteCoverFor(track);
  const held = useHeldPalette(paletteSrc);
  const palette = held ?? AMBIENT_FALLBACK;
  const onArt = held !== null && held !== AMBIENT_FALLBACK;

  const titleTone = onArt ? "text-art" : "text-ink-1";
  const artistTone = onArt ? "text-art/[0.72]" : "text-ink-2";
  const titleBarTone = onArt ? "text-art/[0.72]" : "text-ink-2";
  const likeTone = onArt ? (liked ? "!text-art" : "!text-art/[0.72]") : "";
  const playTone = onArt ? "bg-art text-base" : "bg-primary text-on-primary";
  const sourceName = nowPlayingSourceName(playingFrom, track?.album ?? undefined, (id) => playlists.find((item) => item.id === id)?.name);

  const changeTrack = (change: "next" | "prev") => {
    if (change === "next") next(true);
    else prevTrack();
  };

  const openMenu = (event: MouseEvent<HTMLButtonElement>, items: MenuItem[]) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.top, items, { above: true });
  };

  return (
    <motion.section
      ref={sheet}
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      tabIndex={-1}
      initial={reduced ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={reduced ? { opacity: 0 } : undefined}
      transition={fade}
      style={reduced ? undefined : { y: sheetShift }}
      className={`fixed inset-0 z-40 overflow-x-clip text-ink-1 will-change-transform ${present ? "" : "pointer-events-none"}`}
    >
      <motion.div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-base" style={{ borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius }}>
        {onArt && <AmbientBackdrop primary={palette.primary} src={paletteSrc} className="absolute inset-0" />}
      </motion.div>
      <OnArtContext.Provider value={onArt}>
        <div data-sheet-body className="relative z-10 flex h-full flex-col" style={{ paddingTop: INSET_TOP, paddingBottom: INSET_BOTTOM }}>
          <div className="relative flex min-h-0 flex-1 flex-col">
              <header {...artHandlers} className="flex h-12 shrink-0 touch-none items-center justify-between px-6">
                <Control label="Close Now Playing" icon={CaretDown} size={44} active onClick={drag.close} />
                <div className="flex min-w-0 flex-col items-center px-2 text-center">
                  <span className={`text-meta font-medium leading-[18px] ${titleBarTone}`}>Now playing</span>
                  <span className={`max-w-full truncate text-meta leading-4 ${artistTone}`}>{sourceName}</span>
                </div>
                <Control
                  label="More options"
                  icon={DotsThree}
                  size={44}
                  active
                  disabled={empty}
                  onClick={(event) => {
                    if (track) openMenu(event, trackMenuItems(songOf(track)));
                  }}
                />
              </header>

            <div className="flex min-h-0 flex-1 flex-col">
              <div
                role="group"
                aria-label="Now playing pages"
                className="flex min-h-0 flex-1 touch-none flex-col px-6"
                {...artHandlers}
              >
                <div className="flex h-full w-full min-h-0 flex-col">
                  <div className="min-h-[16px] flex-1" />
                  <div className="relative shrink-0" {...coverGestures.handlers}>
                    <ArtCarousel
                      current={track}
                      prev={neighbours.prev}
                      next={neighbours.next}
                      playing={playing}
                      onChange={changeTrack}
                      flight={{ x: coverX, y: coverY, scale: coverScale, radius: coverRadius, fade: neighbourFade }}
                    />
                    <CoverLikeBurst count={coverGestures.burst} />
                  </div>
                  <div className="min-h-[16px] flex-1" />
                </div>
              </div>
            </div>

            <motion.div className="shrink-0 touch-none will-change-[opacity]" style={{ opacity: lowerFade }} {...artHandlers}>
            <div className={`flex items-center gap-2 ${ROW}`}>
                  <DownloadButton track={track} />
                <div className="grid min-w-0 flex-1 text-center">
                  <AnimatePresence initial={false}>
                    <motion.div
                      key={track?.id ?? "none"}
                      className="col-start-1 row-start-1 min-w-0"
                      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
                      animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={reduced ? fade : phoneSmooth}
                    >
                      <p className="block">
                        <Marquee
                          text={track?.title ?? "Nothing playing"}
                          className={`text-center font-title text-section font-semibold leading-[28px] tracking-[-0.02em] ${titleTone}`}
                          delayS={0}
                        />
                      </p>
                        <Marquee text={track?.artist ?? ""} className={`text-center text-body leading-[22px] ${artistTone}`} delayS={MARQUEE.artistDelayS} />
                    </motion.div>
                  </AnimatePresence>
                </div>
                  <LikeButton track={track} className={`h-11 w-11 ${likeTone}`} />
              </div>

              <div className={`mt-4 ${ROW}`}>
                <SeekBar current={track} />
              </div>

            <div role="group" aria-label="Transport" className={`mt-4 flex items-center justify-between ${ROW}`}>
                <Control
                  label={REPEAT_LABEL[repeat]}
                  icon={Repeat}
                  size={48}
                  active={repeat !== "off"}
                  pressed={repeat !== "off"}
                  dot={repeat !== "off"}
                  toggleKind="repeat"
                  toggleState={repeat}
                  badge={repeat === "one" ? "1" : undefined}
                  onClick={() => {
                    haptic("tick");
                    cycleRepeat();
                  }}
                />
                <Control
                  label="Previous"
                  icon={SkipBack}
                  size={56}
                  glyph={28}
                  active
                  disabled={empty}
                  onClick={() => {
                    haptic("tick");
                    prev();
                  }}
                />
                <motion.button
                  type="button"
                  aria-label={playLabel}
                  title={playLabel}
                  disabled={empty}
                  onClick={() => {
                    haptic("tick");
                    toggle();
                  }}
                  whileTap={empty ? undefined : pressTap(reduced)}
                  transition={phoneSnappy}
                  className={`grid h-16 w-16 shrink-0 place-items-center rounded-full ${playTone} ${FOCUS} disabled:opacity-[var(--disabled-opacity)]`}
                >
                  <PlayPauseGlyph playing={playing} buffering={buffering} size={28} />
                </motion.button>
                <Control
                  label="Next"
                  icon={SkipForward}
                  size={56}
                  glyph={28}
                  active
                  disabled={empty}
                  onClick={() => {
                    haptic("tick");
                    next(true);
                  }}
                />
                <Control
                  label={shuffle ? "Disable shuffle" : "Enable shuffle"}
                  icon={Shuffle}
                  size={48}
                  active={shuffle}
                  pressed={shuffle}
                  dot={shuffle}
                  toggleKind="shuffle"
                  toggleState={shuffle ? "on" : "off"}
                  onClick={() => {
                    haptic("tick");
                    toggleShuffle();
                  }}
                />
              </div>

              <div className={`mt-4 flex items-center justify-between pb-2 ${ROW}`}>
                <Control label="Cast" icon={Screencast} size={48} strong disabled={empty} onClick={() => void castFromNowPlaying()} />
                <LyricsHint visible={hintVisible} onOpen={() => openPanelKind("lyrics")} />
                <Control label="Queue" icon={Queue} size={48} strong onClick={() => openPanelKind("queue")} />
              </div>

            </motion.div>
            <motion.div
              className={`absolute inset-x-0 bottom-0 ${PANEL_HEADER_TOP} z-20 flex flex-col will-change-[opacity] ${panel ? "" : "pointer-events-none"}`}
              style={{ opacity: overlayOpacity }}
            >
              <div {...artHandlers} className="flex h-[78px] shrink-0 touch-none items-center gap-3 px-6">
                <span data-queue-thumb aria-hidden="true" className="block h-[54px] w-[54px] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-title text-card-title font-semibold leading-[22px] ${titleTone}`}>{track?.title ?? "Nothing playing"}</p>
                  <p className={`truncate text-body leading-[20px] ${artistTone}`}>{track?.artist ?? ""}</p>
                </div>
              </div>
              {panelKind === "lyrics" ? (
                <motion.div className="flex min-h-0 flex-1 flex-col px-6 will-change-transform" style={{ y: panelListY }} {...artHandlers}>
                  <PhoneLyrics />
                </motion.div>
              ) : (
                <motion.div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 will-change-transform" style={{ y: panelListY }}>
                  {panelKind === "queue" && <PhoneQueueList />}
                </motion.div>
              )}
            </motion.div>
          </div>
        </div>
      </OnArtContext.Provider>
    </motion.section>
  );
}

export function PhoneNowPlaying() {
  const open = useUI((state) => state.nowPlayingOpen);
  return <AnimatePresence>{open && <NowPlayingSheet key="now-playing" />}</AnimatePresence>;
}
