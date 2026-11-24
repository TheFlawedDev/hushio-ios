import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type MutableRefObject } from "react";
import { getPlaybackPosition } from "../lib/audio";
import type { LyricsResult, SyncedLyricLine, SyncedLyricWord } from "../lib/bridge";
import {
  activeLineIndex,
  depthStyle,
  isSectionLabel,
  lyricFalloff,
  resolveWordSpans,
  SEEK_LEAD_IN_S,
  sweepWindow,
  visibleLyricLines,
  wordPercent,
  type WordSpan,
} from "../lib/lyricsLines";
import { LYRICS_LOADING_LINES, pickLyricsLine } from "../lib/lyricsPhrases";
import { LYRIC_EASE, reducedMotion } from "../lib/motion";
import { romanize } from "../lib/romanize";
import { usePhone } from "../lib/usePhone";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";

const ANCHOR = 0.5;
const ART_ANCHOR = 0.4;
const GLIDE_MS = 600;
const LOADING_DELAY_MS = 300;
const GLIDE_CANCEL_SCREENS = 1.5;
const DEPTH_TRANSITION = "opacity var(--dur-quick) var(--ease-out)";
const LINE_BLUR_PX = [0, 0, 1.5, 3];
const DESKTOP_BLUR_MAX_PX = 2;
const ART_TRANSITION = "opacity var(--dur-quick) var(--ease-out), color var(--dur-quick) var(--ease-out), transform var(--dur-quick) var(--ease-out)";
const BROWSE_IDLE_MS = 3000;
const BROWSE_DRAG_PX = 6;
const CLICK_MOVE_PX = 5;
const MANUAL_SCROLL_GUARD_MS = 250;
const EDGE_MASK = "linear-gradient(to right, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%)";
const FADE_MASK = "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)";
const ART_FADE_MASK = "linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)";
const GLOW = "drop-shadow(0 0 22px rgb(var(--ink-1) / 0.28))";
const FOCUS_RING = "rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
const LINE_CLASS = "font-display text-[calc(40px*var(--lyric-scale))] leading-[1.25] tracking-[-0.03em] font-extrabold";
const ART_LINE_CLASS = "text-[calc(30px*var(--lyric-scale))] leading-[1.28] tracking-[-0.01em] font-medium [font-family:var(--font-lyric)] font-synthesis-none";
const ART_ACTIVE_CLASS = "text-[calc(30px*var(--lyric-scale))] leading-[1.28] tracking-[-0.01em] font-semibold [font-family:var(--font-lyric)] font-synthesis-none";
const SUB_CLASS = "font-display text-[calc(22px*var(--lyric-scale))] leading-[1.3] font-bold";
const ART_SUB_CLASS = "text-[calc(22px*var(--lyric-scale))] leading-[1.3] font-medium [font-family:var(--font-lyric)] font-synthesis-none";
const PHONE_ANCHOR = 0.34;
const PHONE_LINE_CLASS = "text-section font-semibold";
const PHONE_ACTIVE_CLASS = "text-[28px] leading-[36px] tracking-[-0.01em] font-semibold";
const PHONE_SUB_CLASS = "text-body leading-[22px] font-medium";
const TRANSLATION_CLASS = "text-body font-medium";
const BROWSING_OPACITY = 0.8;
const WORD_LIFT = "translateY(-2px)";
const RTL_SCRIPT = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

type Glide = { frame: number; from: number; to: number; start: number };
type GlideRef = MutableRefObject<Glide | null>;
type Words = NonNullable<SyncedLyricLine["words"]>;

type SyncedLyricsProps = {
  lyrics: LyricsResult | null;
  loading: boolean;
  offset?: number;
  trackKey?: string;
  onArt?: boolean;
  translate?: boolean;
};

function stopGlide(glideRef: GlideRef) {
  const glide = glideRef.current;
  if (glide) cancelAnimationFrame(glide.frame);
  glideRef.current = null;
}

function stepGlide(glideRef: GlideRef, scroller: HTMLElement) {
  const glide = glideRef.current;
  if (!glide) return;
  const frame = (now: number) => {
    const current = glideRef.current;
    if (!current) return;
    const t = Math.min(1, (now - current.start) / GLIDE_MS);
    scroller.scrollTop = current.from + (current.to - current.from) * (1 - (1 - t) ** 4);
    if (t >= 1) {
      glideRef.current = null;
      return;
    }
    current.frame = requestAnimationFrame(frame);
  };
  glide.frame = requestAnimationFrame(frame);
}

function scrollTargetFor(scroller: HTMLElement, line: HTMLElement, anchor: number): number {
  const lineBox = line.getBoundingClientRect();
  const scrollerBox = scroller.getBoundingClientRect();
  const middle = scroller.scrollTop + lineBox.top - scrollerBox.top + lineBox.height / 2;
  return Math.max(0, middle - scroller.clientHeight * anchor);
}

function LoadingLine({ phrase, onArt }: { phrase: string; onArt: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex justify-center py-12">
      {visible && (
        <p className={`font-display text-section tracking-[-0.02em] ${onArt ? "font-semibold text-art/[0.55]" : "font-extrabold text-ink-1/55"}`}>
          {phrase}
        </p>
      )}
    </div>
  );
}

function WordLine({
  words,
  spans,
  offset,
  still,
  onArt,
  lineClass,
  lineStyle,
}: {
  words: Words;
  spans: WordSpan[];
  offset: number;
  still: boolean;
  onArt: boolean;
  lineClass: string;
  lineStyle?: CSSProperties;
}) {
  const playing = usePlayer((state) => state.playing);
  const [, redraw] = useReducer((count: number) => (count + 1) % 1000000, 0);
  const position = useRef(0);

  useEffect(() => {
    position.current = getPlaybackPosition() - offset;
    redraw();
    if (!playing || still) return;
    let frame = 0;
    const tick = () => {
      position.current = getPlaybackPosition() - offset;
      redraw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, offset, still]);

  return (
    <span className={lineClass} style={lineStyle}>
      {words.map((word: SyncedLyricWord, index) => {
        const percent = wordPercent(position.current, spans[index] ?? { start: word.start, end: word.end });
        return (
          <span key={index}>
            {index > 0 ? " " : ""}
            <span
              style={{
                backgroundImage: onArt
                  ? `linear-gradient(90deg, rgb(var(--on-art)) ${percent}%, rgb(var(--on-art) / 0.18) ${percent}%)`
                  : `linear-gradient(90deg, rgb(var(--ink-1)) ${percent}%, rgb(var(--ink-1) / 0.28) ${percent}%)`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                ...(still
                  ? {}
                  : {
                      display: "inline-block",
                      transform: percent > 0 && percent < 100 ? WORD_LIFT : undefined,
                      transition: `transform var(--dur-lyric) ${LYRIC_EASE}`,
                    }),
              }}
            >
              {word.text}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function GapDots({ opacity, onArt }: { opacity: number; onArt: boolean }) {
  return (
    <div
      role="img"
      aria-label="Instrumental"
      title="Instrumental"
      className="flex items-center gap-1.5 py-1"
      style={{ opacity: Math.max(0.15, opacity) }}
    >
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className={`h-1.5 w-1.5 rounded-full ${onArt ? "bg-art" : "bg-ink-1/80"}`}
          style={onArt ? undefined : { boxShadow: "0 0 12px rgba(255,255,255,0.5)" }}
        />
      ))}
    </div>
  );
}

function SourceCredit({ source, onArt }: { source: string; onArt: boolean }) {
  if (!source) return null;
  return <p className={`pt-4 text-meta font-medium ${onArt ? "text-art/[0.55]" : "text-ink-2"}`}>Lyrics from {source}</p>;
}

function EmptyText({ onArt }: { onArt: boolean }) {
  return <p className={`py-16 text-center text-base ${onArt ? "text-art/[0.55]" : "text-ink-2"}`}>No lyrics available for this track.</p>;
}

export function SyncedLyrics({ lyrics, loading, offset = 0, trackKey, onArt = false, translate = false }: SyncedLyricsProps) {
  const position = usePlayer((state) => state.position);
  const playing = usePlayer((state) => state.playing);
  const seek = usePlayer((state) => state.seek);
  const syncedOn = useSettings((state) => state.syncedLyrics);
  const blurOn = useSettings((state) => state.blurUnfocusedLyrics);
  const romanOn = useSettings((state) => state.romanizeLyrics);
  const reduceAnimation = useSettings((state) => state.reduceAnimation);
  const reduceBlur = useSettings((state) => state.reduceDynamicBlur);
  const still = reduceAnimation || reducedMotion();
  const phone = usePhone();
  const anchor = phone ? PHONE_ANCHOR : onArt ? ART_ANCHOR : ANCHOR;
  const blurLines = blurOn && !still && !reduceBlur && !phone;
  const source = lyrics?.source ?? "";
  const phrase = useMemo(() => pickLyricsLine(LYRICS_LOADING_LINES, trackKey ?? source), [trackKey, source]);

  const synced = lyrics?.synced ?? null;
  const lines = useMemo(() => {
    const visible = synced ? visibleLyricLines(synced) : [];
    return visible.length > 0 ? visible : null;
  }, [synced]);

  const staticText = useMemo(() => {
    if (lyrics?.plain?.trim()) return lyrics.plain;
    const joined = (synced ?? [])
      .map((line) => line.text.trim())
      .filter((text) => text !== "")
      .join("\n");
    return joined === "" ? null : joined;
  }, [lyrics, synced]);

  const activeIndex = lines ? activeLineIndex(lines, position - offset) : -1;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const glideRef: GlideRef = useRef<Glide | null>(null);
  const lastActive = useRef(-1);
  const [browsing, setBrowsing] = useState(false);
  const browsingRef = useRef(false);
  const idleTimer = useRef<number | null>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const manualAt = useRef(Number.NEGATIVE_INFINITY);

  const endBrowsing = useCallback(() => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = null;
    browsingRef.current = false;
    setBrowsing(false);
  }, []);

  const markBrowsing = useCallback(() => {
    stopGlide(glideRef);
    manualAt.current = performance.now();
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(endBrowsing, BROWSE_IDLE_MS);
    if (browsingRef.current) return;
    browsingRef.current = true;
    lastActive.current = -1;
    setBrowsing(true);
  }, [endBrowsing]);

  useEffect(
    () => () => {
      stopGlide(glideRef);
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (activeIndex < 0 || browsing) return;
    const moved = lastActive.current !== activeIndex;
    lastActive.current = activeIndex;
    const frame = requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      const line = activeRef.current;
      if (!scroller || !line) return;
      const target = scrollTargetFor(scroller, line, anchor);
      if (!moved) {
        if (glideRef.current) glideRef.current.to = target;
        else scroller.scrollTop = target;
        return;
      }
      stopGlide(glideRef);
      const from = scroller.scrollTop;
      if (still || Math.abs(target - from) > scroller.clientHeight * GLIDE_CANCEL_SCREENS) {
        scroller.scrollTop = target;
        return;
      }
      glideRef.current = { frame: 0, from, to: target, start: performance.now() };
      stepGlide(glideRef, scroller);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, lines, still, browsing, anchor]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!onArt || !scroller || !content || typeof ResizeObserver === "undefined") return;
    const measure = () => setFits(content.offsetHeight <= scroller.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(content);
    return () => observer.disconnect();
  }, [onArt, lines, loading, staticText]);

  if (loading) return <LoadingLine phrase={phrase} onArt={onArt} />;

  if (!staticText) return <EmptyText onArt={onArt} />;

  if (!syncedOn || !lines) {
    return (
      <div data-lyrics-scroll="" className="flex min-h-0 flex-1 flex-col overflow-y-auto no-scrollbar">
        <pre className={`whitespace-pre-wrap py-2 font-sans text-body leading-7 ${onArt ? "text-art/[0.55]" : "text-ink-2"}`}>{staticText}</pre>
        <SourceCredit source={source} onArt={onArt} />
      </div>
    );
  }

  const fadeMask = onArt ? ART_FADE_MASK : FADE_MASK;

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-line]"));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[Math.min(buttons.length - 1, Math.max(0, index + step))].focus();
  };

  const renderLine = (line: SyncedLyricLine, index: number) => {
    const focus = !browsing;
    const anchorIndex = activeIndex < 0 && (phone || !onArt) ? 0 : activeIndex;
    const distance = Math.abs(index - anchorIndex);
    const depth = depthStyle(index - anchorIndex, index < anchorIndex, false);
    const active = index === activeIndex;
    const current = index === anchorIndex;
    const fall = lyricFalloff(index - anchorIndex);
    const opacity = phone ? (browsing ? BROWSING_OPACITY : fall.opacity) : 1;
    const phoneMotion = still
      ? { transition: "none" }
      : {
          transition: `opacity var(--dur-lyric) ${LYRIC_EASE}, transform var(--dur-lyric) ${LYRIC_EASE}, filter var(--dur-lyric) ${LYRIC_EASE}`,
          transitionDelay: `calc(var(--dur-lyric) * ${Math.min(distance, 3) * 0.06})`,
        };
    const motionStyle = phone
      ? phoneMotion
      : still
        ? { transition: "none" }
        : { transition: onArt ? ART_TRANSITION : DEPTH_TRANSITION };
    if (line.gap) {
      return (
        <div key={index} style={{ ...motionStyle, opacity }}>
          <GapDots opacity={opacity} onArt={onArt} />
        </div>
      );
    }
    if (isSectionLabel(line.text)) {
      return (
        <h3 key={index} className={`pt-2 text-body ${onArt ? "font-medium text-art/[0.45]" : "font-semibold text-ink-2"}`}>
          {line.text.trim().slice(1, -1)}
        </h3>
      );
    }

    const artBlur = focus && !still && !reduceBlur && distance > 2 ? 1 : 0;
    const phoneBlur = !still && !reduceBlur && focus && playing ? fall.blurPx : 0;
    const deskBlur = focus && blurLines && playing && distance <= 3 ? Math.min(LINE_BLUR_PX[distance], DESKTOP_BLUR_MAX_PX) : 0;
    const blurPx = phone ? phoneBlur : onArt ? artBlur : deskBlur;
    const filters = [blurPx > 0 ? `blur(${blurPx}px)` : "", !onArt && current && focus && blurLines ? GLOW : ""].filter(Boolean).join(" ");
    const roman = romanOn ? (line.roman ?? romanize(line.text)) : null;
    const words = line.words ?? [];
    const wordSynced = active && words.length > 0;
    const [spanStart, spanEnd] = wordSynced ? sweepWindow(lines, index) : [0, 0];
    const ink = phone
      ? onArt ? "text-art" : active ? "text-ink-1" : "text-ink-2"
      : onArt ? (active ? "text-art" : "text-art/[0.45]") : current ? "text-ink-1" : distance <= 2 ? "text-ink-2" : "text-ink-3";
    const subInk = onArt ? "text-art/[0.45]" : "text-ink-2";
    const subClass = phone ? PHONE_SUB_CLASS : onArt ? ART_SUB_CLASS : SUB_CLASS;
    const phoneEnlarged = phone && active && focus;
    const lineClass = phone
      ? phoneEnlarged ? PHONE_ACTIVE_CLASS : PHONE_LINE_CLASS
      : onArt ? (active ? ART_ACTIVE_CLASS : ART_LINE_CLASS) : LINE_CLASS;
    const lineStyle: CSSProperties | undefined = phone && !still ? { transition: `font-size var(--dur-lyric) ${LYRIC_EASE}` } : undefined;
    const rtl = RTL_SCRIPT.test(line.text);
    const translation = translate ? line.translation : undefined;
    return (
      <button
        key={index}
        ref={active ? activeRef : undefined}
        type="button"
        data-line
        aria-current={active ? "true" : undefined}
        onClick={() => {
          if (dragged.current || performance.now() - manualAt.current < MANUAL_SCROLL_GUARD_MS) return;
          endBrowsing();
          seek(Math.max(0, line.time + offset - SEEK_LEAD_IN_S));
        }}
        dir="auto"
        className={`group block w-full text-start ${ink} ${FOCUS_RING}`}
        style={{
          ...motionStyle,
          opacity,
          filter: filters || undefined,
          transform: phone
            ? undefined
            : onArt ? (active && focus && !still ? "scale(1.06)" : undefined) : focus ? depth.transform : undefined,
          maxWidth: phone ? "100%" : undefined,
          overflowWrap: phone ? "anywhere" : undefined,
          transformOrigin: rtl ? "right center" : "left center",
        }}
      >
        <span className={phone && !still ? "block motion-safe:transition-transform motion-safe:duration-fade motion-safe:group-active:scale-[0.96]" : "block"}>
          {wordSynced ? (
            <WordLine
              words={words}
              spans={resolveWordSpans(words, spanStart, spanEnd)}
              offset={offset}
              still={still}
              onArt={onArt}
              lineClass={lineClass}
              lineStyle={lineStyle}
            />
          ) : (
            <span className={lineClass} style={lineStyle}>
              {line.text}
            </span>
          )}
          {line.bg && <span className={`mt-1 block opacity-70 ${subClass}`}>{line.bg.text}</span>}
          {roman && <span className={`mt-1 block ${subInk} ${subClass}`}>{roman}</span>}
          {translation && <span className={`mt-1 block ${subInk} ${TRANSLATION_CLASS}`}>{translation}</span>}
        </span>
      </button>
    );
  };

  return (
    <div className="relative -mx-6 flex min-h-0 flex-1" style={{ maskImage: EDGE_MASK, WebkitMaskImage: EDGE_MASK }}>
      <div
        ref={scrollerRef}
        data-lyrics-scroll=""
        className="no-scrollbar absolute inset-0 touch-pan-y overflow-x-hidden overflow-y-auto px-6"
        style={{ maskImage: fadeMask, WebkitMaskImage: fadeMask }}
        onWheel={markBrowsing}
        onTouchMove={markBrowsing}
        onPointerDown={(event) => {
          stopGlide(glideRef);
          dragged.current = false;
          pressAt.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const press = pressAt.current;
          if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > BROWSE_DRAG_PX) markBrowsing();
        }}
        onPointerUp={(event) => {
          const press = pressAt.current;
          dragged.current = press !== null && Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_MOVE_PX;
          pressAt.current = null;
        }}
        onPointerCancel={() => {
          dragged.current = true;
          pressAt.current = null;
        }}
      >
        {!(onArt && fits) && <div style={{ height: "calc(10% + 4px)" }} />}
        <div className={onArt && fits ? "flex min-h-full flex-col justify-center" : undefined}>
          <div ref={contentRef} className={`flex flex-col ${phone ? "space-y-3.5" : "space-y-5"}`} onKeyDown={moveFocus}>
            {lines.map(renderLine)}
          </div>
          <SourceCredit source={source} onArt={onArt} />
        </div>
        {!(onArt && fits) && <div style={{ height: `max(12px, calc(${anchor * 100}% - 28px))` }} />}
      </div>
    </div>
  );
}
