import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  platform: "windows" as string,
}));

vi.mock("../lib/bridge", () => ({
  get platform() {
    return env.platform;
  },
  persistRead: vi.fn(async () => null),
  persistWrite: vi.fn(async () => true),
  listenUpdates: vi.fn(async () => () => {}),
  openExternal: vi.fn(async () => {}),
  updatesState: vi.fn(async () => ({ status: "idle" })),
  updatesCheck: vi.fn(async () => {}),
  updatesInstall: vi.fn(async () => {}),
  updatesRestart: vi.fn(async () => {}),
}));

import * as bridge from "../lib/bridge";
import { INITIAL_UPDATE_STATE, type UpdateState } from "../lib/updates";
import { startUpdates, useUpdates } from "./updates";
import { useUI } from "./ui";

const bridgeMock = vi.mocked(bridge);

function available(version: string, route: UpdateState["route"] = "inApp"): UpdateState {
  return { ...INITIAL_UPDATE_STATE, current: "1.1.1", status: "available", version, route };
}

function toastMessages() {
  return useUI.getState().toasts.map((toast) => toast.message);
}

beforeEach(() => {
  env.platform = "windows";
  useUpdates.setState({ state: INITIAL_UPDATE_STATE, notified: null });
  useUI.setState({ toasts: [], pendingToasts: [] });
  bridgeMock.persistWrite.mockClear();
  bridgeMock.openExternal.mockClear();
  bridgeMock.updatesInstall.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("update notice", () => {
  it("shows one notice per version and remembers it", () => {
    useUpdates.getState().apply(available("1.2.0"));
    useUpdates.getState().apply(available("1.2.0"));

    expect(toastMessages()).toEqual(["Hushio 1.2.0 is available. Click to update."]);
    expect(bridgeMock.persistWrite).toHaveBeenCalledTimes(1);
    expect(bridgeMock.persistWrite).toHaveBeenCalledWith("updates", { notified: "1.2.0" }, "guest");
  });

  it("notifies again for a newer version", () => {
    useUpdates.getState().apply(available("1.2.0"));
    useUpdates.getState().apply(available("1.3.0"));

    expect(toastMessages()).toHaveLength(2);
    expect(useUpdates.getState().notified).toBe("1.3.0");
  });

  it("does not repeat a version stored by an earlier launch", async () => {
    bridgeMock.persistRead.mockResolvedValueOnce({ notified: "1.2.0" });
    bridgeMock.updatesState.mockResolvedValueOnce(available("1.2.0"));

    const stop = startUpdates();
    await vi.waitFor(() => expect(useUpdates.getState().state.version).toBe("1.2.0"));
    stop();

    expect(useUpdates.getState().state.version).toBe("1.2.0");
    expect(toastMessages()).toEqual([]);
  });
});

describe("install routing", () => {
  it("installs in the app on the in-app route", async () => {
    useUpdates.setState({ state: available("1.2.0", "inApp") });
    await useUpdates.getState().install();

    expect(bridgeMock.updatesInstall).toHaveBeenCalledTimes(1);
    expect(bridgeMock.openExternal).not.toHaveBeenCalled();
  });

  it("opens the download page on the website route", async () => {
    useUpdates.setState({ state: available("1.2.0", "website") });
    await useUpdates.getState().install();

    expect(bridgeMock.updatesInstall).not.toHaveBeenCalled();
    expect(bridgeMock.openExternal).toHaveBeenCalledWith("https://hushio.nexvyn.dev/download");
  });

  it("opens the releases page on the releases route", async () => {
    useUpdates.setState({ state: available("1.2.0", "releases") });
    await useUpdates.getState().install();

    expect(bridgeMock.openExternal).toHaveBeenCalledWith("https://github.com/Nexvyn/hushio/releases/latest");
  });
});

describe("iOS updater", () => {
  it("is a no-op: no command, no listener, safe cleanup", async () => {
    env.platform = "ios";
    bridgeMock.updatesState.mockClear();
    bridgeMock.listenUpdates.mockClear();

    const stop = startUpdates();
    // Let any (nonexistent) async startup work settle before asserting.
    await Promise.resolve();

    expect(bridgeMock.updatesState).not.toHaveBeenCalled();
    expect(bridgeMock.listenUpdates).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});
