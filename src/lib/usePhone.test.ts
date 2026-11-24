import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ platform: "android" as "android" | "ios" | "windows" }));

vi.mock("./bridge", () => ({
  get platform() {
    return mocks.platform;
  },
}));

import { usePhone } from "./usePhone";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

afterEach(() => {
  cleanup();
  mocks.platform = "android";
  setViewport(1024, 768);
});

describe("usePhone", () => {
  it("is true for a phone in portrait", () => {
    setViewport(390, 844);
    expect(renderHook(() => usePhone()).result.current).toBe(true);
  });

  it("stays true for a phone in landscape", () => {
    setViewport(844, 390);
    expect(renderHook(() => usePhone()).result.current).toBe(true);
  });

  it("stays true when a phone rotates from portrait to landscape", () => {
    setViewport(390, 844);
    const { result } = renderHook(() => usePhone());
    expect(result.current).toBe(true);
    setViewport(844, 390);
    expect(result.current).toBe(true);
  });

  it("is false for a tablet in landscape", () => {
    setViewport(1280, 840);
    expect(renderHook(() => usePhone()).result.current).toBe(false);
  });

  it("is false for a tablet in portrait", () => {
    setViewport(840, 1280);
    expect(renderHook(() => usePhone()).result.current).toBe(false);
  });

  it("is true for an iPhone in portrait and landscape", () => {
    mocks.platform = "ios";
    setViewport(390, 844);
    expect(renderHook(() => usePhone()).result.current).toBe(true);
    setViewport(844, 390);
    expect(renderHook(() => usePhone()).result.current).toBe(true);
  });

  it("is false for an iPad-sized ios viewport", () => {
    mocks.platform = "ios";
    setViewport(840, 1280);
    expect(renderHook(() => usePhone()).result.current).toBe(false);
  });

  it("is false on non-Android, non-iOS platforms whatever the viewport", () => {
    mocks.platform = "windows";
    setViewport(390, 844);
    expect(renderHook(() => usePhone()).result.current).toBe(false);
  });
});
