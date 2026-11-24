import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { motion } from "motion/react";
import { CaretDown, CaretUp, DotsSixVertical, Radio, Repeat, RepeatOnce, Shuffle, Trash, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { PHONE_ROW_DP, PhoneTrackRow } from "./PhoneTrackRow";
import { PhoneIcon } from "./PhoneIcon";
import { VirtualList, scrollerOf } from "../VirtualList";
import { autoScrollStep, dropIndex, slideOffset } from "../../lib/dragReorder";
import { haptic } from "../../lib/haptics";
import { PHONE_MS, gate, phoneTween, reducedMotion } from "../../lib/motion";
import { nowPlayingSourceName } from "../../lib/nowPlayingSource";
import { queueEntryKeys } from "../../lib/queueKeys";
import { songOf, trackMenuItems } from "../../lib/trackActions";
import { trackToastOptions } from "../../lib/toastStack";
import { useLibrary } from "../../stores/library";
import { usePlayer, type RepeatMode } from "../../stores/player";
import { useSettings } from "../../stores/settings";
import { useUI } from "../../stores/ui";
import type { Track } from "../../types";

const UNDO_MS = 5000;
const AUTO_SCROLL_EDGE_PX = 56;
const AUTO_SCROLL_MAX_PX = 18;
const HEADING ="px-4 pb-1 pt-3 font-title text-card-title leading-[26px] font-bold tracking-[-0.02em] text-ink-1";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Enable repeat",
  all: "Disable repeat",
  one: "Disable repeat one",
};

type Drag = { from: number; travel: number; target: number } | null;

type Session = {
  from: number;
  minIndex: number;
  count: number;
  startY: number;
  y: number;
  scroller: HTMLElement | null;
  scrollBase: number;
  target: number;
};

function ModeButton({ label, icon, on, onPress }: { label: string; icon: PhosphorIcon; on: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onPress}
      className={`grid size-11 place-items-center rounded-full motion-safe:transition-colors motion-safe:duration-press ${on ? "text-accent" : "text-ink-2"} ${FOCUS}`}
    >
      <PhoneIcon icon={icon} />
    </button>
  );
}

function QueueModes() {
  const shuffle = usePlayer((state) => state.shuffle);
  const repeat = usePlayer((state) => state.repeat);
  const toggleShuffle = usePlayer((state) => state.toggleShuffle);
  const cycleRepeat = usePlayer((state) => state.cycleRepeat);
  const autoplay = useSettings((state) => state.autoplay);
  const press = (run: () => void) => {
    haptic("tick");
    run();
  };
  return (
    <div role="group" aria-label="Playback modes" className="flex justify-center gap-2 px-4 pb-1 pt-3">
      <ModeButton
        label={shuffle ? "Disable shuffle" : "Enable shuffle"}
        icon={Shuffle}
        on={shuffle}
        onPress={() => press(toggleShuffle)}
      />
      <ModeButton
        label={REPEAT_LABEL[repeat]}
        icon={repeat === "one" ? RepeatOnce : Repeat}
        on={repeat !== "off"}
        onPress={() => press(cycleRepeat)}
      />
      <ModeButton
        label={autoplay ? "Disable autoplay" : "Enable autoplay"}
        icon={Radio}
        on={autoplay}
        onPress={() => press(() => useSettings.getState().setValue("autoplay", !autoplay))}
      />
    </div>
  );
}

export function PhoneQueueList() {
  const queue = usePlayer((state) => state.queue);
  const index = usePlayer((state) => state.index);
  const autoplayCount = usePlayer((state) => state.autoplayCount);
  const playingFrom = usePlayer((state) => state.playingFrom);
  const jumpTo = usePlayer((state) => state.jumpTo);
  const moveUpcoming = usePlayer((state) => state.moveUpcoming);
  const clearUpcoming = usePlayer((state) => state.clearUpcoming);
  const playlists = useLibrary((state) => state.playlists);
  const openContextMenu = useUI((state) => state.openContextMenu);
  const [drag, setDrag] = useState<Drag>(null);
  const [showPrevious, setShowPrevious] = useState(false);
  const session = useRef<Session | null>(null);
  const dragging = drag !== null;
  const keys = useMemo(() => queueEntryKeys(queue), [queue]);
  const reduced = reducedMotion();

  const autoplayStart = Math.max(index + 1, queue.length - autoplayCount);
  const previous = queue.slice(0, index).map((track, at) => ({ track, at }));
  const upcoming = queue.slice(index + 1, autoplayStart).map((track, offset) => ({ track, at: index + 1 + offset }));
  const autoplayItems = queue.slice(autoplayStart).map((track, offset) => ({ track, at: autoplayStart + offset }));
  const current = queue[index];
  const sourceName = nowPlayingSourceName(playingFrom, current?.album ?? undefined, (id) => playlists.find((item) => item.id === id)?.name);

  const applyDrag = () => {
    const active = session.current;
    if (!active) return;
    const scrolled = (active.scroller?.scrollTop ?? active.scrollBase) - active.scrollBase;
    const raw = active.y - active.startY + scrolled;
    const low = (active.minIndex - active.from) * PHONE_ROW_DP;
    const high = (active.count - 1 - active.from) * PHONE_ROW_DP;
    const travel = Math.min(Math.max(raw, low), high);
    const target = Math.max(active.minIndex, dropIndex(active.from, travel, PHONE_ROW_DP, active.count));
    if (target !== active.target) {
      active.target = target;
      haptic("tick");
    }
    setDrag((current) =>
      current && current.travel === travel && current.target === target ? current : { from: active.from, travel, target },
    );
  };

  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const step = () => {
      const active = session.current;
      const scroller = active?.scroller;
      if (active && scroller) {
        const box = scroller.getBoundingClientRect();
        const delta = autoScrollStep(active.y, box.top, box.bottom, AUTO_SCROLL_EDGE_PX, AUTO_SCROLL_MAX_PX);
        if (delta !== 0) scroller.scrollTop += delta;
      }
      applyDrag();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  const finish = () => {
    const active = session.current;
    session.current = null;
    if (active && active.target !== active.from) moveUpcoming(active.from, active.target);
    setDrag(null);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = session.current;
    if (!active) return;
    active.y = event.clientY;
    applyDrag();
  };

  const menuFor = (track: Track, event: { currentTarget: EventTarget & Element }, at?: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const items = trackMenuItems(songOf(track));
    if (at !== undefined) {
      if (at > index + 1) {
        items.push({
          label: "Move up",
          icon: CaretUp,
          onSelect: () => {
            moveUpcoming(at, at - 1);
            haptic("tick");
          },
        });
      }
      if (at < autoplayStart - 1) {
        items.push({
          label: "Move down",
          icon: CaretDown,
          onSelect: () => {
            moveUpcoming(at, at + 1);
            haptic("tick");
          },
        });
      }
      items.push({
        label: "Remove from queue",
        icon: Trash,
        danger: true,
        onSelect: () => removeUpcoming(at, track),
      });
    }
    openContextMenu(rect.left, rect.top, items);
  };

  const beginDrag = (at: number, event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const scroller = scrollerOf(event.currentTarget);
    session.current = {
      from: at,
      minIndex: index + 1,
      count: autoplayStart,
      startY: event.clientY,
      y: event.clientY,
      scroller,
      scrollBase: scroller?.scrollTop ?? 0,
      target: at,
    };
    setDrag({ from: at, travel: 0, target: at });
    haptic("select");
  };

  const removeUpcoming = (at: number, track: Track) => {
    usePlayer.getState().removeAt(at);
    useUI.getState().toast("Removed from queue", "info", UNDO_MS, { label: "Undo", run: () => restoreUpcoming(track, at) }, trackToastOptions(track));
  };

  const restoreUpcoming = (track: Track, at: number) => {
    const player = usePlayer.getState();
    const current = player.index;
    if (player.addToQueue([track], true) === 0) return;
    const inserted = current + 1;
    if (inserted !== at) player.moveUpcoming(inserted, at);
  };

  return (
    <div className="flex flex-col pb-2" onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={finish}>
      <QueueModes />
      {index > 0 && (
        <div className="px-1">
          <button
            type="button"
            aria-expanded={showPrevious}
            onClick={() => setShowPrevious((open) => !open)}
            className={`min-h-12 px-3 text-meta font-medium text-ink-2 ${FOCUS}`}
          >
            {showPrevious ? "Hide previously played" : "Show previously played"}
          </button>
        </div>
      )}
      {showPrevious && index > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={gate(reduced, phoneTween(PHONE_MS.navFade))}>
          <VirtualList
            label="Previously played"
            items={previous}
            rowHeight={PHONE_ROW_DP}
            getKey={(item) => keys[item.at]}
            renderRow={({ track, at }) => (
              <PhoneTrackRow track={track} index={at} onPress={() => jumpTo(at)} onMore={(event) => menuFor(track, event)} />
            )}
          />
        </motion.div>
      )}
      {current && (
        <>
          <h3 className={HEADING}>Now playing</h3>
          <PhoneTrackRow
            track={current}
            index={index}
            active
            onPress={() => jumpTo(index)}
            onMore={(event) => menuFor(current, event)}
          />
        </>
      )}
      {playingFrom && sourceName ? <p className="px-4 pb-2 text-meta text-ink-2">Playing from {sourceName}</p> : null}
      <div className="flex items-center justify-between pr-4">
        <h3 className={HEADING}>Up next</h3>
        <button
          type="button"
          onClick={clearUpcoming}
          disabled={upcoming.length === 0 && autoplayItems.length === 0}
          className="min-h-12 px-3 text-meta font-medium text-ink-2 disabled:opacity-[var(--disabled-opacity)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Clear
        </button>
      </div>
      {upcoming.length === 0 ? (
        <p className="px-4 py-3 text-body text-ink-2">Nothing up next</p>
      ) : (
        <VirtualList
          label="Up next"
          items={upcoming}
          rowHeight={PHONE_ROW_DP}
          getKey={(item) => keys[item.at]}
          renderRow={({ track, at }) => (
            <PhoneTrackRow
              track={track}
              index={at}
              dragging={drag?.from === at}
              dragOffset={drag ? (drag.from === at ? drag.travel : slideOffset(at, drag.from, drag.target, PHONE_ROW_DP)) : 0}
              onPress={() => jumpTo(at)}
              onMore={(event) => menuFor(track, event, at)}
              swipeLeft={{ label: "Remove", icon: Trash, tone: "danger", run: () => removeUpcoming(at, track) }}
              handle={
                <div className="flex items-center">
                  <button
                    type="button"
                    aria-label={`Move ${track.title} up`}
                    disabled={at <= index + 1}
                    onClick={() => {
                      if (at > index + 1) {
                        moveUpcoming(at, at - 1);
                        haptic("tick");
                      }
                    }}
                    className="sr-only focus:not-sr-only focus:relative focus:z-10 focus:rounded focus:px-1 focus:text-caption focus:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${track.title} down`}
                    disabled={at >= autoplayStart - 1}
                    onClick={() => {
                      if (at < autoplayStart - 1) {
                        moveUpcoming(at, at + 1);
                        haptic("tick");
                      }
                    }}
                    className="sr-only focus:not-sr-only focus:relative focus:z-10 focus:rounded focus:px-1 focus:text-caption focus:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${track.title} from queue`}
                    onClick={() => removeUpcoming(at, track)}
                    className="sr-only focus:not-sr-only focus:relative focus:z-10 focus:rounded focus:px-1 focus:text-caption focus:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    Remove from queue
                  </button>
                  <button
                    type="button"
                    aria-label={`Drag ${track.title} to reorder`}
                    onPointerDown={(event) => beginDrag(at, event)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp" && at > index + 1) {
                        event.preventDefault();
                        moveUpcoming(at, at - 1);
                        haptic("tick");
                      } else if (event.key === "ArrowDown" && at < autoplayStart - 1) {
                        event.preventDefault();
                        moveUpcoming(at, at + 1);
                        haptic("tick");
                      }
                    }}
                    className="grid h-12 w-10 shrink-0 cursor-grab touch-none place-items-center rounded-full text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <PhoneIcon icon={DotsSixVertical} />
                  </button>
                </div>
              }
            />
          )}
        />
      )}
      {autoplayItems.length > 0 && (
        <>
          <h3 className={HEADING}>Autoplay</h3>
          <p className="px-4 pb-2 text-meta text-ink-2">Similar songs play after your queue ends.</p>
          <VirtualList
            label="Autoplay"
            items={autoplayItems}
            rowHeight={PHONE_ROW_DP}
            getKey={(item) => keys[item.at]}
            renderRow={({ track, at }) => (
              <PhoneTrackRow
                track={track}
                index={at}
                onPress={() => jumpTo(at)}
                onMore={(event) => menuFor(track, event, at)}
                swipeLeft={{ label: "Remove", icon: Trash, tone: "danger", run: () => removeUpcoming(at, track) }}
              />
            )}
          />
        </>
      )}
    </div>
  );
}
