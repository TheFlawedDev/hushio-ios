import {
  launchTake,
  listenLaunchPending,
  listenPlayerEvent,
  platform,
  playerPlay,
  playerSetQueue,
  playerTakeLaunch,
  type LaunchAction,
} from "./bridge";
import { launchTargetFor, type LaunchPayload, type LaunchTarget, parseAppLink } from "./launchLink";
import { dropPaths } from "./localDrop";
import { useNavigation } from "../stores/navigation";
import { usePlayer } from "../stores/player";
import { adoptNativeItem } from "./androidEngine";
import { listen } from "@tauri-apps/api/event";

const SHARED_VIDEO_TITLE = "Shared YouTube video";
const OPENED_FILE_TITLE = "Opened audio file";

export function playlistBrowseId(id: string): string {
  return id.startsWith("VL") ? id : `VL${id}`;
}

async function playOpenedFile(uri: string): Promise<void> {
  await playerSetQueue(
    [
      {
        id: uri,
        title: OPENED_FILE_TITLE,
        artist: "",
        durationMs: 0,
        url: "",
        headers: {},
        liked: false,
        expiresAtEpochMs: null,
        contentUri: uri,
      },
    ],
    0,
    0,
  );
  adoptNativeItem(uri, OPENED_FILE_TITLE);
  await playerPlay();
}

export async function routeLaunchTarget(target: LaunchTarget): Promise<void> {
  if (target.kind === "playlist") {
    useNavigation.getState().navigate({ name: "ytplaylist", param: playlistBrowseId(target.id) });
    return;
  }
  if (target.kind === "video") {
    usePlayer.getState().playTrack({ id: target.id, title: SHARED_VIDEO_TITLE, artist: "", thumb: null });
    return;
  }
  if (platform === "android") {
    await playOpenedFile(target.uri);
    return;
  }
  if (platform === "ios") {
    // Security-scoped file URLs on iOS require startAccessingSecurityScopedResource
    // and durable bookmarks (see DocumentPicker.swift). Raw file path access fails
    // or revokes across launches without a security-scoped bookmark.
    // Documented as OPEN with the hardware verification blocker in docs/ios-port/LAUNCH_IOS.md.
    console.warn(`[hushio] file launch routing on iOS is deferred pending physical device verification: ${target.uri}`);
    return;
  }
  await dropPaths([target.uri]);
}

export function routeLaunchAction(action: LaunchAction): Promise<void> {
  return routeLaunchTarget(
    action.type === "file" ? { kind: "file", uri: action.path } : { kind: "playlist", id: action.id },
  );
}

export function launchActionForUrl(rawUrl: string): LaunchAction | null {
  const trimmed = rawUrl.trim();
  const appTarget = parseAppLink(trimmed);
  if (appTarget?.kind === "playlist") {
    return { type: "playlist", id: appTarget.id };
  }
  if (trimmed.startsWith("file://") || (platform !== "windows" && trimmed.startsWith("/"))) {
    const path = trimmed.startsWith("file://") ? decodeURI(trimmed.replace(/^file:\/\//, "")) : trimmed;
    return { type: "file", path };
  }
  return null;
}

function targetOf(payload: Partial<LaunchPayload>): LaunchTarget | null {
  if (!payload.kind || payload.value === undefined) return null;
  return launchTargetFor({ kind: payload.kind, value: payload.value });
}

export function startLaunchActions(): () => void {
  let live = true;
  const stops: (() => void)[] = [];
  const android = platform === "android";

  const drain = () => {
    if (android) {
      void playerTakeLaunch()
        .then((payload) => {
          const target = targetOf(payload);
          if (target) return routeLaunchTarget(target);
        })
        .catch((error: unknown) => console.warn(`[hushio] launch intent failed: ${String(error)}`));
      return;
    }
    void launchTake()
      .then((actions) => {
        for (const action of actions) void routeLaunchAction(action);
      })
      .catch(() => {});
  };

  const handleDeepLinkUrls = (urls: unknown) => {
    const list = Array.isArray(urls) ? urls : [urls];
    for (const item of list) {
      if (typeof item !== "string") continue;
      const action = launchActionForUrl(item);
      if (action) void routeLaunchAction(action);
    }
  };

  if (android) {
    void listenPlayerEvent("launch-intent", drain)
      .then((unlisten) => {
        if (live) stops.push(unlisten);
        else unlisten();
      })
      .catch(() => {});
  } else {
    void listenLaunchPending(drain)
      .then((unlisten) => {
        if (live) stops.push(unlisten);
        else unlisten();
      })
      .catch(() => {});

    void listen<string | string[]>("deep-link://new-url", (event) => {
      handleDeepLinkUrls(event.payload);
    })
      .then((unlisten) => {
        if (live) stops.push(unlisten);
        else unlisten();
      })
      .catch(() => {});
  }

  drain();

  return () => {
    live = false;
    for (const stop of stops) stop();
  };
}
