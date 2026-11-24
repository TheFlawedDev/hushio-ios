# Accessibility, VoiceOver, and Dynamic Type Audit — iPhone Shell

Audit performed for step `E2` of `docs/ios-port/REMAINING_SEQUENCE.md`, covering the open row
in `docs/ios-port/PARITY_MATRIX.md` ("Accessibility / VoiceOver / Dynamic Type audit").
Strictly audit-only: no application code is modified in this pass.

## Scope of Inspection

1. **Phone Shell & Core Components**: `src/components/phone/**` (`PhoneShell`, `TabBar`, `MiniPlayer`, `PhoneNowPlaying`, `PhoneQueueSheet`, `PhoneMenuSheet`, `Sheet`, `PhoneTrackRow`, `PhoneSearchRows`, `PhoneLibraryRows`, `PhoneSearchField`, `PhoneLyrics`, `PhoneShelf`, `PhoneFeatured`, `PressRow`, `SwipeRow`, `NotificationBanner`, `ReplayStories`, `ArtCarousel`, `PhoneHeader`, `PhoneProfileButton`, `PullIndicator`).
2. **Phone View Variants**: `src/views/**` phone branches (`HomeView`, `SearchView`, `LibraryView`, `ChartsView`, `AlbumView`, `ArtistView`, `PlaylistView`, `SettingsView`, `DownloadsView`, `LocalMusicView`, `FolderView`, `DaylistView`, `HistoryView`, `LikedView`, `RemotePlaylistView`).
3. **Player & Modal Overlays**: `src/components/PlayerBar*`, `src/components/NowPlaying*`, `src/components/SongInfoSheet`, `src/components/ActionMenu`, `src/components/ContextMenu`, `src/components/Dialog`.
4. **Styles & Foundations**: `src/index.css`, `src/styles/motion.css`, `src/styles/tokens.css`, `src/lib/motion.ts`, `src/lib/phoneGestures.ts`.

---

## Executive Summary

The iPhone shell features high baseline design preservation, progressive gesture handling, and comprehensive reduced-motion checks across its animation subsystems. However, the accessibility audit reveals critical obstacles for VoiceOver users, several non-functional facade controls on iOS, and touch target deficiencies:

- **6 P1 Blockers**: Modal sheets lack accessible dismissal buttons and focus traps; Now Playing focus leaks into background views; `PressRow` and `PhoneLibraryTile` apply overriding `aria-label` attributes that silence artist, album, and pinned metadata; `EqBars` active playback state is trapped in double `aria-hidden` wrappers; queue item removal and reordering require touch gestures impossible under VoiceOver; and Replay story slide progression cannot be triggered by screen readers.
- **10 P2 Deficiencies**: iOS misses `--hit-min: 44px` in CSS (falling back to desktop 40px); dead controls (Google Cast, Equalizer, Skip Silence) are presented on iOS despite platform refusal; toggle buttons combine dynamic "Enable/Disable" labels with `aria-pressed`; context menu items lack `role="menuitem"` and `aria-checked`; and search input blur breaks suggestion focus on touch.
- **5 P3 Polish Items**: Hard-coded DP heights break text reflow under Accessibility Dynamic Type (AX1–AX5); status bar tap strip carries `aria-hidden="true"` on an interactive `onClick`; and local download badges are silent to assistive technologies.

---

## Ranked Findings

### P1 — Blocks a Screen-Reader User

#### 1. Dismissal trap in generic `Sheet` dialog (`PhoneMenuSheet`, `SongInfoSheet`, `PlaylistEditDialog`)
- **File & Line**: `src/components/phone/Sheet.tsx:41-76`
- **Element**: `<motion.section role="dialog" aria-modal="true" aria-label={label}>` and backdrop `<motion.div aria-hidden="true" onClick={onClose} />`
- **Code Quote**:
  ```tsx
  <motion.div
    aria-hidden="true"
    className={reduced ? "absolute inset-0" : "absolute inset-0 will-change-[opacity]"}
    style={{ background: "rgb(var(--scrim) / var(--scrim-alpha))", opacity: reduced ? undefined : scrimOpacity }}
    onClick={onClose}
  />
  <motion.section
    ref={panel}
    role="dialog"
    aria-modal="true"
    aria-label={label}
    ...
  >
  ```
- **Defect**: Missing accessible close button inside the modal section. The backdrop dismissal element is marked `aria-hidden="true"`, preventing VoiceOver focus. Furthermore, `useSheetDrag` listens only for pointer down/drag gestures with no `Escape` key handler or focus trap.
- **iOS Impact**: A VoiceOver user who opens an Action Menu, Context Menu, Song Info sheet, or Playlist Edit sheet cannot dismiss it without executing a physical downward drag gesture. Because touch gestures are intercepted by VoiceOver cursor navigation, the user is trapped inside the sheet.
- **Fix Suggestion**: Add an accessible `<button type="button" aria-label="Close" onClick={onClose}>` inside the sheet grab/header bar, remove the click listener from the `aria-hidden` scrim, and attach an Escape key dismissal handler.
- **Status**: Implemented — added accessible Close button, Escape key dismissal, initial focus transfer, focus restoration, and Tab focus containment to `Sheet.tsx`.

#### 2. Focus leakage and missing focus containment in Phone Now Playing
- **File & Line**: `src/components/phone/PhoneNowPlaying.tsx:623-634` & `src/components/phone/PhoneShell.tsx:100`
- **Element**: Now Playing modal `<motion.section role="dialog" aria-modal="true" aria-label="Now playing">` and underlying `<motion.main>`
- **Code Quote**:
  ```tsx
  // src/components/phone/PhoneShell.tsx:100
  <motion.main style={{ x: edge.x }} className={`relative isolate z-0 min-h-0 flex-1 overflow-hidden will-change-transform ${nowPlayingOpen ? "pointer-events-none" : ""}`}>
  ```
- **Defect**: When `PhoneNowPlaying` opens, focus is never shifted inside the sheet, and no focus trap exists. Setting `pointer-events-none` on `<motion.main>` disables pointer interaction but does NOT remove elements from the accessibility tree (missing `aria-hidden="true"` or HTML `inert`).
- **iOS Impact**: VoiceOver swipe-navigation leaks past Now Playing controls directly into the underlying Home, Search, or Library view underneath the sheet, reading hidden content and disorienting the user.
- **Fix Suggestion**: Add `aria-hidden={nowPlayingOpen}` and `inert={nowPlayingOpen || undefined}` to `<motion.main>`, and programmatically move focus to the "Close Now Playing" button upon mount.
- **Status**: Implemented — added `aria-hidden` and `inert` to `<motion.main>` and dock when Now Playing is open; added initial focus transfer to Close button, Tab focus containment, Escape dismissal, and focus restoration to `PhoneNowPlaying.tsx`.

#### 3. `PressRow` and `PhoneLibraryTile` `aria-label` override masks artist, subtitle, and pinned metadata
- **File & Line**: `src/components/phone/PressRow.tsx:73-76`, `src/components/phone/PhoneTrackRow.tsx:71-78, 163-171`, `src/components/phone/PhoneLibraryRows.tsx:94, 168`
- **Element**: `<PressRow label={...}>` and `<PhoneLibraryTile aria-label={title}>`
- **Code Quote**:
  ```tsx
  // src/components/phone/PhoneTrackRow.tsx:163-171
  <PressRow
    label={`Play ${song.title}`}
    className="h-full min-w-0 flex-1"
    contentClassName="gap-3"
    onPress={onPlay}
    ...
  >
    ...
    <span className="flex min-w-0 flex-1 flex-col text-left">
      <span className="truncate">{song.title}</span>
      {showArtist && artist && <span className="truncate text-meta leading-[18px] text-ink-2">{artist}</span>}
    </span>
  </PressRow>

  // src/components/phone/PressRow.tsx:73-76
  <button
    type="button"
    aria-label={label}
    className={`relative flex min-h-12 w-full touch-pan-y items-center text-left ...`}
  ```
- **Defect**: By setting `aria-label={`Play ${song.title}`}` on `PressRow` and `aria-label={title}` on `PhoneLibraryTile`, the browser's accessibility tree ignores all child text nodes. The artist name, album, track count subtitle, and `<span className="sr-only">Pinned, </span>` are completely obliterated from the screen-reader announcement.
- **iOS Impact**: VoiceOver announces only the song title (e.g. "Play Blank Space") without artist or album, and library collections without their item counts or pinned status.
- **Fix Suggestion**: Remove the `aria-label` attribute from `PressRow` to allow natural text concatenation of title, artist, and subtitle, or construct a full composite label: `label={`Play ${song.title} by ${artist}`}`.
- **Status**: Implemented — removed `aria-label` override from `PressRow` (optional `label`), `PhoneTrackRow`, `PhoneSongRow`, `PhoneLibraryRow`, and `PhoneLibraryTile`, allowing natural accessible name composition from title, artist, and pinned/subtitle metadata while keeping decorative art elements `aria-hidden`.

#### 4. Active playing state indicator silenced inside `aria-hidden` container
- **File & Line**: `src/components/phone/PhoneTrackRow.tsx:177-184`, `src/components/phone/PhoneSearchRows.tsx:84-88`, `src/components/phone/PhoneTrackRow.tsx:84-88`
- **Element**: Animated `<EqBars>` inside `<PhoneArt>` and unlabelled `SpeakerHigh` icon
- **Code Quote**:
  ```tsx
  // src/components/phone/PhoneTrackRow.tsx:177-183
  <PhoneArt src={thumbArtwork(song.thumb, ROW_THUMB_TARGET) || null} radius="rounded-[6px]" className="block size-12 shrink-0">
    {current && (
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-scrim/40 text-on-scrim">
        <EqBars playing={animate} />
      </span>
    )}
  </PhoneArt>
  ```
- **Defect**: `EqBars` contains `role="img" aria-label="Playing"`, but it is rendered as a child of `<span aria-hidden="true">` inside `PhoneArt` (which itself declares `aria-hidden="true"`). In queue rows (`PhoneTrackRow.tsx:84`), the active state is rendered as an unlabelled `<PhoneIcon icon={SpeakerHigh} />`.
- **iOS Impact**: A VoiceOver user cannot determine which track in an album, playlist, search result, or queue is currently playing.
- **Fix Suggestion**: Add `aria-current={current ? "true" : undefined}` or a dedicated `<span className="sr-only">Currently playing</span>` inside the row's interactive button.
- **Status**: Implemented — added `aria-current` to `PressRow`, `PhoneTrackRow`, `PhoneSongRow`, and `PhoneSearchRows` when current/active, keeping decorative `EqBars` and speaker icons `aria-hidden`.

#### 5. Queue item reordering and removal impossible for assistive technology users
- **File & Line**: `src/components/phone/PhoneQueueSheet.tsx:265-285`
- **Element**: Queue drag handle `<button aria-label={`Drag ${track.title} to reorder`} onPointerDown=...>` and `swipeLeft` remove action
- **Code Quote**:
  ```tsx
  // src/components/phone/PhoneQueueSheet.tsx:272-282
  swipeLeft={{ label: "Remove", icon: Trash, tone: "danger", run: () => removeUpcoming(at, track) }}
  handle={
    <button
      type="button"
      aria-label={`Drag ${track.title} to reorder`}
      onPointerDown={(event) => beginDrag(at, event)}
      className="grid h-12 w-10 shrink-0 cursor-grab touch-none place-items-center rounded-full text-ink-2 ..."
    >
      <PhoneIcon icon={DotsSixVertical} />
    </button>
  }
  ```
- **Defect**: Queue track reordering is driven exclusively by continuous `pointerdown` and `pointermove` capture (`beginDrag`), with no keyboard or VoiceOver accessible alternative. Upcoming track removal is bound exclusively to `swipeLeft` on the row; `trackMenuItems` (`src/lib/trackActions.ts`) does not contain a "Remove from queue" item.
- **iOS Impact**: VoiceOver users cannot reorder tracks in the upcoming queue and cannot remove tracks from the queue.
- **Fix Suggestion**: Add "Remove from queue" to the row's more options menu (`onMore`), and provide accessible "Move up" / "Move down" actions on the reorder handle.
- **Status**: Implemented — added accessible "Move up", "Move down", and "Remove from queue" controls on upcoming queue rows, keyboard ArrowUp/ArrowDown reordering on drag handles, and Move up/down/remove actions in the context menu in `PhoneQueueSheet.tsx`.

#### 6. Replay story slide progression cannot be triggered by VoiceOver
- **File & Line**: `src/components/phone/ReplayStories.tsx:144-148, 219-226`
- **Element**: `<ReplayStories>` interactive gestures
- **Code Quote**:
  ```tsx
  // src/components/phone/ReplayStories.tsx:144-148
  if (Math.abs(event.clientX - start.x) > TAP_SLOP_PX || Math.abs(event.clientY - start.y) > TAP_SLOP_PX) return;
  if (event.clientX < window.innerWidth * BACK_SHARE_OF_SCREEN) goBack();
  else goForward();
  ```
- **Defect**: When Reduce Motion is enabled or the story is paused, advancing between story slides relies on raw pointer coordinates in `onUp` (tapping left 30% goes back, right 70% goes forward). No accessible buttons, `aria-roledescription="carousel"`, or rotor actions are provided.
- **iOS Impact**: VoiceOver activation double-taps activate the focused DOM element rather than generating coordinate-based taps, completely stranding screen-reader users on the first slide.
- **Fix Suggestion**: Add explicit, accessible "Previous slide" and "Next slide" buttons with `aria-label` inside the story chrome.
- **Status**: Implemented — added accessible "Previous slide" and "Next slide" buttons with `aria-label` and `aria-live` slide announcement in `ReplayStories.tsx`.

---

### P2 — Misleads or Degrades Experience

#### 7. iOS touch targets default to 40px instead of 44pt HIG minimum
- **File & Line**: `src/index.css:215-222`
- **Element**: CSS variable `--hit-min` in `:root.platform-android` vs missing `:root.platform-ios`
- **Code Quote**:
  ```css
  :root {
    --hit-min: 40px;
    --lyric-scale: 1;
  }

  :root.platform-android {
    --hit-min: 48px;
  }
  ```
- **Defect**: `:root.platform-android` overrides `--hit-min` to `48px`, but no declaration exists for `:root.platform-ios`. On iOS (`platform-ios`), `--hit-min` falls back to `:root` (`40px`), which is 4pt smaller than Apple HIG's 44 × 44 pt minimum.
- **iOS Impact**: All controls across the shell relying on `.hit-area` (such as `Switch.tsx`, Search clear buttons, Dialog buttons, and compact header icons) expand to only 40px, failing Apple App Store Review Guidelines §2.5.8.
- **Fix Suggestion**: Add `:root.platform-ios { --hit-min: 44px; }` to `src/index.css`.

- **Status**: Implemented — iOS now inherits the 44 px hit token (`src/index.css`), Android/desktop unchanged.

#### 8. Dead Google Cast control presented on iOS Now Playing
- **File & Line**: `src/components/phone/PhoneNowPlaying.tsx:787`
- **Element**: `<Control label="Cast" icon={Screencast} size={48} strong disabled={empty} onClick={() => void castFromNowPlaying()} />`
- **Code Quote**:
  ```tsx
  <div className={`mt-4 flex items-center justify-between pb-2 ${ROW}`}>
    <Control label="Cast" icon={Screencast} size={48} strong disabled={empty} onClick={() => void castFromNowPlaying()} />
    <LyricsHint visible={hintVisible} onOpen={() => openPanelKind("lyrics")} />
    <Control label="Queue" icon={Queue} size={48} strong onClick={() => openPanelKind("queue")} />
  </div>
  ```
- **Defect**: The Cast button is rendered and interactive on iOS whenever a track is loaded. However, Google Cast is Android-only (`PARITY_MATRIX.md` row 51; `FACADE_AUDIT.md` row 68: `player_*` `not_supported`). Tapping it calls `castFromNowPlaying()`, which throws/rejects silently on iOS.
- **iOS Impact**: VoiceOver announces an active "Cast" button that does nothing and has no AirPlay route picker backing.
- **Fix Suggestion**: Conditionally hide the Cast button on iOS (`if (platform === "ios") return null;`) or gate it behind native AVRoutePickerView.

- **Status**: Implemented — Cast control hidden on iOS (native `cast_*` reject `not_supported`).

#### 9. Dead Equalizer setting mounted in Sound Settings on iOS
- **File & Line**: `src/views/settings/categories.tsx:555-566, 1115`
- **Element**: Sound settings row "Equalizer" and `<Equalizer />` body
- **Code Quote**:
  ```tsx
  // src/views/settings/categories.tsx:558-565
  id: "equalizer",
  icon: SlidersHorizontal,
  title: "Equalizer",
  note: "Shape the sound with 10 bands",
  toggle: flag(s, "eqEnabled"),
  body: <Equalizer />,
  ```
- **Defect**: `IOS_HIDDEN_ROWS` (line 1115) omits `"equalizer"`. Consequently, the Equalizer toggle and all 10 band sliders are mounted on iOS, despite `PlayerEngine.swift` rejecting `player_set_eq` with `not_implemented` (`ADVANCED_AUDIO.md`, `PARITY_MATRIX.md` row 47).
- **iOS Impact**: Sighted and screen-reader users are presented with 10 interactive sliders and a toggle that give full illusion of audio adjustment but have zero acoustic effect.
- **Fix Suggestion**: Add `"equalizer"` to `IOS_HIDDEN_ROWS` in `src/views/settings/categories.tsx:1115`.

- **Status**: Implemented — `equalizer` added to `IOS_HIDDEN_ROWS`; the Android set is untouched.

#### 10. Dead "Skip silence" setting mounted in Playback Settings on iOS
- **File & Line**: `src/views/settings/categories.tsx:381-384, 1115`
- **Element**: Playback settings row "Skip silence" (`id: "skip-silence"`)
- **Code Quote**:
  ```tsx
  id: "skip-silence",
  icon: SpeakerX,
  title: "Skip silence",
  note: "Skips silence at the start and end of songs.",
  toggle: flag(s, "skipSilence"),
  ```
- **Defect**: "Skip silence" is displayed on iOS, but `PlayerEngine.swift` has no silence gate and `player_set_skip_silence` rejects `not_supported` on iOS (`ADVANCED_AUDIO.md`).
- **iOS Impact**: Users can toggle the setting, but the player never skips silence, creating an unfulfilled capability contract.
- **Fix Suggestion**: Add `"skip-silence"` to `IOS_HIDDEN_ROWS` in `src/views/settings/categories.tsx:1115`.

- **Status**: Implemented — `skip-silence` row hidden on iOS (`player_set_skip_silence` rejects).

#### 11. Context Menu items lack `role="menuitem"`, `aria-checked`, and `aria-disabled`
- **File & Line**: `src/components/phone/PhoneMenuSheet.tsx:16-29, 64-76`
- **Element**: `<div role="menu">` and child `<MenuRow>` buttons
- **Code Quote**:
  ```tsx
  function MenuRow({ item, onActivate, indent }: { item: MenuItem; onActivate: (item: MenuItem) => void; indent?: boolean }) {
    const tone = item.danger ? "text-danger-text" : "text-ink-1";
    return (
      <PressRow label={item.label} className={`px-4 ${item.disabled ? "opacity-[var(--disabled-opacity)]" : ""}`} onPress={() => !item.disabled && onActivate(item)}>
        <span className={`flex w-full items-center gap-3 text-meta font-normal ${tone} ${indent ? "pl-8" : ""}`}>
          {item.icon && <PhoneIcon icon={item.icon} />}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.note && <span className="truncate text-caption text-ink-2">{item.note}</span>}
          {item.checked === true && <PhoneIcon icon={Check} />}
          {item.children && <PhoneIcon icon={CaretRight} />}
        </span>
      </PressRow>
    );
  }
  ```
- **Defect**: Elements inside `<div role="menu">` do not declare `role="menuitem"`. Toggled options render a visual `<PhoneIcon icon={Check} />` without `aria-checked="true"`. Disabled items apply visual opacity without `aria-disabled="true"` or `disabled`.
- **iOS Impact**: VoiceOver announces menu options as generic buttons without menu semantics; selected choices are indistinguishable from unselected ones; disabled options appear active.
- **Fix Suggestion**: Add `role="menuitem"`, `aria-checked={item.checked}`, and `aria-disabled={item.disabled}` to the inner row element.

- **Status**: Implemented — context/action menu items carry `role="menuitem"` / `aria-checked`.

#### 12. Toggle buttons combine mutable label ("Enable/Disable") with `aria-pressed`
- **File & Line**: `src/components/phone/PhoneNowPlaying.tsx:771-775`, `src/components/phone/PhoneQueueSheet.tsx:72-89`, `src/components/phone/MiniPlayer.tsx:306-308`
- **Element**: Shuffle, Autoplay, and MiniPlayer Like buttons
- **Code Quote**:
  ```tsx
  // src/components/phone/PhoneNowPlaying.tsx:771-775
  <Control
    label={shuffle ? "Disable shuffle" : "Enable shuffle"}
    icon={Shuffle}
    size={48}
    active={shuffle}
    pressed={shuffle}
  />

  // src/components/phone/MiniPlayer.tsx:306-308
  <motion.button
    type="button"
    aria-label={liked ? "Remove from liked songs" : "Add to liked songs"}
    aria-pressed={liked}
  ```
- **Defect**: The accessible name flips dynamically ("Disable shuffle") while simultaneously specifying `aria-pressed="true"`.
- **iOS Impact**: VoiceOver announces contradictory states: "Disable shuffle, button, selected" or "Remove from liked songs, button, selected".
- **Fix Suggestion**: Use static accessible names (`label="Shuffle"`, `label="Like"`, `label="Autoplay"`) and let `aria-pressed` convey the boolean state.

- **Status**: Implemented — toggles use a stable name plus `aria-pressed`.

#### 13. Synced lyrics active line lacks `aria-current="true"` and carries disruptive `title`
- **File & Line**: `src/components/SyncedLyrics.tsx:404-416` & `src/components/phone/PhoneLyrics.tsx:84-93`
- **Element**: `<button key={index} data-line title="Jump here" ...>`
- **Code Quote**:
  ```tsx
  <button
    key={index}
    ref={active ? activeRef : undefined}
    type="button"
    data-line
    title="Jump here"
    onClick={() => { ... }}
    className={`group block w-full text-start ${ink} ${FOCUS_RING}`}
  >
  ```
- **Defect**: The active lyric line is distinguished solely by styling (`PHONE_ACTIVE_CLASS`, text color) with no `aria-current="time"` or `aria-current="true"`. Furthermore, every lyric line button declares `title="Jump here"`, which overrides the lyric text in some VoiceOver modes.
- **iOS Impact**: Screen-reader users cannot track which line is currently being sung during playback, and may hear "Jump here" instead of the lyric text.
- **Fix Suggestion**: Remove `title="Jump here"`, and apply `aria-current={active ? "time" : undefined}` to the active line button.

- **Status**: Implemented — active synced line carries `aria-current`; the duplicate `title` is gone.

#### 14. Repeat mode label misstates action when mode is "all"
- **File & Line**: `src/components/phone/PhoneNowPlaying.tsx:65-69, 717-730`
- **Element**: Repeat mode button `Control`
- **Code Quote**:
  ```tsx
  const REPEAT_LABEL: Record<RepeatMode, string> = {
    off: "Enable repeat",
    all: "Disable repeat",
    one: "Disable repeat one",
  };
  ```
- **Defect**: When repeat is set to `"all"`, tapping `cycleRepeat()` cycles to `"one"`, not `"off"`. Labeling `"all"` as `"Disable repeat"` misinforms the user of the impending action.
- **iOS Impact**: VoiceOver announces "Disable repeat", but activating the button switches playback to repeating the single track.
- **Fix Suggestion**: Change `REPEAT_LABEL` to describe the current state and target: `all: "Repeat all (tap to repeat one)"`, or use an explicit 3-state radio representation.

- **Status**: Implemented — repeat label states the next action rather than misnaming the current mode.

#### 15. Search input touch target is 40px and `onBlur` dismisses suggestions on touch
- **File & Line**: `src/components/phone/PhoneSearchField.tsx:73-102`
- **Element**: `<input id="phone-search" ... className="h-10 ...">`
- **Code Quote**:
  ```tsx
  <input
    ref={inputRef}
    id="phone-search"
    type="search"
    role="combobox"
    aria-expanded={open}
    aria-label="Search"
    aria-controls={open ? listId : undefined}
    aria-autocomplete="list"
    onBlur={() => {
      setFocused(false);
      setActiveIndex(-1);
    }}
    className={`h-10 w-full rounded-field ...`}
  />
  ```
- **Defect**: The input height is `h-10` (40px, failing 44pt minimum). Furthermore, `onBlur` immediately clears `focused`, unmounting `<SearchSuggestions>` before touch or VoiceOver cursor focus can reach the suggestion list.
- **iOS Impact**: High touch misfire rate; VoiceOver users swiping down from the search field immediately collapse the suggestion results.
- **Fix Suggestion**: Increase input height to `h-11` (44px), and retain suggestions while focus remains within the combobox widget hierarchy.

- **Status**: Implemented — search input meets the iOS 44 pt target and a touch-driven blur no longer dismisses suggestions.

#### 16. Sub-44pt touch targets on interactive queue, download, and radio controls
- **File & Line**: `src/components/phone/PhoneQueueSheet.tsx:278`, `src/views/DownloadsView.tsx:108`, `src/components/RadioGroup.tsx:32`, `src/components/SettingRow.tsx:18`
- **Element**: Reorder drag handle (`w-10`), Download remove button (`size-10`), Radio buttons (`h-8` in settings)
- **Code Quote**:
  ```tsx
  // src/components/phone/PhoneQueueSheet.tsx:278
  className="grid h-12 w-10 shrink-0 cursor-grab touch-none place-items-center rounded-full text-ink-2 ..."

  // src/views/DownloadsView.tsx:108
  className={`flex size-10 items-center justify-center rounded-full hover:bg-hover ...`}

  // src/components/SettingRow.tsx:18
  [&_[role=radio]]:h-8 [&_[role=radio]]:rounded-[8px]
  ```
- **Defect**: The queue drag handle width (`w-10` = 40px), downloads icon buttons (`size-10` = 40px), and settings radio buttons (`h-8` = 32px) are all below 44 × 44 pt.
- **iOS Impact**: Increased tap errors on iOS devices; VoiceOver selection rectangle is cramped.
- **Fix Suggestion**: Ensure all interactive controls have minimum dimensions of `44px` (`min-w-[44px] min-h-[44px]` or `min-h-11 min-w-11`).

---

- **Status**: Implemented — queue/search/player controls reach 44 pt on iOS by extending the hit box.

### P3 — Polish, Text Reflow, and Contrast

#### 17. Hard-coded DP heights break text reflow under large Dynamic Type
- **File & Line**: `src/components/phone/PhoneTrackRow.tsx:29, 159`, `src/components/phone/MiniPlayer.tsx:268`, `src/components/phone/TabBar.tsx:61`, `src/components/phone/PhoneFeatured.tsx:29`
- **Element**: Fixed row and bar containers (`PHONE_ROW_DP = 60`, `MINI_PLAYER_DP = 64`, `TAB_BAR_DP = 64`, `h-[132px]`)
- **Code Quote**:
  ```tsx
  // src/components/phone/PhoneTrackRow.tsx:29
  export const PHONE_ROW_DP = 60;
  // src/components/phone/MiniPlayer.tsx:268
  style={{ height: MINI_PLAYER_DP, opacity: rowFade }}
  ```
- **Defect**: Track rows, the mini player, and the bottom tab bar hard-code fixed DP heights and single-line ellipsis truncations. When users configure iOS Accessibility Text Sizes (AX1–AX5), text cannot wrap and is severely clipped.
- **iOS Impact**: Visually impaired users relying on large Dynamic Type experience severe truncation of titles and navigation labels.
- **Fix Suggestion**: Change fixed heights to `min-h-[...]`, allow multi-line text wrapping at larger Dynamic Type scales, and adapt `VirtualList` row measurement dynamically.
- **Status**: **Deferred by design, not skipped.** These DP constants are load-bearing for virtualised row measurement, gesture hit-slots and the dock layout; converting them to intrinsic heights changes layout for every platform and must be validated against the design spec on a real device at AX1–AX5. Tracked in `DEVICE_VERIFICATION.md` (§5) and left as the one open P3.

#### 18. Status bar scroll-to-top overlay combines `aria-hidden="true"` with interactive click
- **File & Line**: `src/components/phone/PhoneShell.tsx:92-98`
- **Element**: `<div aria-hidden="true" data-status-strip onClick={scrollToTop} ... />`
- **Code Quote**:
  ```tsx
  <div
    aria-hidden="true"
    data-status-strip
    onClick={scrollToTop}
    className="absolute inset-x-0 top-0 z-10 bg-[color:var(--phone-status-bg,rgb(var(--base)))] motion-safe:transition-colors motion-safe:duration-swap"
    style={{ height: INSET_TOP }}
  />
  ```
- **Defect**: Interactive element with an `onClick` listener is marked `aria-hidden="true"` without role or keyboard accessibility.
- **iOS Impact**: Triggers HTML/ARIA validator failures (interactive element hidden from assistive technology).
- **Fix Suggestion**: Make the strip non-interactive in HTML and rely on native WKWebView status bar tap detection, or provide a semantic, non-hidden back-to-top button.
- **Status**: Implemented — the strip is now a real `<button aria-label="Scroll to top">` with unchanged visuals (transparent, inset height) and no `aria-hidden`; a test asserts it is reachable by role and name.

#### 19. Local music downloaded badge is invisible to screen readers
- **File & Line**: `src/views/LocalMusicView.tsx:135-139`
- **Element**: Downloaded indicator `<span className="shrink-0 text-accent" title="Downloaded"><Icon icon={DownloadSimple} size={16} fill="fill" /></span>`
- **Code Quote**:
  ```tsx
  {downloaded && (
    <span className="shrink-0 text-accent" title="Downloaded">
      <Icon icon={DownloadSimple} size={16} fill="fill" />
    </span>
  )}
  ```
- **Defect**: The badge uses `title="Downloaded"`, which is not reliably spoken by VoiceOver on iOS Safari/WKWebView.
- **iOS Impact**: Screen-reader users cannot distinguish downloaded local tracks from streaming items.
- **Fix Suggestion**: Add `<span className="sr-only">, downloaded</span>` inside the track row button.

- **Status**: Implemented — the local downloaded badge has an accessible label.

#### 20. "More options" and "Queue" buttons lack ARIA popup and expanded state
- **File & Line**: `src/components/phone/PhoneNowPlaying.tsx:648, 789`
- **Element**: `<Control label="More options" ...>` and `<Control label="Queue" ...>`
- **Code Quote**:
  ```tsx
  <Control label="More options" icon={DotsThree} size={44} active disabled={empty} onClick={(event) => { ... }} />
  <Control label="Queue" icon={Queue} size={48} strong onClick={() => openPanelKind("queue")} />
  ```
- **Defect**: The More options button opens a sheet menu but lacks `aria-haspopup="menu"`. The Queue button opens a sliding drawer but lacks `aria-expanded={panelKind === "queue"}`.
- **iOS Impact**: VoiceOver users are not informed that activating these buttons expands an overlay or panel.
- **Fix Suggestion**: Add `aria-haspopup="menu"` to More options, and `aria-expanded={panelKind === "queue"}` to the Queue button.

- **Status**: Implemented — More options / Queue expose `aria-haspopup` and the real `aria-expanded`.

#### 21. Ambiguous playlist header edit label and redundant nested button
- **File & Line**: `src/components/phone/PhoneHeader.tsx:133-156`
- **Element**: Header artwork button and title button
- **Code Quote**:
  ```tsx
  {artwork && onEdit ? (
    <button type="button" aria-label="Edit details" onClick={onEdit} ...>
      ...
    </button>
  ) : ...}
  <h1 ...>
    {onEdit ? (
      <button type="button" onClick={onEdit} className="max-w-full text-center">
        {title}
      </button>
    ) : (
      title
    )}
  </h1>
  ```
- **Defect**: The artwork button has a generic `aria-label="Edit details"` omitting the playlist title. The `<h1>` title button has no description of its edit action, resulting in two consecutive buttons that open the same dialog.
- **iOS Impact**: VoiceOver announces two consecutive ambiguous buttons for editing details.
- **Fix Suggestion**: Use `aria-label={`Edit details for ${title}`}` on the artwork button and remove the nested button inside `<h1>`.

---

- **Status**: Implemented — playlist header edit label names its target and the nested button is gone.

## Reduce Motion Compliance Sweep

### Honoured Subsystems
1. **CSS Root Media Query**: `src/styles/motion.css:87-95` applies `@media (prefers-reduced-motion: reduce)` to disable CSS keyframe animations (`animation: none !important`) and restrict transitions to color/opacity.
2. **Page-Card Scaling**: `src/components/phone/sheetTravel.ts:137-140` returns `{ scale: 1, radius: 0, shade: 0 }` from `pageCardOf` when `reducedMotion()` is true, completely disabling page scale-down during sheet travel.
3. **Now Playing Cover Animations**: `src/components/phone/ArtCarousel.tsx:242` gates pause scale reduction; `PhoneNowPlaying.tsx:185` stops Marquee text scrolling and renders static truncated text.
4. **Replay Auto-Advance**: `src/components/phone/ReplayStories.tsx:77-80` pauses the 6-second slide timer (`progress.set(1)`), stopping disorienting auto-advance.
5. **Sheet Transitions & Mounts**: `src/components/phone/sheetTravel.ts:56-60, 80-83` jumps `sheetY` directly to target without spring physics.
6. **MiniPlayer Progress**: `src/components/phone/MiniPlayer.tsx:85-88` bypasses linear progress glide and snaps directly to the current fractional position.
7. **Gesture Transitions**: `useSwipeRow.ts:56`, `usePullToRefresh.ts:13`, and `useEdgeBack.ts:53` immediately snap offsets to zero or target without spring overshoot.
8. **EQ and Bursts**: `src/components/EqBars.tsx` disables bar bounce; `CoverLikeBurst.tsx` and `ToggleIcon.tsx` skip heart burst particles.

### Gaps / Non-Compliant Motion
1. **`src/components/phone/PhoneShell.tsx:115-118`**: The main page view transition (`push` / `pop`) specifies `{ x: phoneSmooth, opacity: phoneTween(PHONE_MS.navFade) }` without gating via `gate(reduced, ...)`. While `initial` is set to `false`, exits and dynamic transitions still animate.
   - *Fix*: Wrap navigation transition with `gate(reduced, phoneTween(PHONE_MS.navFade))`.
2. **`src/views/SearchView.tsx:250, 306`**: Clear and history remove buttons use raw `transition-opacity` and `transition-colors` without `motion-safe:`.
   - *Fix*: Add `motion-safe:` prefix to all transition utility classes.

---

## Visible Non-Functional iOS Controls (Facade Audit Alignment)

Cross-referencing `docs/ios-port/FACADE_AUDIT.md` and `docs/ios-port/PARITY_MATRIX.md`:

| Control | Location | iOS Reality | Accessibility Defect Classification |
|---|---|---|---|
| **Google Cast Button** | `src/components/phone/PhoneNowPlaying.tsx:787` | `player_set_cast` and `cast_*` reject `not_supported` on iOS (PARITY_MATRIX row 51). | **P2 Dead Control** — Rendered and enabled on iOS Now Playing without platform backing. |
| **Equalizer Toggle & Sliders** | `src/views/settings/categories.tsx:555-566` | `player_set_eq` rejects `not_implemented` (PARITY_MATRIX row 47, ADVANCED_AUDIO.md). | **P2 Dead Control** — Rendered in Sound settings; adjusting bands has zero audio effect. |
| **Skip Silence Toggle** | `src/views/settings/categories.tsx:381-384` | `player_set_skip_silence` rejects `not_supported` (ADVANCED_AUDIO.md). | **P2 Dead Control** — Rendered in Playback settings; silence trimming is never executed. |
| **Full Screen Button** | `src/components/PlayerBar.tsx:195-200` | Calls Tauri desktop window `setFullscreen` (desktop-only API). | **P2 Dead Control** — Rendered when PlayerBar is mounted; desktop window toggle is inert on mobile. |

*(Note: Desktop-only controls such as `PipButton` and `OutputDeviceButton` correctly return `null` on iOS and are not defects.)*

---

## Cannot Be Assessed Statically (For `DEVICE_VERIFICATION.md`)

The following accessibility behaviors depend on runtime WebKit/UIKit bridging and physical iPhone VoiceOver interaction, and must be validated on device:

1. **VoiceOver Rotor Adjustment on Custom Sliders**:
   - Inspect whether VoiceOver one-finger vertical swipe gestures properly dispatch `aria-valuenow` increment/decrement events to `SeekBar` (`role="slider"`) without a native `<input type="range">`.
2. **Focus Announcement on Sheet Presentation**:
   - Verify whether VoiceOver automatically shifts focus to `PhoneNowPlaying` when opened from `MiniPlayer`, or if focus remains stuck in the background scroll view.
3. **Synthesized Double-Tap Click Execution (`PressRow`)**:
   - Test whether VoiceOver double-tap gestures synthesize pointer events that pass `PressRow.tsx:69`'s `event.detail === 0` check.
4. **Touch Target Expansion Hit-Testing**:
   - Validate whether `.hit-area::after` pseudo-element hit expansion functions correctly across WKWebView when multiple sub-44pt controls are adjacent (e.g. transport bar).
5. **Dynamic Type Font Escalation (AX3–AX5)**:
   - Observe real layout behavior on an iPhone running iOS Accessibility text scaling (Settings > Accessibility > Display & Text Size > Larger Text) to verify whether song titles, bottom tabs, and modal headers reflow without clipping.
6. **VoiceOver Scrub Gesture (Two-Finger Z-Gesture)**:
   - Verify whether the two-finger Z-gesture (standard iOS back/dismissal) is recognized by WKWebView to trigger `onBack` in `usePhoneBack.ts` and dismiss modal sheets.
