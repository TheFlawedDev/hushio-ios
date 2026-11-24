import { useEffect, useRef, useState } from "react";
import { Heart, Play, ListPlus, Playlist as PlaylistIcon, Shuffle, Trash } from "@phosphor-icons/react";
import { ActionMenu } from "../components/ActionMenu";
import { CollectionHero } from "../components/CollectionHero";
import { EmptyState } from "../components/EmptyState";
import { HeroIcon } from "../components/HeroIcon";
import { ALL_SORTS, arrangeTracks, CollectionActions, FILTER_MIN_TRACKS, PhoneTrackFilter, type SortKey, TrackTools } from "../components/TrackListControls";
import { TrackListHeader, TrackRow } from "../components/TrackRow";
import { PHONE_ICON, PHONE_PLAY, PHONE_SHUFFLE } from "../components/phone/heroButtons";
import { PhoneSongRow } from "../components/phone/PhoneTrackRow";
import { useFirstLoadStagger } from "../components/phone/useFirstLoadStagger";
import { topArtist } from "../lib/collections";
import { playlistCovers } from "../lib/playlistCover";
import { useFailedCovers } from "../stores/coverErrors";
import { playCollection, playlistHeaderItems, toSong } from "../lib/collectionActions";
import { dropTracksOnTarget, QUEUE_TARGET } from "../lib/trackDrop";
import { selectionMenuItems } from "../lib/selectionMenu";
import { useTrackSelection } from "../lib/useTrackSelection";
import { downloadAll } from "../lib/downloads";
import { fmtTotal } from "../lib/format";
import { plural } from "../lib/plural";
import { sortKeys } from "../lib/sortable";
import { playlistTrackMenuItems } from "../lib/trackActions";
import { useSortable } from "../lib/useSortable";
import { usePhone } from "../lib/usePhone";
import { type Playlist, useLibrary } from "../stores/library";
import type { SearchSong } from "../lib/searchParse";
import { useNavigation } from "../stores/navigation";
import { playFromRow, usePlayer } from "../stores/player";
import { type MenuItem, useUI } from "../stores/ui";
import { prefetchFirst } from "../lib/prefetch";
import { FINDER_MAX_SONGS, PlaylistFinder } from "../components/PlaylistFinder";
import { PlaylistRecommendations } from "../components/PlaylistRecommendations";
import { usePlaylistEdit } from "../stores/playlistEdit";

function phoneRowMenu(playlist: Playlist, index: number, song: SearchSong): MenuItem[] {
  const liked = useLibrary.getState().liked.some((item) => item.id === song.id);
  return [
    ...playlistTrackMenuItems(playlist, index),
    {
      label: liked ? "Remove from Liked Songs" : "Add to Liked Songs",
      icon: Heart,
      separatorBefore: true,
      onSelect: () => useLibrary.getState().toggleLike(song),
    },
  ];
}

export function PlaylistView() {
  const id = useNavigation((state) => state.view.param);
  const playlist = useLibrary((state) => state.playlists.find((item) => item.id === id));
  const currentId = usePlayer((state) => state.queue[state.index]?.id);
  const playing = usePlayer((state) => state.playing);
  const listRef = useRef<HTMLOListElement>(null);
  const phone = usePhone();
  const failed = useFailedCovers();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("custom");
  const tracks = playlist?.tracks ?? [];
  const leadIds = tracks.slice(0, 3).map((track) => track.id).join("|");
  useEffect(() => prefetchFirst(leadIds.split("|")), [leadIds]);
  const filterable = tracks.length >= FILTER_MIN_TRACKS;
  const activeQuery = filterable ? query : "";
  const dragOn = sort === "custom" && activeQuery.trim() === "";
  const visible = arrangeTracks(tracks, activeQuery, sort);
  const visibleTracks = visible.map((row) => row.item);
  const stagger = useFirstLoadStagger(visibleTracks.length > 0);
  const keys = sortKeys(visibleTracks.map((track) => track.id));
  const selection = useTrackSelection(`playlist:${id}`, visibleTracks.map((track) => track.id));
  const sortable = useSortable({
    keys,
    listRef,
    reorder: dragOn,
    onMove: (from, to) => {
      if (playlist) useLibrary.getState().moveInPlaylist(playlist.id, from, to);
    },
    canDropOn: (_key, targetId) =>
      targetId === "liked" ||
      targetId === QUEUE_TARGET ||
      (targetId.startsWith("playlist:") && targetId !== `playlist:${playlist?.id}`),
    onDropOn: (key, targetId, point) => {
      const dragged = visibleTracks[keys.indexOf(key)];
      if (!dragged) return;
      const group = selection.isSelected(dragged.id)
        ? visibleTracks.filter((track) => selection.isSelected(track.id))
        : [dragged];
      dropTracksOnTarget(targetId, group.map(toSong), point);
    },
  });

  function removeSelected() {
    if (!playlist) return;
    const removed = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => selection.isSelected(track.id));
    if (removed.length === 0) return;
    const library = useLibrary.getState();
    removed.forEach(({ track }) => library.removeFromPlaylist(playlist.id, track.id));
    selection.clear();
    useUI.getState().toast(`Removed ${plural(removed.length, "song", "songs")} from playlist`, "info", undefined, {
      label: "Undo",
      run: () =>
        removed.forEach(({ track, index }) => useLibrary.getState().restoreTrackInPlaylist(playlist.id, track, index)),
    });
  }

  function selectedMenu(): MenuItem[] {
    const picked = visibleTracks.filter((track) => selection.isSelected(track.id)).map(toSong);
    return selectionMenuItems(picked, [
      { label: "Remove from this playlist", icon: Trash, danger: true, separatorBefore: true, onSelect: removeSelected },
    ]);
  }

  if (!playlist) {
    return (
      <EmptyState
        icon={PlaylistIcon}
        title="This playlist no longer exists"
        message="It may have been deleted. Head back to your playlists to find the rest."
      />
    );
  }

  const empty = tracks.length === 0;
  const total = tracks.reduce((sum, track) => sum + track.duration, 0);
  const top = topArtist(tracks);
  const facts = (
    <>
      {empty ? "No songs yet" : `${plural(tracks.length, "song", "songs")}${total > 0 ? ` · ${fmtTotal(total)}` : ""}`}
      {top && (
        <>
          {" · Top artist: "}
          <span className="font-semibold text-ink-1">{top}</span>
        </>
      )}
    </>
  );
  const headerMenu: MenuItem[] = [
    {
      label: "Add all to queue",
      icon: ListPlus,
      onSelect: () => {
        usePlayer.getState().addToQueue(tracks);
        useUI.getState().toast("Playlist added to queue");
      },
    },
    ...playlistHeaderItems(playlist),
  ];
  const footer = phone ? undefined : (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <CollectionActions
        playLabel={`Play ${playlist.name}`}
        disabled={empty}
        onPlay={() => playCollection(tracks, playlist.id, false)}
        onShuffle={() => playCollection(tracks, playlist.id, true)}
        onDownload={() => downloadAll(tracks, playlist.name)}
        menu={headerMenu}
      />
      {!empty && (
        <TrackTools query={activeQuery} onQuery={setQuery} sort={sort} onSort={setSort} options={ALL_SORTS} filterable={filterable} />
      )}
    </div>
  );

  return (
    <div className="pb-14">
      <CollectionHero
        title={playlist.name}
        covers={playlistCovers(playlist, Number.POSITIVE_INFINITY, failed)}
        facts={facts}
        icon={PlaylistIcon}
        eyebrow="Playlist"
        footer={footer}
        description={playlist.description}
        onEdit={playlist.remote ? undefined : () => usePlaylistEdit.getState().open(playlist.id)}
      >
        {phone && (
          <>
            <button
              type="button"
              aria-label={`Play ${playlist.name}`}
              onClick={() => playCollection(tracks, playlist.id, false)}
              className={PHONE_PLAY}
            >
              <HeroIcon icon={Play} />
              Play
            </button>
            <button
              type="button"
              aria-label="Shuffle"
              disabled={empty}
              onClick={() => playCollection(tracks, playlist.id, true)}
              className={PHONE_SHUFFLE}
            >
              <HeroIcon icon={Shuffle} />
              Shuffle
            </button>
            <ActionMenu items={headerMenu} label="More options" triggerClass={PHONE_ICON} phoneIcon />
          </>
        )}
      </CollectionHero>

      <div className={phone ? (empty ? "" : "pt-5") : "pt-6"}>
        {empty ? (
          playlist.remote && (
            <EmptyState icon={PlaylistIcon} title="No songs yet" message="Songs you add here sync with your linked playlist." />
          )
        ) : (
          <>
            {!phone && <TrackListHeader showAlbum showAdded />}
            {phone && <PhoneTrackFilter query={query} onQuery={setQuery} count={tracks.length} />}
            <ol
              ref={listRef}
              className={stagger.className || undefined}
              onAnimationEnd={stagger.onAnimationEnd}
              {...(phone && !dragOn ? {} : sortable.listProps)}
              onKeyDown={phone ? undefined : (event) => selection.onListKeyDown(event, removeSelected)}
            >
              {visible.map(({ item: track, index }, position) => {
                const key = keys[position];
                if (phone) {
                  return (
                    <PhoneSongRow
                      key={key}
                      index={index}
                      song={toSong(track)}
                      current={track.id === currentId}
                      playing={playing}
                      menu={() => phoneRowMenu(playlist, index, toSong(track))}
                      onPlay={() => playFromRow(tracks, index, playlist.id)}
                      rowProps={dragOn ? sortable.bind(key) : undefined}
                    />
                  );
                }
                return (
                  <TrackRow
                    key={key}
                    index={position}
                    song={toSong(track)}
                    current={track.id === currentId}
                    playing={playing}
                    menu={() =>
                      selection.isSelected(track.id) && selection.count > 1
                        ? selectedMenu()
                        : playlistTrackMenuItems(playlist, index)
                    }
                    onPlay={() => playFromRow(visibleTracks, position, playlist.id)}
                    artwork
                    showAlbum
                    showAdded
                    addedAt={track.addedAt}
                    selected={selection.isSelected(track.id)}
                    onSelectClick={(event) => selection.click(event, track.id)}
                    onContextSelect={() => selection.contextSelect(track.id)}
                    rowProps={sortable.bind(key)}
                  />
                );
              })}
            </ol>
            {visible.length === 0 && (
              <p className="py-10 text-center text-meta text-ink-2">No songs match this filter.</p>
            )}
          </>
        )}
        {!playlist.remote && tracks.length < FINDER_MAX_SONGS && <PlaylistFinder playlist={playlist} />}
        {!playlist.remote && !empty && <PlaylistRecommendations key={playlist.id} playlist={playlist} />}
      </div>
    </div>
  );
}
