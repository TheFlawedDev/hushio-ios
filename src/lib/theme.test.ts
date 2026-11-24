import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const state = {
    platform: "android" as string,
    dark: false,
    listeners: [] as Array<() => void>,
    bars: vi.fn((_dark: boolean) => Promise.resolve()),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      get matches() {
        return state.dark;
      },
      addEventListener: (_event: string, listener: () => void) => state.listeners.push(listener),
      removeEventListener: (_event: string, listener: () => void) => {
        state.listeners = state.listeners.filter((item) => item !== listener);
      },
    }),
  });
  return state;
});

vi.mock("./bridge", () => ({
  get platform() {
    return env.platform;
  },
  playerSetSystemBars: env.bars,
}));

import { applyTheme } from "./theme";

describe("applyTheme system bars", () => {
  beforeEach(() => {
    env.platform = "android";
    env.dark = false;
    env.bars.mockClear();
    applyTheme("light");
    env.bars.mockClear();
  });

  it("makes the bars light icons when the app theme is dark", () => {
    applyTheme("dark");
    expect(env.bars).toHaveBeenLastCalledWith(true);
  });

  it("makes the bars dark icons when the app theme is light", () => {
    applyTheme("dark");
    env.bars.mockClear();
    applyTheme("light");
    expect(env.bars).toHaveBeenLastCalledWith(false);
  });

  it("follows the OS theme in system mode and again when it changes", () => {
    env.dark = true;
    applyTheme("system");
    expect(env.bars).toHaveBeenLastCalledWith(true);

    env.dark = false;
    for (const listener of [...env.listeners]) listener();
    expect(env.bars).toHaveBeenLastCalledWith(false);
  });

  it("uses the desktop scheme when one is given", () => {
    env.dark = true;
    applyTheme("system", "light");
    expect(env.bars).toHaveBeenLastCalledWith(false);
  });

  it("leaves the bars alone off Android", () => {
    env.platform = "windows";
    applyTheme("dark");
    applyTheme("system");
    expect(env.bars).not.toHaveBeenCalled();
  });

  it("leaves the bars alone on iOS (system-owned status bar)", () => {
    env.platform = "ios";
    applyTheme("dark");
    applyTheme("light");
    applyTheme("system");
    expect(env.bars).not.toHaveBeenCalled();
  });
});
