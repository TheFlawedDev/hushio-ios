import { listenPlayerEvent, platform, playerGetInsets, type Insets } from "./bridge";

const SIDES = ["top", "bottom", "left", "right"] as const;
const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

export function applyInsets(insets: Insets, root: HTMLElement = document.documentElement): void {
  for (const side of SIDES) {
    const px = Number.isFinite(insets[side]) ? Math.max(0, insets[side]) : 0;
    root.style.setProperty(`--inset-${side}`, `${px}px`);
  }
}

export async function refreshInsets(): Promise<void> {
  applyInsets(await playerGetInsets().catch(() => NO_INSETS));
}

export function startInsets(): () => void {
  // iOS/WKWebView exposes safe areas through CSS env(safe-area-inset-*), which
  // phoneNav already uses as its fallback. Running the native inset bridge here
  // would write a second, potentially zero, value over that system coordinate.
  if (platform === "ios") return () => {};
  let live = true;
  let stopListening: (() => void) | undefined;
  const refresh = () => void refreshInsets();

  void listenPlayerEvent<Insets>("insets", applyInsets)
    .then((stop) => {
      if (live) stopListening = stop;
      else stop();
    })
    .catch(() => {});
  refresh();
  window.addEventListener("resize", refresh);
  document.addEventListener("visibilitychange", refresh);

  return () => {
    live = false;
    stopListening?.();
    window.removeEventListener("resize", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}
