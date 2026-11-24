import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { normalizeCredit } from "../lib/credits";
import { CaretDown, X, Screencast, Heart, MusicNote, MagnifyingGlass, SpeakerHigh, SpeakerLow, SpeakerX } from "@phosphor-icons/react";
import { Icon } from "./Icon";
import { CaptionButtons } from "./CaptionButtons";
import { PlaybackTimeline } from "./PlaybackTimeline";
import { PlaybackButtons, TransportButton } from "./PlaybackControls";
import { AddToPlaylist } from "./PlayerBar";
import { QueuePanel } from "./RightRail";
import { SyncedLyrics } from "./SyncedLyrics";
import { NowPlayingArtwork } from "./NowPlayingArtwork";
import { StatsPanel } from "./StatsPanel";
import { upgradeArtwork } from "../lib/artwork";
import { platform, setFullScreen } from "../lib/bridge";
import { castFromNowPlaying } from "../lib/cast";
import { submitSearch } from "../lib/searchActions";
import { OnArtContext } from "../lib/onArt";
import { hasCaptionButtons } from "../lib/desktopPlatform";
import { CanvasVideo } from "./CanvasVideo";
import { useCanvasClip } from "./useCanvasClip";
import { useLyricsOffset, useLyricsTimingKeys } from "../lib/lyricsOffset";
import { DURATION_MS, EASE_OUT, fade, instant, reducedMotion, swap } from "../lib/motion";
import { nowPlayingRoll } from "../lib/nowPlayingRoll";
import { ROLL_STRIP_PX, rollStyles } from "../lib/rollUp";
import { animate, motion, useTransform, type AnimationPlaybackControls } from "motion/react";
import { useArtworkPalette } from "../lib/artworkPalette";
import { setKeepAwake } from "../lib/wakeLock";
import { AmbientBackdrop, paletteCoverFor } from "./AmbientBackdrop";
import { useTrackLyrics } from "../lib/useTrackLyrics";
import { peekArtistMeta } from "../stores/artistMeta";
import { useLibrary } from "../stores/library";
import { currentTrack, usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";
import { topBarLeadingInset } from "../lib/windowChrome";

const IDLE_MS = 3000;
const ESC_HINT_MS = 3000;
const EXIT_MS = DURATION_MS.roll;
const CAPTION_RESERVE_PX = 144;
const ART_TARGET = 1200;
const MODES = [
  { id: "lyrics", label: "Lyrics" },
  { id: "queue", label: "Queue" },
] as const;
type Mode = (typeof MODES)[number]["id"];

async function changeFullscreen(enabled: boolean) {
  try {
    await setFullScreen(enabled);
  } catch {
    useUI.getState().toast("Couldn't change full screen", "error");
  }
}

function TopSearch() {
  const searchQuery = useUI((state) => state.searchQuery);
  const setSearchQuery = useUI((state) => state.setSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative flex w-[260px] max-w-full items-center">
      <span className="pointer-events-none absolute left-3 text-art/[0.72]">
        <Icon icon={MagnifyingGlass} />
      </span>
      <input
        ref={inputRef}
        type="search"
        aria-label="Search"
        placeholder="Search"
        maxLength={200}
        spellCheck={false}
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          submitSearch(searchQuery);
          useUI.getState().closeNowPlaying();
        }}
        className={`h-10 w-full rounded-[12px] [corner-shape:squircle] bg-art/[0.18] pl-10 text-body text-art placeholder:text-art/[0.72] focus-visible:outline-none focus-visible:bg-art/[0.24] ${searchQuery ? "pr-11" : "pr-4"}`}
      />
      {searchQuery && (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setSearchQuery("");
            inputRef.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-[9px] [corner-shape:squircle] text-art/[0.72] motion-safe:transition-colors hover:bg-art/[0.12] hover:text-art focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <Icon icon={X} />
        </button>
      )}
    </div>
  );
}

function useIdleChrome(active: boolean): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    setIdle(false);
    if (!active) return;
    let timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      window.clearTimeout(timer);
      setIdle(false);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    window.addEventListener("focusin", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("focusin", wake);
    };
  }, [active]);

  return idle;
}

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
const VOLUME_KEY_STEP: Record<string, number> = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 };

function runRoll(target: 0 | 1, controls: { current: AnimationPlaybackControls | null }) {
  if (reducedMotion()) {
    nowPlayingRoll.set(target);
    return;
  }
  controls.current?.stop();
  controls.current = animate(nowPlayingRoll, target, { duration: DURATION_MS.roll / 1000, ease: EASE_OUT });
}

function RollStrip() {
  return (
    <button
      type="button"
      aria-label="Hide Now Playing"
      title="Hide Now Playing"
      onClick={() => useUI.getState().closeNowPlaying()}
      className={`fixed left-0 top-0 z-[101] ${FOCUS_RING}`}
      style={{ height: ROLL_STRIP_PX, right: hasCaptionButtons(platform) ? CAPTION_RESERVE_PX : 0 }}
    />
  );
}

export function NowPlaying() {
  const open = useUI((state) => state.nowPlayingOpen);
  const rollControls = useRef<AnimationPlaybackControls | null>(null);
  const keepAwake = useSettings((state) => state.keepScreenAwake);
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const wasOpen = useRef(false);
  const enteredFullscreen = useRef(false);
  const exitTimer = useRef(0);
  const hintTimer = useRef(0);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      window.clearTimeout(exitTimer.current);
      window.clearTimeout(hintTimer.current);
      setMounted(true);
      setExiting(false);
      setHintVisible(true);
      hintTimer.current = window.setTimeout(() => setHintVisible(false), ESC_HINT_MS);
      enteredFullscreen.current = !useUI.getState().osFullscreen;
      void changeFullscreen(true);
      runRoll(1, rollControls);
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    window.clearTimeout(hintTimer.current);
    setHintVisible(false);
    if (enteredFullscreen.current) {
      enteredFullscreen.current = false;
      void changeFullscreen(false);
    }
    runRoll(0, rollControls);
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    setExiting(true);
    exitTimer.current = window.setTimeout(() => {
      setMounted(false);
      setExiting(false);
    }, EXIT_MS);
  }, [open]);

  useEffect(
    () => () => {
      window.clearTimeout(exitTimer.current);
      window.clearTimeout(hintTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!keepAwake) {
      void setKeepAwake(false);
      return;
    }
    if (!open) return;
    void setKeepAwake(true);
    const release = () => void setKeepAwake(false);
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      void setKeepAwake(false);
    };
  }, [open, keepAwake]);

  if (!mounted) return null;
  return (
    <>
      {open && !reducedMotion() && <RollStrip />}
      <NowPlayingView exiting={exiting} hintVisible={hintVisible} />
    </>
  );
}

function MarqueeTitle({ text }: { text: string }) {
  const [shift, setShift] = useState(0);
  const boxRef = useRef<HTMLHeadingElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const start = () => {
    if (reducedMotion()) return;
    const over = (labelRef.current?.scrollWidth ?? 0) - (boxRef.current?.clientWidth ?? 0);
    if (over > 0) setShift(over);
  };
  const stop = () => setShift(0);
  return (
    <h2
      ref={boxRef}
      tabIndex={0}
      title={text}
      onPointerEnter={start}
      onPointerLeave={stop}
      onFocus={start}
      onBlur={stop}
      className="animate-fade-in min-w-0 overflow-hidden whitespace-nowrap rounded-md text-section font-semibold tracking-[-0.02em] text-art focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [font-family:var(--font-lyric)] font-synthesis-none"
    >
      <span
        ref={labelRef}
        className={shift > 0 ? "block whitespace-nowrap" : "block truncate"}
        style={{
          transform: `translateX(-${shift}px)`,
          transition: shift > 0 ? `transform ${Math.max(4, shift / 30)}s linear` : "transform var(--dur-quick) var(--ease-out)",
        }}
      >
        {text}
      </span>
    </h2>
  );
}

function NowPlayingView({ exiting, hintVisible }: { exiting: boolean; hintVisible: boolean }) {
  const panelRef = useRef<HTMLElement>(null);
  const reduced = reducedMotion();
  const track = usePlayer(currentTrack);
  const duration = usePlayer((state) => state.duration);
  const position = usePlayer((state) => state.position);
  const seek = usePlayer((state) => state.seek);
  const playing = usePlayer((state) => state.playing);
  const buffering = usePlayer((state) => state.buffering);
  const lyricsCenter = useUI((state) => state.lyricsCenter);
  const toggleNowPlaying = useUI((state) => state.toggleNowPlaying);
  const menuOpen = useUI((state) => Boolean(state.contextMenu || state.dialog || state.playlistPicker));
  const animatedCovers = useSettings((state) => state.animatedCovers);
  const dataSaver = useSettings((state) => state.dataSaver);
  const statsForNerds = useSettings((state) => state.statsForNerds);
  const liked = useLibrary((state) => track !== null && state.liked.some((item) => item.id === track.id));
  const volume = usePlayer((state) => state.volume);
  const muted = usePlayer((state) => state.muted);
  const setVolume = usePlayer((state) => state.setVolume);
  const toggleMute = usePlayer((state) => state.toggleMute);
  const level = muted ? 0 : volume;
  const silent = muted || volume === 0;
  const toggleLike = useLibrary((state) => state.toggleLike);
  const [mode, setMode] = useState<Mode>("lyrics");
  const trackId = track?.id ?? null;
  const offset = useLyricsOffset(trackId);
  const { lyrics, loading } = useTrackLyrics(track, duration);
  const synced = lyrics?.synced ?? null;
  const hasLyrics = Boolean(synced?.length || lyrics?.plain?.trim());
  useLyricsTimingKeys(trackId, !lyricsCenter);
  const idle = useIdleChrome(playing && !menuOpen && !exiting);
  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus({ preventScroll: true });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || menuOpen || exiting) return;
    const panel = panelRef.current;
    if (!panel) return;
    const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  };

  const roll = useTransform(nowPlayingRoll, (p) => rollStyles(p, window.innerHeight, reduced));
  const rollClip = useTransform(roll, (r) => r.sheet);
  const rollY = useTransform(nowPlayingRoll, (p) => (reduced ? 0 : Math.max(0, 1 - p) * window.innerHeight));

  const artwork = upgradeArtwork(track?.thumb, ART_TARGET);
  const cover = artwork || upgradeArtwork(peekArtistMeta(track?.artist ?? "")?.thumb, ART_TARGET);
  const paletteSrc = paletteCoverFor(track);
  const ambient = useArtworkPalette(paletteSrc);
  const clipUrl = useCanvasClip(track, animatedCovers && !dataSaver);

  const chrome = idle
    ? "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100"
    : "opacity-100";
  const chromeMotion = "motion-safe:transition-opacity motion-safe:duration-fade";

  return (
    <OnArtContext.Provider value>
    <motion.section
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      onKeyDown={trapFocus}
      data-idle={idle}
      initial={reduced ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={fade}
      style={{ y: rollY, clipPath: rollClip, paddingTop: reduced ? 0 : ROLL_STRIP_PX }}
      className={`fixed inset-0 z-[100] flex flex-col overflow-hidden ${idle ? "cursor-none" : ""}`}
    >
      <AmbientBackdrop primary={ambient.primary} src={paletteSrc} className="absolute inset-0" />
      <p
        role="status"
        aria-live="polite"
        className={`pointer-events-none absolute bottom-6 left-1/2 z-30 -translate-x-1/2 motion-safe:transition-[opacity,transform] motion-safe:duration-swap ${hintVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}
      >
        <span className="flex items-center gap-3 rounded-lg border border-separator bg-panel px-4 py-3 text-body text-ink-1">
          To exit full screen, press
          <kbd className="grid h-7 min-w-[36px] place-items-center rounded-[5px] border border-ink-2 px-2 text-meta text-ink-1">
            Esc
          </kbd>
        </span>
      </p>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <header
          data-tauri-drag-region
          style={{ paddingLeft: topBarLeadingInset(platform) }}
          className={`relative z-10 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] pl-3 pr-4 ${chrome} ${chromeMotion}`}
        >
          <div data-tauri-drag-region className="flex items-center justify-start">
            <button
              type="button"
              title="Close (Esc)"
              aria-label="Close Now Playing"
              onClick={toggleNowPlaying}
              className="-ml-1 grid h-10 w-10 place-items-center rounded-[12px] [corner-shape:squircle] text-art/[0.55] hover:bg-art/[0.12] hover:text-art motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Icon icon={CaretDown} />
            </button>
          </div>
          <div data-tauri-drag-region className="flex items-center justify-center">
            <div className="flex items-center gap-3">
              <div role="group" aria-label="Now Playing panel" className="flex gap-1 rounded-[12px] [corner-shape:squircle] bg-art/[0.18] p-1">
                {MODES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={mode === item.id}
                    onClick={() => setMode(item.id)}
                    className={`hit-area h-8 w-24 rounded-[8px] [corner-shape:squircle] text-center text-meta font-semibold motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${mode === item.id ? "bg-art text-base" : "text-art/[0.72] hover:bg-art/[0.12] hover:text-art"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="hidden min-[1024px]:block">
                <TopSearch />
              </div>
            </div>
          </div>
          <div data-tauri-drag-region className="flex h-full items-stretch justify-end pl-3">
            {hasCaptionButtons(platform) && <CaptionButtons variant="compact" />}
          </div>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-8 px-8 pb-4 min-[900px]:flex-row min-[900px]:justify-center lg:gap-12 lg:px-14 xl:gap-20">
          <div className="now-playing-main-column flex min-h-0 min-w-0 flex-col items-center justify-center min-[900px]:w-[clamp(320px,36vw,480px)] min-[900px]:flex-none">
            {track ? (
              <div className="flex w-full max-w-full flex-col">
                <NowPlayingArtwork src={cover} trackId={track.id} overlay={clipUrl ? <CanvasVideo key={clipUrl} src={clipUrl} playing={playing} className="absolute inset-0 h-full w-full object-cover" /> : null} />
                <div className="now-playing-controls mx-auto flex min-w-0 flex-col">
                  <div className="mt-6 min-w-0 text-center">
                    <motion.div key={`title-${track.id}`} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? instant : swap}>
                      <MarqueeTitle text={track.title} />
                    </motion.div>
                    <motion.p key={`artist-${track.id}`} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? instant : { ...swap, delay: 0.03 }} className="mt-1 truncate text-body text-art/[0.72]">{normalizeCredit(track.artist)}</motion.p>
                    <p role="status" className="mt-1 min-h-4 text-meta text-art/[0.6]">{buffering ? "Buffering audio…" : ""}</p>
                  </div>
                  <div className={`mt-5 w-full ${chrome} ${chromeMotion}`}>
                    <PlaybackTimeline trackId={track.id} position={position} duration={duration} onSeek={seek} onArt />
                  </div>
                  <div role="group" aria-label="Transport" className={`mt-4 flex w-full items-center justify-between ${chrome} ${chromeMotion}`}>
                    <div className="-ml-[10px] flex shrink-0 items-center">
                      <TransportButton
                        label="Add to Library"
                        icon={Heart}
                        active={liked}
                        dot={false}
                        filled={liked}
                        pressed={liked}
                        motionKind="like"
                        onArt
                        onClick={() => toggleLike(track)}
                      />
                      {platform === "android" && (
                        <TransportButton label="Cast" icon={Screencast} onArt onClick={() => void castFromNowPlaying()} />
                      )}
                    </div>
                    <PlaybackButtons onArt />
                    <div className="-mr-[10px] shrink-0">
                      <AddToPlaylist track={track} onArt />
                    </div>
                  </div>
                  <div role="group" aria-label="Volume" className={`mt-4 flex w-full items-center gap-0.5 ${chrome} ${chromeMotion}`}>
                    <button
                      type="button"
                      aria-label={muted ? "Unmute" : "Mute"}
                      onClick={toggleMute}
                      className={`hit-area -ml-[10px] grid h-10 w-10 shrink-0 place-items-center rounded-full text-art/[0.72] hover:text-art ${FOCUS_RING}`}
                    >
                      <Icon icon={silent ? SpeakerX : SpeakerLow} />
                    </button>
                    <input
                      type="range"
                      aria-label="Volume"
                      min={0}
                      max={1}
                      step={0.01}
                      value={level}
                      onChange={(event) => setVolume(Number(event.target.value))}
                      onKeyDown={(event) => {
                        const delta = VOLUME_KEY_STEP[event.key];
                        if (delta === undefined) return;
                        event.preventDefault();
                        setVolume(Math.round(Math.min(1, Math.max(0, level + delta)) * 100) / 100);
                      }}
                      style={{ "--level": `${level * 100}%` } as CSSProperties}
                      className={`volume-art h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-transparent [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-art [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-art ${FOCUS_RING}`}
                    />
                    <button
                      type="button"
                      aria-label="Full volume"
                      onClick={() => setVolume(1)}
                      className={`hit-area -mr-[10px] grid h-10 w-10 shrink-0 place-items-center rounded-full text-art/[0.72] hover:text-art ${FOCUS_RING}`}
                    >
                      <Icon icon={SpeakerHigh} />
                    </button>
                  </div>
                  {statsForNerds && (
                    <div className={`mt-6 w-full ${chrome} ${chromeMotion}`}>
                      <StatsPanel trackId={track.id} onArt />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center">
                <div className="mb-5 grid h-16 w-16 place-items-center rounded-[10px] border border-art/[0.18] text-art/[0.55]">
                  <Icon icon={MusicNote} />
                </div>
                <p className="text-sm text-art">Nothing playing yet</p>
                <p className="mt-1 text-meta text-art/[0.55]">Play something and it will show up here.</p>
              </div>
            )}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col pl-6 pr-16 lg:max-w-[720px]">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              {mode === "queue" ? (
                <QueuePanel />
              ) : track && (loading || hasLyrics) ? (
                <SyncedLyrics key={track.id} lyrics={lyrics} loading={loading} offset={offset} trackKey={track.id} onArt />
              ) : (
                track && (
                  <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden pt-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-meta text-art/[0.55]">No lyrics for this song</p>
                    </div>
                    <p className="max-w-sm text-body leading-6 text-art/[0.6]">Switch to Queue to see what's playing next.</p>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
    </OnArtContext.Provider>
  );
}

