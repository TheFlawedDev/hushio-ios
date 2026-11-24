import { platform, type Platform } from "./bridge";
import { DATA_SAVER_ART_SIZE, setArtworkSize } from "./artwork";
import { desktopAppearance } from "./desktopAppearance";
import { applyFontVars } from "./fonts";
import { motionVars } from "./motion";
import { useSettings, type LyricsTextSize } from "../stores/settings";

const OS_REDUCE_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const PLATFORM_CLASSES: Record<Platform, string> = {
  windows: "platform-windows",
  macos: "platform-mac",
  linux: "platform-linux",
  android: "platform-android",
  ios: "platform-ios",
};

const MANAGED_CLASSES = ["reduce-motion", "reduce-blur", ...Object.values(PLATFORM_CLASSES)];

const LYRIC_SCALE: Record<LyricsTextSize, string> = {
  small: "0.78",
  medium: "1",
  large: "1.28",
};

export function lyricScale(size: LyricsTextSize): string {
  return LYRIC_SCALE[size] ?? "1";
}

type HtmlFlags = {
  reduceAnimation: boolean;
  reduceDynamicBlur: boolean;
  osReduceMotion: boolean;
  desktopReduceMotion: boolean;
  systemMotion: boolean;
  platform: Platform;
};

function htmlClassNames(flags: HtmlFlags): string[] {
  const names = [PLATFORM_CLASSES[flags.platform]];
  if (flags.reduceAnimation || flags.osReduceMotion || flags.desktopReduceMotion || flags.systemMotion) {
    names.push("reduce-motion");
  }
  if (flags.reduceDynamicBlur) names.push("reduce-blur");
  return names;
}

function applyHtmlClasses(root: HTMLElement, flags: HtmlFlags): void {
  root.classList.remove(...MANAGED_CLASSES);
  const names = htmlClassNames(flags);
  root.classList.add(...names);
  const reduced = names.includes("reduce-motion");
  for (const [name, value] of Object.entries(motionVars(reduced))) {
    root.style.setProperty(name, value);
  }
  root.style.setProperty("--lyric-scale", lyricScale(useSettings.getState().lyricsTextSize));
  applyFontVars(root, useSettings.getState().appFont);
}

function currentFlags(): HtmlFlags {
  const settings = useSettings.getState();
  return {
    reduceAnimation: settings.reduceAnimation,
    reduceDynamicBlur: settings.reduceDynamicBlur,
    osReduceMotion: window.matchMedia?.(OS_REDUCE_MOTION_QUERY)?.matches ?? false,
    desktopReduceMotion: desktopAppearance().reduceMotion,
    systemMotion: document.documentElement.dataset.systemMotion === "reduce",
    platform,
  };
}

export function refreshHtmlClasses(): void {
  applyHtmlClasses(document.documentElement, currentFlags());
  const settings = useSettings.getState();
  setArtworkSize(settings.dataSaver ? DATA_SAVER_ART_SIZE : 544);
}

export function startHtmlClasses(): () => void {
  refreshHtmlClasses();
  const unsubscribe = useSettings.subscribe(refreshHtmlClasses);
  const query = window.matchMedia?.(OS_REDUCE_MOTION_QUERY);
  query?.addEventListener("change", refreshHtmlClasses);
  window.addEventListener("hushio-system-motion", refreshHtmlClasses);
  return () => {
    unsubscribe();
    query?.removeEventListener("change", refreshHtmlClasses);
    window.removeEventListener("hushio-system-motion", refreshHtmlClasses);
  };
}
