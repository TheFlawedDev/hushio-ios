import { platform, playerKeepAwake } from "./bridge";

type WakeLockSentinel = { release: () => Promise<void>; released: boolean };

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

let sentinel: WakeLockSentinel | null = null;

function wakeLockApi(): NavigatorWithWakeLock["wakeLock"] | undefined {
  return (navigator as NavigatorWithWakeLock).wakeLock;
}

async function releaseSentinel(): Promise<void> {
  const current = sentinel;
  sentinel = null;
  if (!current || current.released) return;
  try {
    await current.release();
  } catch {
    return;
  }
}

export async function setKeepAwake(on: boolean): Promise<void> {
  if (platform === "android" || platform === "ios") {
    // iOS maps this to UIApplication.isIdleTimerDisabled in HushioPlayerPlugin.
    await playerKeepAwake(on).catch(() => {});
    return;
  }
  if (!on) {
    await releaseSentinel();
    return;
  }
  const api = wakeLockApi();
  if (!api) return;
  try {
    sentinel = await api.request("screen");
  } catch {
    sentinel = null;
  }
}
