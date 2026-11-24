import { create } from "zustand";
import { APP_NAME } from "../lib/app";
import {
  appVersion,
  listenUpdates,
  openExternal,
  persistRead,
  persistWrite,
  platform,
  updateCheck,
  updatesCheck,
  updatesInstall,
  updatesRestart,
  updatesState,
} from "../lib/bridge";
import {
  ANDROID_UPDATE_FIRST_CHECK_MS,
  ANDROID_UPDATE_TICK_MS,
  shouldCheck,
} from "../lib/androidUpdateSchedule";
import {
  DOWNLOAD_PAGE,
  INITIAL_UPDATE_STATE,
  RELEASES_PAGE,
  actionLabel,
  noticeText,
  shouldNotify,
  type UpdateState,
} from "../lib/updates";
import { useNavigation } from "./navigation";
import { useSettings } from "./settings";
import { useUI } from "./ui";

const NOTICE_STORE = "updates";
const ANDROID_STORE = "android-updates";
const NOTICE_OWNER = "guest";

type AndroidRecord = { checkedAt?: number; notified?: string };

type UpdatesStore = {
  state: UpdateState;
  notified: string | null;
  apply: (state: UpdateState) => void;
  check: () => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  openPage: (url: string) => void;
};

function failInstall(state: UpdateState, message: string): UpdateState {
  return { ...state, status: "error", error: message, errorFrom: "install" };
}

export const useUpdates = create<UpdatesStore>()((set, get) => ({
  state: INITIAL_UPDATE_STATE,
  notified: null,

  apply(state) {
    set({ state });
    if (!shouldNotify(state, get().notified)) return;
    set({ notified: state.version });
    void persistWrite(NOTICE_STORE, { notified: state.version }, NOTICE_OWNER).catch(() => {});
    useUI.getState().toast(noticeText(state), "info", undefined, {
      label: actionLabel(state.route),
      run: () => void get().install(),
    });
  },

  async check() {
    try {
      await updatesCheck();
    } catch (error) {
      get().apply({ ...get().state, status: "error", error: String(error), errorFrom: "check" });
    }
  },

  async install() {
    const { state } = get();
    if (state.route !== "inApp") {
      get().openPage(state.route === "website" ? DOWNLOAD_PAGE : RELEASES_PAGE);
      return;
    }
    try {
      await updatesInstall();
    } catch (error) {
      get().apply(failInstall(state, String(error)));
    }
  },

  async restart() {
    try {
      await updatesRestart();
    } catch (error) {
      get().apply(failInstall(get().state, String(error)));
    }
  },

  openPage(url) {
    void openExternal(url).catch(() => {});
  },
}));

function startAndroidUpdates(): () => void {
  let live = true;
  let busy = false;
  let record: AndroidRecord | null = null;

  async function load(): Promise<AndroidRecord> {
    record ??= (await persistRead<AndroidRecord>(ANDROID_STORE, NOTICE_OWNER).catch(() => null)) ?? {};
    return record;
  }

  async function save(patch: AndroidRecord) {
    record = { ...record, ...patch };
    await persistWrite(ANDROID_STORE, record, NOTICE_OWNER).catch(() => {});
  }

  async function checkOnce() {
    const stored = await load();
    const { autoUpdateCheck } = useSettings.getState();
    if (!shouldCheck(stored.checkedAt ?? null, Date.now(), autoUpdateCheck, navigator.onLine)) return;
    const current = await appVersion();
    const result = await updateCheck(current);
    if (!live || result.state === "error") return;
    await save({ checkedAt: Date.now() });
    if (result.state !== "available") return;
    const state: UpdateState = {
      ...INITIAL_UPDATE_STATE,
      current,
      status: "available",
      version: result.version,
      route: "inApp",
    };
    if (!shouldNotify(state, stored.notified ?? null)) return;
    await save({ notified: result.version });
    useUI.getState().toast(`${APP_NAME} ${result.version} is available.`, "info", undefined, {
      label: "View",
      run: () => useNavigation.getState().navigate({ name: "settings", param: "about" }),
    });
  }

  function tick() {
    if (!live || busy) return;
    busy = true;
    checkOnce()
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  }

  const first = setTimeout(tick, ANDROID_UPDATE_FIRST_CHECK_MS);
  const interval = setInterval(tick, ANDROID_UPDATE_TICK_MS);
  window.addEventListener("online", tick);

  return () => {
    live = false;
    clearTimeout(first);
    clearInterval(interval);
    window.removeEventListener("online", tick);
  };
}

export function startUpdates(): () => void {
  if (platform === "android") return startAndroidUpdates();
  if (platform === "ios") {
    // iOS has no in-app updater: distribution is Xcode dev signing / TestFlight /
    // App Store, the settings row is already hidden by IOS_HIDDEN_ROWS, and the
    // Rust `update` command rejects with "not supported on iOS". There is nothing
    // to poll, listen for, or tear down, so return a safe no-op cleanup.
    // See docs/ios-port/PARITY_MATRIX.md §3 "In-app updates".
    return () => {};
  }
  let live = true;
  let stop: (() => void) | undefined;

  void (async () => {
    const stored = await persistRead<{ notified?: string }>(NOTICE_STORE, NOTICE_OWNER).catch(() => null);
    if (!live) return;
    useUpdates.setState({ notified: stored?.notified ?? null });
    const unlisten = await listenUpdates((state) => useUpdates.getState().apply(state));
    if (!live) {
      unlisten();
      return;
    }
    stop = unlisten;
    const state = await updatesState();
    if (live) useUpdates.getState().apply(state);
  })().catch(() => {});

  return () => {
    live = false;
    stop?.();
  };
}
