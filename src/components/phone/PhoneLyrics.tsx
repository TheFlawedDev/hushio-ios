import { useContext, useMemo, useState } from "react";
import { Translate } from "@phosphor-icons/react";
import { SyncedLyrics } from "../SyncedLyrics";
import { PhoneIcon } from "./PhoneIcon";
import { lyricsReset } from "../../lib/bridge";
import { forgetLyrics } from "../../lib/lyrics";
import { visibleLyricLines } from "../../lib/lyricsLines";
import { OnArtContext } from "../../lib/onArt";
import { useTrackLyrics } from "../../lib/useTrackLyrics";
import { useLyricsOffset } from "../../lib/lyricsOffset";
import { hasLyricsText } from "./nowPlayingPanel";
import { currentTrack, usePlayer } from "../../stores/player";
import { useSettings } from "../../stores/settings";

const TEXT_BASE =
  "flex min-h-11 shrink-0 items-center rounded-full px-3 text-body font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
const ICON_BASE =
  "flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function PhoneLyrics() {
  const track = usePlayer(currentTrack);
  const duration = usePlayer((state) => state.duration);
  const offset = useLyricsOffset(track?.id ?? null);
  const { lyrics, loading, reload } = useTrackLyrics(track, duration);
  const onArt = useContext(OnArtContext);
  const syncedOn = useSettings((state) => state.syncedLyrics);
  const [translate, setTranslate] = useState(false);

  const lines = useMemo(() => (lyrics?.synced ? visibleLyricLines(lyrics.synced) : []), [lyrics]);
  const hasTranslation = lines.some((line) => Boolean(line.translation));

  if (!track) return <p className="m-auto text-body text-ink-2">Play something to sing along.</p>;

  const custom = Boolean(lyrics?.custom);
  const hasText = hasLyricsText(lyrics);
  const empty = !loading && !hasText;
  const canTranslate = !empty && syncedOn && hasTranslation;
  const showHeader = !empty && (custom || canTranslate);
  const tone = onArt ? "text-art hover:bg-art/[0.12]" : "text-ink-1 hover:bg-wash";
  const textClass = `${TEXT_BASE} ${tone}`;
  const iconClass = `${ICON_BASE} ${tone}`;

  const reset = () => {
    lyricsReset(track.id)
      .catch(() => undefined)
      .then(() => {
        forgetLyrics(track.id);
        reload();
      });
  };

  return (
    <div className="flex h-full w-full min-h-0 flex-col pb-4">
      {showHeader && (
        <div className="flex h-11 shrink-0 items-center justify-between gap-2">
          {custom ? (
            <button type="button" onClick={reset} className={`${textClass} min-w-0 max-w-[70%]`}>
              <span className="truncate">Reset to automatic</span>
            </button>
          ) : (
            <span />
          )}
          <div className="ml-auto flex items-center gap-1">
            {canTranslate && (
              <button
                type="button"
                aria-label="Translate lyrics"
                aria-pressed={translate}
                onClick={() => setTranslate((on) => !on)}
                className={iconClass}
              >
                <PhoneIcon icon={Translate} weight={translate ? "fill" : "regular"} />
              </button>
            )}
          </div>
        </div>
      )}
      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <p className={`text-body leading-5 ${onArt ? "text-art/[0.72]" : "text-ink-2"}`}>Lyrics not available</p>
        </div>
      ) : (
        <SyncedLyrics
          key={track.id}
          lyrics={lyrics}
          loading={loading}
          offset={offset}
          trackKey={track.id}
          onArt={onArt}
          translate={translate}
        />
      )}
    </div>
  );
}
