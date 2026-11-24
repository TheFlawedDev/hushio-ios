import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion, useTransform } from "motion/react";
import { Dialog } from "../Dialog";
import { ErrorBoundary } from "../ErrorBoundary";
import { PlaylistPicker } from "../PlaylistPicker";
import { PlaylistEditDialog } from "../PlaylistEditDialog";
import { Toasts } from "../Toasts";
import { MiniPlayer } from "./MiniPlayer";
import { NotificationBanner } from "./NotificationBanner";
import { PhoneMenuSheet } from "./PhoneMenuSheet";
import { PhoneNowPlaying } from "./PhoneNowPlaying";
import { opennessOf, pageCardOf, sheetY, watchSheetInterruptions } from "./sheetTravel";
import { TabBar } from "./TabBar";
import { useEdgeBack } from "./useEdgeBack";
import { CurrentView } from "../../views/CurrentView";
import { PHONE_MS, fade, gate, phoneSmooth, phoneTween, reducedMotion } from "../../lib/motion";
import { navDirection, type NavDirection, type NavSnapshot } from "../../lib/navDirection";
import { useScrimMounted } from "../../lib/useScrimMounted";
import { INSET_TOP, INSET_BOTTOM, phoneBottomPad } from "../../lib/phoneNav";
import { currentTrack, usePlayer } from "../../stores/player";
import { useNavigation } from "../../stores/navigation";
import { useUI } from "../../stores/ui";

const SLIDE_PX = 24;

export function PhoneShell() {
  const view = useNavigation((state) => state.view);
  const tab = useNavigation((state) => state.tab);
  const past = useNavigation((state) => state.navPast.length);
  const future = useNavigation((state) => state.navFuture.length);
  const goBack = useNavigation((state) => state.goBack);
  const nowPlayingOpen = useUI((state) => state.nowPlayingOpen);
  const overlayOpen = useUI((state) =>
    Boolean(state.nowPlayingOpen || state.contextMenu || state.dialog || state.playlistPicker || state.phoneQueueOpen || state.phoneLyricsOpen),
  );
  const edge = useEdgeBack({ enabled: past > 0 && !overlayOpen, onBack: goBack });
  const pendingScroll = useNavigation((state) => state.pendingScroll);
  const viewReloadNonce = useNavigation((state) => state.viewReloadNonce);
  const clearPendingScroll = useNavigation((state) => state.clearPendingScroll);
  const track = usePlayer(currentTrack);
  const reduced = reducedMotion();
  const openness = useTransform(sheetY, opennessOf);
  const card = useTransform(openness, (p) => pageCardOf(p, reduced));
  const pageScale = useTransform(card, (c) => c.scale);
  const pageRadius = useTransform(card, (c) => c.radius);
  const pageShade = useTransform(card, (c) => c.shade);
  const scrimOn = useScrimMounted(pageShade);
  const last = useRef<{ key: string; snap: NavSnapshot; direction: NavDirection }>({
    key: "",
    snap: { view, past, future, tab },
    direction: "none",
  });
  const historyKey = `${view.name}:${view.param ?? ""}|${past}|${future}`;
  if (last.current.key !== historyKey) {
    const snap: NavSnapshot = { view, past, future, tab };
    last.current = { key: historyKey, snap, direction: last.current.key === "" ? "none" : navDirection(last.current.snap, snap) };
  }
  const direction = last.current.direction;
  const slide = direction === "push" ? SLIDE_PX : direction === "pop" ? -SLIDE_PX : 0;

  useEffect(watchSheetInterruptions, []);

  useLayoutEffect(() => {
    if (pendingScroll === null) return;
    const scroller = document.getElementById("view-scroll");
    if (scroller) scroller.scrollTop = pendingScroll;
    clearPendingScroll();
  }, [pendingScroll, clearPendingScroll]);

  const screenKey = `${viewReloadNonce}:${view.name}:${view.param ?? ""}`;
  const screen = useMemo(
    () => (
      <ErrorBoundary scope="view" resetKey={`${viewReloadNonce}:${view.name}`}>
        <CurrentView view={view} />
      </ErrorBoundary>
    ),
    [view, viewReloadNonce],
  );

  const scrollToTop = () => {
    document.getElementById("view-scroll")?.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  return (
    <div spellCheck={false} className="relative flex h-screen supports-[height:100dvh]:h-dvh select-none flex-col overflow-hidden bg-base text-ink-1">
      {scrimOn && <div aria-hidden="true" className="absolute inset-0 bg-black" />}
      <motion.div
        data-phone-page
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-base will-change-transform"
        style={{ scale: pageScale, borderRadius: pageRadius, transformOrigin: "50% 0%" }}
      >
        <div
          aria-hidden="true"
          data-status-strip
          onClick={scrollToTop}
          className="absolute inset-x-0 top-0 z-10 bg-[color:var(--phone-status-bg,rgb(var(--base)))] motion-safe:transition-colors motion-safe:duration-swap"
          style={{ height: INSET_TOP }}
        />
        <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" style={{ x: edge.x, opacity: edge.shadow, boxShadow: "-12px 0 24px rgb(0 0 0)" }} />
        <motion.main
          style={{ x: edge.x }}
          aria-hidden={nowPlayingOpen ? true : undefined}
          inert={nowPlayingOpen || undefined}
          className={`relative isolate z-0 min-h-0 flex-1 overflow-hidden will-change-transform ${nowPlayingOpen ? "pointer-events-none" : ""}`}
        >
          <div
            id="view-scroll"
            className="no-scrollbar h-full overflow-y-auto overflow-x-hidden"
            style={{ paddingBottom: phoneBottomPad(track !== null) }}
          >
            <div className="relative">
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={screenKey}
                  initial={reduced ? false : { opacity: 0, x: slide }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, transition: gate(reduced, fade) }}
                  transition={
                    direction === "push" || direction === "pop"
                      ? { x: phoneSmooth, opacity: phoneTween(PHONE_MS.navFade) }
                      : phoneTween(PHONE_MS.tab)
                  }
                  className="px-4"
                  style={{ paddingTop: `calc(${INSET_TOP} + 12px)` }}
                >
                  {screen}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 bg-scrim" style={{ opacity: edge.shade }} />
        </motion.main>
        <div
          aria-hidden={nowPlayingOpen ? true : undefined}
          inert={nowPlayingOpen || undefined}
          className="absolute inset-x-0 bottom-0 z-20 overflow-hidden rounded-t-[24px] border-t border-separator bg-surface shadow-[0_-4px_24px_rgb(0_0_0/0.12)]"
        >
          <MiniPlayer />
          <TabBar />
          <div aria-hidden="true" className="bg-surface" style={{ height: INSET_BOTTOM }} />
        </div>
        {scrimOn && <motion.div aria-hidden="true" data-page-shade className="pointer-events-none absolute inset-0 z-30 bg-black will-change-[opacity]" style={{ opacity: pageShade }} />}
      </motion.div>

      <PhoneNowPlaying />
      <Toasts />
      <NotificationBanner />
      <Dialog sheet />
      <PlaylistEditDialog />
      <PlaylistPicker />
      <PhoneMenuSheet />
    </div>
  );
}
