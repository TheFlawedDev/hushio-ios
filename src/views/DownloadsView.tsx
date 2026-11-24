import type { MouseEvent as ReactMouseEvent } from "react";
import { useNavigation, type View } from "../stores/navigation";
import { Warning, X, Clock, DownloadSimple, FolderOpen, Play, ArrowClockwise, Shuffle, Check, WifiHigh, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { ActionMenu } from "../components/ActionMenu";
import { CollectionHero } from "../components/CollectionHero";
import { EmptyState } from "../components/EmptyState";
import { HeroIcon } from "../components/HeroIcon";
import { Icon } from "../components/Icon";
import { CollectionActions } from "../components/TrackListControls";
import { PHONE_PLAY, PHONE_SHUFFLE } from "../components/phone/heroButtons";
import { thumbArtwork } from "../lib/artwork";
import { usePhone } from "../lib/usePhone";
import {
  cancelDownload,
  downloadMenuItems,
  openDownloadFolder,
  removeDownload,
  revealDownload,
  startDownload,
} from "../lib/downloads";
import { fmtTime, fmtTotal } from "../lib/format";
import { plural } from "../lib/plural";
import { type DownloadItem, type LikeInput, useLibrary } from "../stores/library";
import { selectionMenuItems } from "../lib/selectionMenu";
import { useTrackSelection } from "../lib/useTrackSelection";
import { usePlayer } from "../stores/player";
import { type MenuItem, useUI } from "../stores/ui";
import type { Track } from "../types";

const DOWNLOADS_SOURCE = "__downloads__";

function backOr(fallback: View) {
  const nav = useNavigation.getState();
  if (nav.navPast.length > 0) nav.goBack();
  else nav.navigate(fallback);
}

function byTitle(a: DownloadItem, b: DownloadItem): number {
  return a.track.title.localeCompare(b.track.title);
}

function asTrack(item: DownloadItem): Track {
  const { id, title, artist, thumb, album, duration } = item.track;
  // `duration` and `album` are metadata the player already shows elsewhere; dropping them
  // made a downloaded track play without a known length (the native engine then falls back
  // to the container, which is inflated for these fragmented streams).
  return { id, title, artist, thumb: thumb ?? null, album, duration };
}

function percent(item: DownloadItem): number {
  return Math.round(item.progress * 100);
}

function playSaved(saved: DownloadItem[], index: number, shuffle: boolean) {
  const tracks = saved.map(asTrack);
  if (shuffle) usePlayer.setState({ shuffle: true });
  const start = shuffle ? Math.floor(Math.random() * tracks.length) : index;
  usePlayer.getState().playQueue(tracks, start, DOWNLOADS_SOURCE);
}

function statusLine(item: DownloadItem): { text: string; className: string } {
  switch (item.status) {
    case "downloading":
      return { text: `Downloading · ${percent(item)}%`, className: "text-accent" };
    case "queued":
      return { text: "Waiting to download", className: "text-ink-3" };
    case "waiting":
      return { text: "Waiting for Wi-Fi", className: "text-ink-3" };
    case "failed":
      return { text: "Couldn't download", className: "text-danger-text" };
    case "done":
      return { text: "Saved", className: "text-ink-3" };
  }
}

function badgeIcon(item: DownloadItem): PhosphorIcon | null {
  switch (item.status) {
    case "done":
      return Check;
    case "failed":
      return Warning;
    case "queued":
      return Clock;
    case "waiting":
      return WifiHigh;
    case "downloading":
      return null;
  }
}

function IconButton({
  label,
  icon,
  danger = false,
  onClick,
}: {
  label: string;
  icon: PhosphorIcon;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex size-10 items-center justify-center rounded-full hover:bg-hover ${
        danger ? "text-danger-text" : "text-ink-2 hover:text-ink-1"
      }`}
    >
      <Icon icon={icon} />
    </button>
  );
}

type DownloadRowProps = {
  item: DownloadItem;
  onPlay: (() => void) | null;
  selected?: boolean;
  onSelectClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onContextSelect?: () => void;
  multi?: () => MenuItem[];
};

function toLikeInput(item: DownloadItem): LikeInput {
  const { track } = item;
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    thumb: track.thumb ?? null,
    album: track.album ?? null,
    duration: track.duration,
    explicit: false,
  };
}

function DownloadRow({ item, onPlay, selected = false, onSelectClick, onContextSelect, multi }: DownloadRowProps) {
  const phone = usePhone();
  const busy = item.status === "queued" || item.status === "downloading" || item.status === "waiting";
  const line = statusLine(item);
  const badge = badgeIcon(item);
  const shown = item.status === "done" ? item.path : null;
  const fill = item.status === "done" ? 100 : percent(item);
  const reveal = busy
    ? ""
    : "motion-safe:transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100";

  if (phone) {
    return (
      <li
        className="flex h-14 select-none items-center"
        onContextMenu={(event) => {
          event.preventDefault();
          useUI.getState().openContextMenu(event.clientX, event.clientY, downloadMenuItems(item));
        }}
      >
        <button
          type="button"
          disabled={onPlay === null}
          onClick={onPlay ?? undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default"
        >
          <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-wash">
            {item.track.thumb && item.status !== "queued" && item.status !== "failed" && (
              <img loading="lazy" decoding="async"
                src={thumbArtwork(item.track.thumb, 52)}
                alt=""
                className="absolute inset-0 size-full object-cover"
                style={{ clipPath: `inset(${100 - fill}% 0 0 0)` }}
              />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-scrim/40 text-on-scrim">
              {item.status === "downloading" ? (
                <span className="text-meta font-semibold tabular-nums">{percent(item)}%</span>
              ) : (
                badge && <Icon icon={badge} />
              )}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span title={item.track.title} className="block truncate text-body font-medium leading-5 text-ink-1">
              {item.track.title}
            </span>
            <span className={`block truncate text-meta leading-[18px] ${item.status === "done" ? "text-ink-2" : line.className}`}>
              {item.status === "done" ? item.track.artist : line.text}
            </span>
          </span>
        </button>
        <ActionMenu items={() => downloadMenuItems(item)} label={`More options for ${item.track.title}`} />
      </li>
    );
  }

  return (
    <li
      className={`group flex h-[66px] select-none items-center gap-3.5 rounded-lg px-3 ${selected ? "bg-selected" : "hover:bg-wash focus-within:bg-wash"}`}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextSelect?.();
        useUI.getState().openContextMenu(event.clientX, event.clientY, multi ? multi() : downloadMenuItems(item));
      }}
    >
      <button
        type="button"
        disabled={onPlay === null && !onSelectClick}
        onClick={onSelectClick ?? onPlay ?? undefined}
        onDoubleClick={onSelectClick ? (onPlay ?? undefined) : undefined}
        onKeyDown={
          onSelectClick
            ? (event) => {
                if (event.key !== "Enter" || !onPlay) return;
                event.preventDefault();
                onPlay();
              }
            : undefined
        }
        className="flex min-w-0 flex-1 items-center gap-3.5 rounded-lg text-left disabled:cursor-default"
      >
        <span className="relative size-[52px] shrink-0 overflow-hidden rounded-lg bg-wash">
          {item.track.thumb && item.status !== "queued" && item.status !== "failed" && (
            <img loading="lazy" decoding="async"
              src={thumbArtwork(item.track.thumb, 52)}
              alt=""
              className="absolute inset-0 size-full object-cover"
              style={{ clipPath: `inset(${100 - fill}% 0 0 0)` }}
            />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-scrim/40 text-on-scrim">
            {item.status === "downloading" ? (
              <span className="text-meta font-semibold tabular-nums">{percent(item)}%</span>
            ) : (
              badge && <Icon icon={badge} />
            )}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span title={item.track.title} className="block truncate text-body font-semibold tracking-[-0.2px] text-ink-1">
            {item.track.title}
          </span>
          <span className="mt-0.5 block truncate text-body text-ink-2">{item.track.artist}</span>
        </span>
      </button>
      <span className={`w-44 shrink-0 truncate text-meta ${line.className}`}>{line.text}</span>
      <span className={`flex w-[120px] shrink-0 justify-end gap-1 ${reveal}`}>
        {busy && (
          <IconButton
            label="Cancel download"
            icon={X}
            danger
            onClick={() => void cancelDownload(item.track.id)}
          />
        )}
        {item.status === "failed" && (
          <IconButton label="Retry download" icon={ArrowClockwise} onClick={() => void startDownload(item.track)} />
        )}
        {shown && !phone && <IconButton label="Show in folder" icon={FolderOpen} onClick={() => revealDownload(shown)} />}
        {!busy && (
          <IconButton
            label="Remove download"
            icon={X}
            danger
            onClick={() => removeDownload(item.track.id)}
          />
        )}
      </span>
      <span className="w-11 shrink-0 text-right text-meta tabular-nums text-ink-3">
        {item.track.duration > 0 ? fmtTime(item.track.duration) : "—"}
      </span>
    </li>
  );
}

export function DownloadsView() {
  const downloads = useLibrary((state) => state.downloads);
  const items = Object.values(downloads).sort(byTitle);
  const saved = items.filter((item) => item.status === "done");
  const active = items.filter((item) => item.status === "queued" || item.status === "downloading" || item.status === "waiting").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const total = saved.reduce((sum, item) => sum + item.track.duration, 0);
  const covers = items.flatMap((item) => (item.track.thumb ? [thumbArtwork(item.track.thumb, 140)] : []));
  const none = saved.length === 0;
  const phone = usePhone();
  const selection = useTrackSelection("downloads", items.map((item) => item.track.id));

  const facts = (
    <>
      {none ? "Nothing saved yet" : `${plural(saved.length, "song", "songs")}${total > 0 ? ` · ${fmtTotal(total)}` : ""}`}
      {active > 0 && <span className="text-ink-1"> · {active} on the way</span>}
      {failed > 0 && <span className="text-danger-text"> · {failed} couldn't download</span>}
    </>
  );

  return (
    <div className="pb-14">
      <CollectionHero
        title="Downloads"
        covers={covers}
        facts={facts}
        icon={DownloadSimple}
        tile={{ icon: DownloadSimple }}
        onBack={phone ? () => backOr({ name: "library" }) : undefined}
        footer={
          phone ? undefined : (
            <CollectionActions
              playLabel="Play Downloads"
              disabled={none}
              onPlay={() => playSaved(saved, 0, false)}
              onShuffle={() => playSaved(saved, 0, true)}
              menu={[{ label: "Open the downloads folder", icon: FolderOpen, onSelect: openDownloadFolder }]}
            />
          )
        }
      >
        {phone && (
          <>
            <button type="button" aria-label="Play Downloads" disabled={none} onClick={() => playSaved(saved, 0, false)} className={PHONE_PLAY}>
              <HeroIcon icon={Play} />
              Play
            </button>
            <button type="button" aria-label="Shuffle" title="Shuffle" disabled={none} onClick={() => playSaved(saved, 0, true)} className={PHONE_SHUFFLE}>
              <HeroIcon icon={Shuffle} />
              Shuffle
            </button>
          </>
        )}
      </CollectionHero>

      <div className={phone && items.length === 0 ? "relative" : "relative mt-6"}>
        {items.length === 0 ? (
          <EmptyState
            icon={DownloadSimple}
            title="No downloads yet"
            message="Use the download arrow on a song to keep it offline."
            action={{ label: "Find songs", onClick: () => useNavigation.getState().navigate({ name: "search" }) }}
          />
        ) : (
          <ol onKeyDown={(event) => selection.onListKeyDown(event)}>
            {items.map((item) => {
              const index = saved.indexOf(item);
              const id = item.track.id;
              return (
                <DownloadRow
                  key={id}
                  item={item}
                  onPlay={item.status === "done" ? () => playSaved(saved, index, false) : null}
                  selected={selection.isSelected(id)}
                  onSelectClick={(event) => selection.click(event, id)}
                  onContextSelect={() => selection.contextSelect(id)}
                  multi={
                    selection.isSelected(id) && selection.count > 1
                      ? () => selectionMenuItems(items.filter((entry) => selection.isSelected(entry.track.id)).map(toLikeInput))
                      : undefined
                  }
                />
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
