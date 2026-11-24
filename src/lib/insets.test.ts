import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  platform: "android" as "android" | "ios" | "windows",
  getInsets: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("./bridge", () => ({
  get platform() {
    return hoisted.platform;
  },
  playerGetInsets: hoisted.getInsets,
  listenPlayerEvent: hoisted.listen,
}));

import { applyInsets, refreshInsets, startInsets } from "./insets";
import { INSET_BOTTOM, INSET_TOP } from "./phoneNav";

const root = document.documentElement;
const px = (name: string) => root.style.getPropertyValue(name);

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getInsets.mockResolvedValue({ top: 0, bottom: 0, left: 0, right: 0 });
  hoisted.listen.mockResolvedValue(hoisted.unlisten);
});

afterEach(() => {
  hoisted.platform = "android";
  root.removeAttribute("style");
});

describe("applyInsets", () => {
  it("writes each side as a px custom property", () => {
    applyInsets({ top: 24, bottom: 48, left: 0, right: 12.5 });
    expect(px("--inset-top")).toBe("24px");
    expect(px("--inset-bottom")).toBe("48px");
    expect(px("--inset-left")).toBe("0px");
    expect(px("--inset-right")).toBe("12.5px");
  });

  it("treats non-numeric or negative values as zero", () => {
    applyInsets({ top: Number.NaN, bottom: -4, left: 0, right: 0 });
    expect(px("--inset-top")).toBe("0px");
    expect(px("--inset-bottom")).toBe("0px");
  });
});

describe("refreshInsets", () => {
  it("sets the variables from the native response", async () => {
    hoisted.getInsets.mockResolvedValue({ top: 32, bottom: 16, left: 0, right: 0 });
    await refreshInsets();
    expect(px("--inset-top")).toBe("32px");
    expect(px("--inset-bottom")).toBe("16px");
  });

  it("falls back to zero when the call fails", async () => {
    applyInsets({ top: 30, bottom: 30, left: 30, right: 30 });
    hoisted.getInsets.mockRejectedValue(new Error("player_not_ready"));
    await refreshInsets();
    expect(px("--inset-top")).toBe("0px");
    expect(px("--inset-left")).toBe("0px");
  });
});

describe("startInsets", () => {
  it("applies current insets and updates on the insets event", async () => {
    hoisted.getInsets.mockResolvedValue({ top: 24, bottom: 0, left: 0, right: 0 });
    const stop = startInsets();
    await flush();
    expect(px("--inset-top")).toBe("24px");

    expect(hoisted.listen.mock.calls[0][0]).toBe("insets");
    const onEvent = hoisted.listen.mock.calls[0][1] as (payload: unknown) => void;
    onEvent({ top: 40, bottom: 20, left: 0, right: 0 });
    expect(px("--inset-top")).toBe("40px");
    expect(px("--inset-bottom")).toBe("20px");
    stop();
  });

  it("requests insets again on resize and when the page becomes visible", async () => {
    const stop = startInsets();
    await flush();
    hoisted.getInsets.mockClear();
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(hoisted.getInsets).toHaveBeenCalledTimes(2);
    stop();
  });

  it("removes the listener and window handlers on dispose", async () => {
    const stop = startInsets();
    await flush();
    stop();
    expect(hoisted.unlisten).toHaveBeenCalledTimes(1);
    hoisted.getInsets.mockClear();
    window.dispatchEvent(new Event("resize"));
    expect(hoisted.getInsets).not.toHaveBeenCalled();
  });

  it("leaves iOS safe areas to the CSS env() fallback", async () => {
    hoisted.platform = "ios";
    const stop = startInsets();
    await flush();
    expect(hoisted.getInsets).not.toHaveBeenCalled();
    expect(hoisted.listen).not.toHaveBeenCalled();
    expect(px("--inset-top")).toBe("");
    expect(px("--inset-bottom")).toBe("");
    expect(INSET_TOP).toContain("env(safe-area-inset-top");
    expect(INSET_BOTTOM).toContain("env(safe-area-inset-bottom");
    stop();
  });
});
