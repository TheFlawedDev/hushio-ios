# Hushio iPhone — binding design preservation specification

## 1. Authority, scope, and evidence

Baseline: `2122110f9b41436723f368d3e1fb4d8a2a4276c2` (worktree HEAD verified). Extraction/review: 2026-11-23. Owner: Principal App Designer / Design Custodian. Read `CONTRIBUTING.md` and `MASTER_PLAN.md` in full. This document and `REFERENCE_VIEWS.md` are the designer's only owned outputs; no implementation or commits were made.

**E = extracted rule:** preserve the cited baseline source, including phone-specific differences from desktop. **A = iOS accommodation:** a narrowly scoped host/layout/accessibility adjustment, not an assertion about baseline behavior. **U = unresolved:** requires evidence or lead decision; not permission to redesign.

The existing React phone UI is authoritative, not a scaled desktop UI or a new UIKit interpretation. Reuse its components, Phosphor glyphs, labels, ordering, navigation, artwork, gestures, loading/empty/error behavior, and settings semantics. No replacement branding, palette, icon family, tab hierarchy, or new workflow. References below are baseline-relative unless explicitly identified as newly collected evidence. Token/component source outranks a montage or a visually inferred measurement.

**Evidence limits:** full relevant CSS (`src/index.css`, all six `src/styles/*.css`) and `tailwind.config.js` were read, along with the full principal phone components, gesture/motion helpers, routed views, settings category definitions, and selected tests cited below. This is not a claim that every application/backend file was inspected. Both repository JPEGs and the 12 browser PNGs listed in `REFERENCE_VIEWS.md` were visually opened and reviewed. Browser captures were produced by the coordinator's tooling, not by this designer; they have no native bridge and are not successful Android/iOS runs. No native iPhone visual verification exists here.

## 2. Extracted visual system (E)

### 2.1 Semantic colors and themes

Keep channel-based CSS variables and Tailwind semantic aliases; do not replace them with visually similar hard-coded colors. `src/styles/tokens.css` (`:root`, `[data-theme]`) and `tailwind.config.js` (`theme.extend.colors`) define:

| Token | Dark RGB | Light RGB |
|---|---|---|
| base | 11 11 12 | 245 245 247 |
| surface / panel | 28 28 30 | 255 255 255 |
| elevated | 44 44 46 | 255 255 255 |
| ink-1 | 245 245 247 | 29 29 31 |
| ink-2 | 174 174 178 | 104 104 109 |
| ink-3 | 142 142 147 | 134 134 139 |
| separator / line | 56 56 58 | 235 235 235 |
| wash | 44 44 46 | 240 240 240 |
| selected | 50 50 52 | 232 232 234 |
| hover | 42 42 44 | 245 245 245 |
| pressed | 50 50 52 | 237 237 237 |
| sidebar-selected | 44 44 46 | 232 232 234 |
| accent / primary | 255 107 74 | 213 65 32 |
| on-accent / on-primary | 28 28 30 | 255 255 255 |
| focus | 245 245 247 | 29 29 31 |
| safe | 74 222 128 | 20 128 61 |
| warn | 250 191 36 | 181 84 10 |
| danger | 255 69 58 | 255 59 48 |
| danger-text | 255 69 58 | 215 0 21 |
| card-edge | 255 255 255 | 0 0 0 |
| on-danger / on-scrim | 255 255 255 | 255 255 255 |
| scrim | 0 0 0 | 0 0 0 |

Other baseline values: disabled opacity `.5`; scrim alpha `.10`; fill alpha dark/light `.07/.06`, hover fill `.10/.09`, edge alpha `0`, tint alpha `.10/.08`. `lifted-*` utility behavior is in `src/index.css`. Do not normalize the distinct warning/danger text roles or substitute accent for every active state: active bottom tabs use `ink-1`, inactive tabs `ink-2` (`TabBar`).

`system`, `light`, `dark` are the actual choices; default is `system` (`src/stores/settings.ts`, `src/lib/theme.ts::applyTheme`). System light has the same palette as explicit light, through the media-query block in `tokens.css`; dark is the root fallback. OS bar updates are Android-only in `theme.ts::syncSystemBars` (A1/A2 below).

### 2.2 Fonts and typography

Runtime font variables override the initial Segoe CSS fallback. Preserve the font setting, not merely the fallback declaration. `src/main.tsx` bundles `@fontsource-variable/inter` and `@fontsource-variable/instrument-sans`; `src/lib/fonts.ts::{APP_FONTS,fontStack,applyFontVars}` and `src/lib/htmlClasses.ts::applyHtmlClasses` supply:

- Default `system`: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Display", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`. **On Android only**, System maps to the Hushio/Inter stack; Android titles always use Instrument Sans.
- `hushio`: `"Inter Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`; title stack `"Instrument Sans Variable", "Inter Variable", system-ui, sans-serif`.
- `classic`: Georgia / Times New Roman / Times / serif.
- `round`: SF Pro Rounded / Hiragino Maru Gothic ProN / Segoe UI Variable / Segoe UI / system-ui / sans-serif.
- `mono`: Cascadia Mono / Consolas / SF Mono / DejaVu Sans Mono / monospace.
- App and lyric variables receive the selected stack. Titles receive that stack except the Android/Hushio exceptions above. System-stack iOS behavior versus Android pixel parity is **U1**, not permission to silently change font policy.

Tailwind type scale (`tailwind.config.js::theme.extend.fontSize`):

| Name | Size / line height | Tracking / weight |
|---|---|---|
| page-title | 34 / 40 px | -.02em / 700 |
| section | 22 / 28 px | -.01em / 600 |
| card-title | 17 / 22 px | -.01em / 600 |
| body | 15 / 20 px | normal / 400 |
| meta | 13 / 18 px | normal / 400 |
| caption | 11 / 14 px | normal / 500 |

Component overrides are binding: simple `PhoneHeader` title uses section, 600, 36px leading, -.02em; artwork header title uses section/28px and two lines; `PhoneSectionHeader` uses card-title/26px, 600, -.02em. Track titles/metadata are usually 15/22 and 13/18. Long titles truncate or clamp exactly where components do; don't globally shrink text to fit. Numeric metadata and times use tabular numerals. Body has 400 weight, antialiasing and `optimizeLegibility` (`index.css`, `refinement.css`). Phone lyrics have their own sizes, §5.

### 2.3 Spacing, shape, layers, artwork

There is **no custom global spacing scale** in Tailwind configuration. Preserve component utility values (e.g. `gap-3` = 12px, `px-4` = 16px under the existing Tailwind base), not a newly invented 8-point grid. Common phone geometry:

- Shell: 16px horizontal content inset, top inset + 12px. Persistent dock; tab and mini player each 64px. Content bottom pad is `92px + INSET_BOTTOM` without mini, `156px + INSET_BOTTOM` with it (`src/lib/phoneNav.ts::phoneBottomPad`). `phoneBottomBlock` is respectively 76/140px + inset. Do not count these twice.
- Common gaps: row art/text 12px; quick grid 8px; library tile grid 16px; shelf sections commonly 28px apart. Now Playing horizontal rows use 24px. These are component-specific, not universal margins.
- Named radii: control 6, art 8, field 10, card/panel 12px (`tailwind.config.js`). Phone overrides: row art 6, library square 10, hero art 12, sheet top 20, dock top 24, tinted header bottom 24px. Preserve round artist portraits and circular mini covers. `[corner-shape:squircle]` is progressive enhancement; rounded fallback must remain usable in WKWebView.
- `tokens.css`: no card/chip/list shadow; float/popover/plate/toast `0 8px 24px rgb(0 0 0 / .12)`; held `0 4px 12px` alpha dark `.16`, light `.10`; disc `0 2px 8px` alpha dark `.14`, light `.10`. Dock specifically has `0 -4px 24px` black `.12`, separator top border (`PhoneShell`). Do not spread elevated shadows to every card.
- Generic `.glass-strong`: elevated background, 1px separator, plate shadow (`index.css`). `.menu-sheet` supports elevated `.96` fill, blur 20px/saturate 1.12, and its explicit double shadow (`refinement.css`), disabled by reduced transparency. The phone `Sheet` itself is **opaque elevated**, not a new frosted sheet.
- `PhoneArt`: wash + MusicNote fallback; decorative `aria-hidden` art, `alt=""` images, lazy/async load, 150ms reveal, failed-image fallback. Cache loaded artwork; don't flash blanks for cached images. `PhoneCollage`: first cover if fewer than four, 2×2 collage if four, glyph if none (`PhoneLibraryRows`). `CollectionHero` uses **first cover**, not a new animated stack (`CollectionHero.tsx`).
- `src/components/AmbientBackdrop.tsx::flatFillFor` produces **flat** artwork-derived fills, not a gradient/blob/blur redesign: light starts HSL lightness .9, saturation capped .35, adjusted against `[17,17,17]` for 4.5 contrast; dark mixes 15% cover into `[18,18,20]`, caps saturation .2/lightness .12. `useCoverFill` supplies hero fill and status strip; no extracted palette means no tint. `useHeldPalette` retains previous settled fill while a new cover resolves. Palette sampling/caching remains shared (`src/lib/artworkPalette.ts::ambientFor/readAmbient/extractAmbient`, 30×30 sample, 50-entry cache).
- On-art tokens: dark `245 245 247`, alpha multiplier 1, track .22; light `17 17 17`, alpha multiplier 1.4, track .5 (`tokens.css`, Tailwind `art` alias). Reuse `OnArtContext`/`useInk`; do not assume white text on all covers. Failed art/palette must fall back to base/surface ink, not a fabricated color.

### 2.4 Icons

`CONTRIBUTING.md`, `src/components/phone/PhoneIcon.tsx`: Phosphor, default phone 24px regular; fill only for selected/active states. Desktop default is 20px regular (`Icon.tsx`), not the phone target. Existing intentional sizes remain: header action hit box 44; hero actions 48; transport skip glyph 28; like burst glyph 96; library tile fallback glyph 40; pinned glyph 12; lyrics caret 13. Bottom tab mapping is House/ MagnifyingGlass/ Books/ Fire. Do not substitute SF Symbols. Some shared phone branches still call `Icon` at 20px (downloads badges, local actions, art fallback, chevrons); treat these as baseline exceptions, not authority to resize all phone icons. See U4.

## 3. Shell and reusable component anatomy (E)

Source prefix in this section: `src/components/` unless another path is given.

| Surface | Binding anatomy and interaction | Source / tests |
|---|---|---|
| Phone shell | `h-screen` with supported `100dvh`; one `#view-scroll` vertical scroller, no horizontal page overflow; status strip taps scroll to top; persistent dock never hides on scroll. Mini absent when no track. Opening player prevents main pointer input. Main page, dock, then player/overlays—not desktop sidebar/rail. | `phone/PhoneShell.tsx::PhoneShell`; `phone/PhoneShell.test.tsx` |
| Bottom navigation | Exactly Home, Search, Library, Hotlist → `home/search/library/charts`. Equal flex tabs, 64px bar, min 48px controls, icon above 11px label. Active fill + semibold label + `aria-current=page`, no active accent pill. Retapping current tab returns root and scrolls top; hold Search 500ms focuses field. | `src/lib/phoneNav.ts::TABS`; `phone/TabBar.tsx::TabBar`, `TabBar.test.tsx` |
| Headers | `PageHeader` delegates to `PhoneHeader`; non-root gets history back or selected tab root (`goBackOrTabRoot`). No artwork prop → compact title/action row. Artwork null → 120px fallback tile. Artwork URL → 208px square, centered title, optional 3-line description, facts, 48px Play/Shuffle row and menu/save controls. Tinted band extends behind top/status and ends with 24px bottom corners. Artist has separate circular treatment (§6). | `PageHeader.tsx`, `CollectionHero.tsx`, `phone/PhoneHeader.tsx`; `PageHeader.phone.test.tsx`, `CollectionHero.phone.test.tsx` |
| Track rows | Do not collapse variants: `PhoneSongRow` 56px high, 48px art or number, 15px title/13px artist, explicit badge, liked heart, trailing 44px menu. Current song title accent; art/number EQ indicator only animates when playing/visible/not reduced. Queue `PhoneTrackRow` is 60px, art 48px, active speaker glyph, more 48px and optional reorder handle. Search uses its own 56px result row and 64px featured art. | `phone/PhoneTrackRow.tsx::{PhoneSongRow,PhoneTrackRow,PHONE_ROW_DP}`, `phone/PhoneSearchRows.tsx`; adjacent tests |
| Press/row actions | `PressRow` highlights wash/12px radius immediately; pointer movement >10px cancels press/hold. Keyboard-generated click remains valid. Common song rows swipe right Add to queue, left Like/Unlike, unless sortable; explicit more-menu remains. Queue left action is Remove with Undo. | `phone/PressRow.tsx`, `phone/SwipeRow.tsx`, `phone/useSwipeRow.ts`; `PressRow.test.tsx`, `PhoneTrackRow.test.tsx` |
| Shelves/cards | `PhoneShelfRow` horizontal proximity snap, no scrollbar, right-edge bleed/padding 16px, gap 12px. Variants: default width148, tile116, large164, round104; compact 280px two-row horizontal list with 56px art. Titles truncate; subtitle omitted for tile/round. Quick tiles: 2 columns, gap8, 56px high, 2-line label. Featured block: 132px high/art, copy + separate 44px play at bottom-right. Long hold menu must not also activate card. | `phone/PhoneShelf.tsx`, `phone/PhoneFeatured.tsx`, `phone/useCardLongPress.ts`; `PhoneShelf.test.tsx`, `PhoneFeatured.test.tsx` |
| Library | Default 2-column tile grid, 3 columns at ≥600px; square artwork, 10px radius, title below; optional pin with screen-reader text. List alternative has 64px rows /52px art. Layout setting persists on device. Outlined New playlist tile is last; Liked tile accent with filled heart. | `phone/PhoneLibraryRows.tsx`, `src/views/LibraryView.tsx`; `LibraryView.phone.test.tsx` |
| Buttons | Hero `PHONE_PLAY/SHUFFLE`: flex, h48, gap8, radius12, 15px semibold, primary/wash or artwork overrides; icon actions 48, header icons44. Shared Button: primary/secondary/ghost, pill, h40 and coarse-pointer min44. Disabled opacity .5. Preserve visible text and button labels. | `phone/heroButtons.ts`, `Button.tsx` |
| Forms | `PhoneSearchField`: sticky at top inset, 40px wash field/10px radius, 48px search/clear hit controls, max200, no autocorrect/capitalization, search return key; combobox suggestions with keyboard active-descendant support. `PhoneTrackFilter`: 44px field, only for ≥8 songs (album/playlist). Settings filter is 44px/16px text. | `phone/PhoneSearchField.tsx`, `TrackListControls.tsx::PhoneTrackFilter/FILTER_MIN_TRACKS`, `src/views/SettingsView.tsx::SearchBox`; `SearchView.phone.test.tsx` |
| Generic sheet | Fixed bottom, full width, max90vh, top radius20, bottom safe padding, opaque elevated, 36×4px grabber. Optional header then independent scrolling body. Tap scrim dismisses. Down drag from handle/header or body only when every nested scroller is at top. | `phone/Sheet.tsx`, `phone/useSheetDrag.ts::sheetBodyAtTop`; `useSheetDragBody.test.tsx` |
| Menus | Phone context menu is `Sheet`, subject art48/title/subtitle, ≥48px PressRows, regular glyph24, meta label, optional note/check/chevron. Children expand inline/indented, dangerous labels danger-text, disabled rows dim and do not execute, group separators create spacing. | `phone/PhoneMenuSheet.tsx::{MenuBody,MenuRow}`, shared `ActionMenu.tsx` |
| Dialogs/editing | `Dialog sheet`: bottom full width/radius16, p24 + bottom inset, title/body/input/validation alert, Cancel then confirm, h48 buttons. Focus trap, Escape, input selection, Enter (modifier for multiline) retained. Playlist edit uses generic Sheet, photo120, Name/Description/character count, Cancel/Save. **PlaylistPicker remains a shared anchored-or-centered popup, not a phone Sheet**: multi-checkbox lists, Already added locked, New playlist, Cancel/Add; restores opener focus. | `Dialog.tsx`, `PlaylistEditDialog.tsx`, `PlaylistPicker.tsx`; adjacent tests |
| Settings controls | `GroupView(phone)`: elevated inset groups/radius12, separator dividers, px16, min52px rows. Switch rows toggle from row as well as switch. Non-short controls stack full width; radio segments flex/truncate. Switch visual44×24/thumb16 with hit-area; radio group h40, accent selection, arrow-key wrap; settings sliders are native range with spoken label. | `src/views/settings/SettingsLayout.tsx`, `Switch.tsx`, `RadioGroup.tsx`, `Slider.tsx`; `SettingsLayout.phone.test.tsx` |
| Equalizer | Preserve shared curve editor (not ten replacement native sliders), preset/mood segments + action menu, responsive cover/title, accent curve/fill over semantic grid, band slider handles with gain/value text, and embedded transport. Disabled EQ visually dims editor; source still exposes its handles, so do not infer it is fully interaction-disabled. | `Equalizer.tsx::{Equalizer,EqPlot,Transport}`; `Equalizer.test.tsx` |
| Toasts | Phone stack centered top inset+8, z110, newest first, drag dismiss, lifetime pauses while focused/touched/hidden. Dark toast plate in **both** themes: #1c1c1e/.96, white text, radius18, min48, max min(420, viewport−32); artwork or status icon, message/detail, optional action/progress and dismiss. Errors role alert; others status. Hard-coded toast colors are extracted exceptions, not a replacement palette. | `Toasts.tsx::{Toasts,ToastCard}`, `src/lib/toastStack.ts`; `Toasts.test.tsx` |
| Notification banner | Top inset+8, side16, elevated/radius16, Bell/text/Open settings; appears after actual permission state/request during first track. Existing message says notifications hide media controls: Android-specific assertion, **must not be copied to iOS without validation** (A6). | `phone/NotificationBanner.tsx`; adjacent test |
| Empty/error/loading | Phone EmptyState max280, centered icon/title17/22 + message15/20, 44px primary action, optional secondary; ErrorState wraps it in role alert. Skeletons match actual card/row geometry; do not replace with a blocking spinner. Existing results remain on pagination failure. | `EmptyState.tsx`, `ErrorState.tsx`, view skeletons, `SkeletonSwap.tsx` |

Layering must retain interactivity and ordering: shell dock z20; Now Playing z40; toast110; generic sheet115; Dialog/PlaylistPicker120; Replay120/share130. Do not copy z-values into a new independent native stack without checking keyboard, focus, and modal ownership (`PhoneShell`, `Sheet`, `Dialog`, `Toasts`, `ReplayView`).

## 4. Gestures and motion (E)

### 4.1 Gesture contracts

Keep shared physics; do not replace thresholds by UIKit defaults. All distances below are baseline CSS-pixel units; velocity is px/s. `src/lib/gesturePhysics.ts::projectDistance` uses `(v/1000 * .998)/(1−.998)`; `landsPast` requires projected landing to retain offset sign. `rubberBand` coefficient `.55`; row beyond-reveal multiplier `.3` (`trackSwipe.ts`). Velocity tracking stays shared.

| Gesture | Extracted behavior / limits | Source / test evidence |
|---|---|---|
| Axis/press | General axis locks after 10px Euclidean travel (x only if abs(dx)>abs(dy)); mini/pull locks8. Press slop10, long hold500ms. Cancelled holds do not play. | `src/lib/{trackSwipe,touchGesture,gestureClaim,phoneGestures}.ts`, `phone/{PressRow,useCardLongPress}.tsx/ts`; `phoneGestures.test.ts`, `PressRow.test.tsx` |
| Mini player | Tap or upward swipe opens player; upward pull follows shared `sheetY` (normal motion), release projects to nearer half-screen endpoint. Horizontal left next/right previous, projected threshold .3×row width with min16px movement; missing neighbor rubber-bands. Like/play buttons do not initiate rail gestures. No global page-content swipe-up opener. | `phone/MiniPlayer.tsx`; `MiniPlayer.test.tsx`, `PhoneShell.test.tsx` |
| Artwork carousel | Horizontal art swipes only: raw travel threshold72 with projection, visual follow share .35, neighbor gap24. Absent neighbors resist; blocked/cancelled releases return. A swipe over the *outer player pages container* alone must not skip. | `phone/ArtCarousel.tsx`, `src/lib/trackSwipe.ts`; `PhoneNowPlaying.test.tsx` |
| Cover double tap / hold | Double tap ≤300ms /24px spatial slop **adds like only** (doesn't unlike); repeated liked double tap may still show feedback. Hold500 opens track menu; moving/cancelling cancels. | `phone/useCoverGestures.ts`, `src/lib/phoneGestures.ts::isDoubleTap`; `phoneGestures.test.ts` |
| Row swipe | Left/right configured action only; 96px reveal, projected commit80 with min16px, returns to zero after execution/cancel. Song sortable rows suppress swipe to prevent drag conflict. | `phone/{useSwipeRow,SwipeRow,PhoneTrackRow}.ts/tsx`; `phoneGestures.test.ts` |
| Sheet dismissal | Projected down travel >.28×driver height dismisses; release/cancel otherwise settles. Body up-drag scrolls; nested scroller away from top prohibits content dismissal. Actual `useSheetDrag` rule wins over older `touchGesture.sheetCloses` (.4/500) or a stale test title mentioning 40%. | `phone/useSheetDrag.ts::sheetReleaseCloses`; `useSheetDrag.test.ts`, `useSheetDragBody.test.tsx` |
| Queue/lyrics panel | Up over art/transport opens **lyrics**, not queue; seek slider excluded. Queue opens by Queue button. Existing open lyrics scroller wins when scrollTop>0; header/down drag closes panel rather than changing track. Panel travel .5×viewport; >.3 progress change or flick beyond ±450px/s commits, otherwise returns start state. Queue and lyrics mutually exclusive. | `phone/{PhoneNowPlaying.tsx,nowPlayingPanel.ts}`; `PhoneNowPlaying.test.tsx`, `nowPlayingPanel.test.ts` |
| Queue editing | Only ordinary upcoming rows get drag grips; cannot reorder played/current or cross autoplay boundary. Auto-scroll edge56/max18px per frame; row slots60px. Swipe remove posts 5s Undo; Clear disabled if neither ordinary nor autoplay future exists. Previous section initially collapsed. | `phone/PhoneQueueSheet.tsx::PhoneQueueList`; `PhoneQueueSheet.test.tsx` |
| Edge back | Baseline starts x24…44 (deliberately beyond Android OS back zone), positive horizontal movement; projected .35×viewport commit + min16px. Ignores swipe rows/hscroll/input/textarea/contenteditable/no-edge-back. Disabled with primary overlays. | `phone/useEdgeBack.ts`, `src/lib/phoneGestures.ts`; `phoneGestures.test.ts`, `useEdgeBack.test.tsx` |
| Pull refresh | Home and Hotlist at scrollTop≤0, downward single touch only, horizontal rejected. Rubber-banded distance70 arms, held44 while refreshing, 4s fallback cleanup; tick on crossing arm boundary, select on refresh. | `phone/usePullToRefresh.ts`, `phone/PullIndicator.tsx`, `src/lib/gestureClaim.ts`; `phoneGestures.test.ts` |

Android hardware-back priority is source behavior, **not** a new iPhone exit gesture: context menu → song info → dialog → playlist picker → lyrics/queue, then player, history, Home, double-back-to-exit (`phone/usePhoneBack.ts`, `src/lib/phoneBack.ts`). On iPhone retain visible back/close actions and overlay ordering; no “Press back again to exit” toast or app-exit action (A5).

### 4.2 Motion values and Reduce Motion

`src/lib/motion.ts` is binding. Units milliseconds unless spring parameters:

- Ease out `[.22,1,.36,1]`; ease in/out `[.42,0,.58,1]`; CSS emphasized `[.2,0,0,1]` and sampled `--ease-settle` retained from `tokens.css`.
- Shared durations: quick140, fade120, picker180/out120, swap220, reading150, settle500, press50, pageIn240, reveal280, stagger40, hover200, nowPlayingExit210, roll380, lyric400, queue420, progress300, toastOut160. Loops: EQ420, sheen1300, spin850. Do not arbitrarily speed all animations to a platform default.
- Phone tween durations: scrim160, tab140, navFade160, artIn180/out120, text150, icon160, press50, likeHold290/fade160/beat120, lyricsHint400.
- Springs `(stiffness,damping,mass)`: snappy `(420,36,1)`, smooth `(260,30,1)`, bouncy `(380,29,1)`, shared `(300,34,1)`; sheet `(195,27.93,1)` restDelta .5; Now Playing `(400,40,1)` restDelta1/restSpeed20; art pause `(300,33,1)`; scrub `(400,36,1)`; cover snap `(400,40,1)`. `nowPlayingEnter` is an alias, but actual current `sheetTravel.glideSheet` uses `nowPlayingSpring`; don't port by alias name alone.
- Common press `.97` scale/.82 opacity over50ms; `PressRow` uses immediate wash instead. Toggle details remain in `src/lib/toggleMotion.ts`: shuffle x[0,3,−3,0]/320ms, repeat rotate0→180/400ms, like-on scale[.8,1.15,1]/400ms; reduced disables these transforms. Filled glyph and semantic pressed state persist without motion.
- Phone navigation push/pop x ±24 with smooth spring/nav fade160; tab switch140. First load rises8px, reveals first five children40ms apart; `useFirstLoadStagger` removes replay after completion/1s fallback. Home initial reveal is once per session within1200ms (220ms item/40ms stagger cap index4); later appends opacity180, not repeated rise (`phone/HomeReveal.tsx`, `src/lib/homeIntro.ts`).
- `sheetTravel.ts`: background page scales to .93, radius12, shade .4; mini fades within first .25 openness; sheet corners16 flatten from .85→1; shared cover moves from circular mini to full cover radius12 by half openness. On hidden/pagehide settle to a clean endpoint, including interrupted dismissal. No residual scaled/dimmed page after return (`PhoneShell.test.tsx`).
- `ArtCarousel`: size `min(88vw,56vh,460px)`; paused artwork .86 scale, normal playing1; neighbors focus scale .9→1 and opacity .6→1. Marquee after rest5s moves26px/s, gap48; artist starts3s later. Under reduced motion truncate, no crawl (`PhoneNowPlaying.tsx::Marquee`).
- Panel animation420ms × remaining distance, ease `[.4,0,.2,1]`; lyrics ease `cubic-bezier(.41,0,.12,.99)`.

Reduce Motion is **required** by `CONTRIBUTING.md`: `MotionRoot` combines OS/app preference; `htmlClasses.ts` manages `.reduce-motion` and zero CSS durations; `reducedMotion()` checks class/media query. `gate` returns instant; `phoneTransition` uses 120ms opacity fade. `styles/motion.css` removes animations, transforms from transition properties, and smooth scrolling under system/class reduction. Keep still state and actions available; do not remove controls/gestures simply because motion is off. Gesture-following displacement can remain directly user-driven in some baseline handlers; **no automatic spring/travel/loop should survive** without validation. `PlayPauseGlyph` loops only while page visible and not reduced; `CanvasVideo` is muted/inline/decorative, detaches src while hidden, fails back to art; animated covers additionally depend on preferences/data saver (`ArtCarousel`, `useCanvasClip`). Reduced transparency disables menu backdrop blur (`styles/refinement.css`) independently of motion.

Tests: `src/lib/motionPhone.test.ts` (near-critical damping .85…1.01 except bouncy; 120ms reduced fade; press≤50ms); `src/components/phone/sheetTravel.test.ts`; `src/lib/{motionBudget,homeIntro}.test.ts`. These are contracts, not evidence of iOS frame pacing.

## 5. Player, queue, lyrics states (E)

- **Mini** (`phone/MiniPlayer.tsx`): 64px, circular40px cover, title15/18 medium + artist13/17; heart44 circular, play44/radius15 using ink-1 against surface. Accent2px progress at bottom; updates300ms, immediately resets for new track. Buffering uses CircleNotch instead of play/pause; unknown length clamps fraction. No track means no mini, not a disabled dummy row.
- **Full player** (`phone/PhoneNowPlaying.tsx`): full-screen dialog `Now playing`, top/bottom safe padding. Header48 with down44, centered Now playing/source13, exactly one More44 at right. Artwork flexible center, then Download44 / centered title22/28 + artist15/22 / Like44. Seek44 hit area, bar7px idle→12 active; elapsed/duration13 and unknown `--:--`. Transport order **repeat48, previous56, play64, next56, shuffle48**. Bottom Cast48 / visible text Lyrics / Queue48. No phone volume slider or timing nudge row. Album/playlist source text uses `nowPlayingSourceName`, not a fabricated source.
- Seeking previews accessible position but commits only at release; track replacement, lost capture or cancel cancels preview. Keyboard ±5s, Home/End; duration unknown disables focus/seeking; position clamps (`PhoneNowPlaying.test.tsx`, “phone seeking safeguards”).
- Repeat/shuffle retain labels/pressed state, active dots and repeat-one badge. Empty player says Nothing playing, disables appropriate transport/menu/cast; download slot remains reserved if not downloadable. Download states label Download / Downloaded / Downloading N%, cancel busy, reveal completed, download idle; don't claim reveal-to-folder works on iPhone (A6).
- Queue is **embedded player panel**, despite filename `PhoneQueueSheet.tsx`: 54px header thumb + title17/artist15, transparent content over tint; modes shuffle/repeat/autoplay, previous toggle, Now playing/source, Up next/Clear, Autoplay explanation. It is not the desktop RightRail nor a second generic bottom sheet. Empty future says Nothing up next. Test `PhoneQueueSheet.test.tsx` explicitly rejects background blocks masking the tint.
- Phone lyrics panel (`phone/PhoneLyrics.tsx`): keeps the same compact track header; auto-prefetch starts when player opens. Loading hint may show Lyrics; absent text hides the hint, while an upward gesture may still reveal Lyrics not available. Empty no-track message Play something to sing along. Optional custom reset and translation icon only when applicable; no dedicated phone timing editor.
- Synced lines (`SyncedLyrics.tsx`): active28/36 semibold, others section22/28 semibold, gap14, no scaled horizontal overflow; anchor .34 of scroller. `dir=auto`, text-start, long scripts wrap anywhere, transform origin matches script. Translation/romanized/background sublines15/22. Word-synced gradient and optional2px lift use actual timing; source credit retained. Current line auto-scroll uses600ms quartic glide (jump if >1.5 screens or reduced); manual browsing suspends follow for3s and opacity becomes .8; drag/click guards prevent accidental seek. Tapping timed line seeks using shared lead-in/offset, not exactly a screenshot timestamp. Plain text fallback when unsynced/no timings. `SyncedLyrics.phone.test.tsx` verifies28px, no scale,14px gap, RTL, translation and falloff. Phone blur/falloff is its own branch: paused/reduced/reduce-blur stops blur; the `blurUnfocusedLyrics` preference does not currently gate phone falloff blur as the desktop branch does (U3).

## 6. Per-screen preservation map (E)

All routes come from `src/views/CurrentView.tsx::CurrentView` / `src/stores/navigation.ts`. iPhone reuses the **phone column**, not the desktop column. `REFERENCE_VIEWS.md` tracks visual coverage separately; a source mapping is not a screenshot pass.

| Screen / route | Existing desktop → authoritative phone mapping, retained states/actions | Principal source / tests |
|---|---|---|
| Home `home` | Desktop chips/8 quick items → greeting+profile, ≤6 two-column quick tiles, featured132, phone shelves; no desktop All/Songs filter row. Pull refresh and progressive feed. First empty loading skeleton matches56/132/164 shapes; failure Couldn't load Home/Try again; empty Search for songs; pagination error Show more music retains content. | `src/views/HomeView.tsx::HomeView/PhoneSkeleton`; `HomeView.phone.test.tsx`, `components/FeedSections.phone.test.ts` |
| Search `search` | TopBar search/browse grid → in-view sticky field; idle Search/profile, recent chips horizontally and ≤6 recently opened, **no Browse all**. Typed query hides title, retains input/focus; scopes Online/On device/+Add-ons if enabled. Result filter chips All/Songs/Videos/Albums/Artists/Playlists; flat phone result rows, featured top result. Debounce300ms. Loading/no results/error/retry and incremental failure distinct. | `src/views/SearchView.tsx`, `phone/PhoneSearchField.tsx`, `phone/PhoneSearchRows.tsx`; `SearchView.phone.test.tsx` |
| Library `library`, `playlists` | Desktop hero/stacks → Library compact header Create/layout/profile; collection tiles/rows (Liked, Downloads, History, Local music) plus Import; folders then pinned-first unfiled playlists and New playlist; saved Albums section conditional. No desktop facts/Collections heading or duplicate Playlists nav row. Layout persists; missing art/collage/pins retained. | `src/views/LibraryView.tsx`; `LibraryView.phone.test.tsx` |
| Liked `library:liked` | CollectionHero first cover/fallback, Play/Shuffle; phone song rows/current/likes/menu, empty No liked songs yet/Find songs. Desktop sort/filter/header columns are not present phone controls. | `src/views/LikedView.tsx`; `LikedView.test.tsx` |
| Playlist `playlist:id` | Desktop232px horizontal hero/table/selection → centered phone hero, editable art/title/description only for nonremote, Play/Shuffle/More, filter only≥8, phone rows; reorder in custom/unfiltered state suppresses row swipe. Local empty retains finder; remote empty explains sync. Missing playlist has explicit gone state. Finder/recommendations remain conditional, not removed. | `src/views/PlaylistView.tsx`; `PlaylistView.test.tsx`, `PlaylistView.selection.test.tsx`, `phone/PhoneTrackRow.tsx` |
| Remote playlist `ytplaylist:id` | Desktop PageHeader → CollectionHero with first cover, owner/facts, Play/Shuffle/More; rows/menu and empty text, loading skeleton/error retry. Not editable as a local playlist. | `src/views/RemotePlaylistView.tsx`; `RemotePlaylistView.phone.test.tsx` |
| Album `album:id` | Desktop giant title/footer → tinted centered208px art, title/artist/year/release/count, Play/Shuffle/Save/More. Numbered phone rows; hide repeated artist credit; filter≥8; About/release notes/copyright/More by artist/discography retained. Loading/error/retry/save states. | `src/views/AlbumView.tsx`; `AlbumView.test.tsx`, `PageHeader.phone.test.tsx` |
| Artist `artist:id` | Desktop300px banner/large heading → **144px circular portrait** centered, title22/28, subscriber/listener metadata, Play/Shuffle/More. Liked-by-artist collapsible; About, Popular≤20, release shelves with See discography. Follow in menu; loading/error/empty sections conditional. | `src/views/ArtistView.tsx::{ArtistContent,LikedByArtist}`; `ArtistView.test.tsx` |
| Downloads `downloads` | Table/status columns → centered collection fallback/cover, Play/Shuffle disabled if no saved tracks;56px rows/art48, completion/progress clipping and icon, subtitle status or artist, More. Alphabetical titles. queued/downloading/waiting Wi-Fi/failed/done distinct; only done plays. Empty Find songs. | `src/views/DownloadsView.tsx::{DownloadsView,DownloadRow,statusLine,badgeIcon}`; `DownloadsView.test.tsx` |
| Local music `local[:all/opened/path/net:id]` | Reuse existing phone branches, **not a newly homogenized track list**. Fresh empty Play your own files/Choose a folder; index hero Play/Shuffle/Rescan/Add folders + CoverStacks, imported folders/On this device/Opened files/network servers. Detail has Songs/Albums/Artists/(Folders), source All/Local files/Downloaded, title/artist sorts, search and breadcrumbs. Local rows text-first56px; missing folder alert, scanning tags/art status, no files/no matches/import cancel/failure retained. Network rows remain their shared layout. | `src/views/LocalMusicView.tsx` (full file, `IndexView/CollectionView/SongsTab/NetworkCollectionView`); `LocalMusicView.test.tsx` |
| Settings `settings[:category]` | Desktop category sidebar → root Settings/back/search; account64 + Downloads52 inset box; four groups: Playback/Sound/Lyrics; Display/Library; Scrobbling/Your data; About. Category navigates own page, back returns list; searching renders matching group controls/no-match copy. Capability-specific rows are §7, not automatic desktop exposure. | `src/views/SettingsView.tsx::{PhoneSettings,PHONE_GROUPS}`, `settings/SettingsLayout.tsx`; `SettingsPhone.test.tsx` |
| Queue / Now Playing / Lyrics | Desktop RightRail/full player/LyricsCenter → existing MiniPlayer and full player with embedded queue/lyrics (§5); not new tab routes. | `phone/{MiniPlayer,PhoneNowPlaying,PhoneQueueSheet,PhoneLyrics}.tsx`; adjacent tests |
| Hotlist `charts` | Desktop Charts title/meta → Hotlist/profile; phone numbered tracks and horizontal album shelves, pull refresh, loading/error/retry/empty. | `src/views/ChartsView.tsx`; `ChartsView.phone.test.tsx` |
| Discography `discography:id`, New releases `newreleases` | Desktop adaptive grid → existing3-column phone grid, gap12×20, title15/18/meta13/17, art10px radius. Discography filters conditional; loading/empty/error retry preserved. | `src/views/{DiscographyView,NewReleasesView}.tsx` |
| Folder `folder:id` | Collection hero Play/Shuffle/options; existing CoverStack playlist children, empty/missing states, phone56px Add playlists rows with44px Add. | `src/views/FolderView.tsx`; `FolderView.test.tsx` |
| History `history` | Desktop collection hero → simple PhoneHeader/metadata/back + standalone Play; day-grouped56px rows with art48,time,menu. Loading/error/no-history/removal outcomes retained. Do not infer phone single-tap behavior from appearance: shared selection/double-click code needs device validation. | `src/views/HistoryView.tsx`; `HistoryView.test.tsx` |
| Daylist `daylist` | Phone CollectionHero Play/Save; shared social track list with responsive hidden numbering/durations, source/menu/current mark. Existing empty Find music. Not a new bottom tab. | `src/views/DaylistView.tsx`, `src/styles/social.css` |
| Replay `replay` | Desktop stats dashboard → full-screen `ReplayStories`: intro/songs/artists/time/share according to data, progress bars,6s auto-advance (off reduced), hold180ms pauses, tap left30% back/right forward, down dismiss, periods/share. Loading/error/thin-history retained. Not a new dashboard layout. | `src/views/ReplayView.tsx`, `phone/ReplayStories.tsx`; `ReplayStories.test.tsx` |
| Import/export `import[:id]` | `MatchedPlaylistView` chooses import hub/result; phone uses PageHeader and64px action rows Paste/File/Spotify/YouTube/backup/export, actual linked/guest/busy/error/matching states. Paste field grows to6 lines; file types csv/txt/m3u8/m3u/json. Do not claim OAuth is configured or replace credential errors. | `src/views/MatchedPlaylistView.tsx`, `components/ImportPage.tsx`, `components/ImportMatched.tsx`; `ImportPage.test.tsx`, `ImportMatched.test.tsx` |

`SessionGate.tsx` currently directly returns App and starts auth; `Onboarding.tsx` and `LaunchIntro.tsx` exist but are **not mounted by current main/SessionGate**. Do not insert a new mandatory onboarding or splash sequence merely because those components exist. Their source/tests are available for the lead's reachability decision (U5).

## 7. Settings presentation and truthful states (E + A6)

`src/views/settings/categories.tsx::buildCategories/forPlatform/ANDROID_HIDDEN_ROWS` is the source of row membership, labels, notes, dependencies and native-specific conditions. All nine category IDs remain. Shared controls must reflect actual capability, not display a successful toggle with no effect.

Baseline Android hides: `crossfade`, `automix`, `stats-for-nerds`, `close-to-tray`, `output-device`, `reduce-transparency`, `hide-volume-bar`, `download-folder`, `export-downloads`, `discord-rich-presence`. It **adds Android-only** mobile data quality, vibration feedback, download Wi-Fi-only, automatic update check and Android update control. Thus “use phone layout” alone is insufficient: a naïve new `ios` platform would fall through to desktop rows and lose mobile rows.

Preserve phone root grouping, row design and valid shared settings. Lead/services/media owners must explicitly classify each platform-sensitive row for iOS (A6). No automatic global Android→mobile replacement, new fake output-device picker, APK update control, Windows tray, Music/Hushio filesystem path, GNOME/KWallet instructions, or Android notification copy on iPhone. Where a real iOS limitation exists, preserve the feature entry/status with truthful explanation until the lead records implemented/blocked/inapplicable; hiding controls must not conceal missing parity.

Retain dependency states: lyrics blur/romanization/timing disabled with synced lyrics off; EQ clipping dependent on EQ; sign-in unconfigured versus waiting/cancel/signed-in versus key storage failure; sync running disables Sync now; unlimited-sync warning/TV states; scrobble configuration; import/export destructive confirmation and validation. Preserve names, numeric values/ranges and settings data; native-service owners own conversion, not design.

Subpages keep current structure: `HomeSectionsSettings`, `NetworkServersSettings`, `AddonSourcesSettings`, `CrashLogs`, `AboutSettings` under `src/views/settings/`. They are not new root tabs. Their exact native capability outcomes still need captures (§10/U2).

## 8. Accessibility baseline and acceptance

**E:** every control needs a visible focus ring and every animation respects system Reduce Motion (`CONTRIBUTING.md`). `index.css` provides2px focus/.6 with2px offset on controls/roles/tabindex; input overrides inset1px, forced-colors uses Highlight. Component explicit rings and roving radio/combobox keyboard semantics must survive.

**E:** preserve spoken names/states already present: Main navigation, Mini player, Now playing dialog, Seek value/time, Play/Pause, More options for [track], Like/Unlike or Add/Remove liked, drag [track] to reorder, pinned text, translation pressed, radio/switch checked, disabled semantics, progress/load statuses and error alerts. Decorative artwork/glyphs remain hidden. Selected states are not just color: fill, dot, badge, text and ARIA are retained (`PhoneIcon`, `PhoneTrackRow`, `PhoneNowPlaying`, `RadioGroup`, `Switch`, `SearchView`).

**Limits, not a pass:** `src/a11y.smoke.test.tsx` checks control names/focus-rule presence and mainly desktop20px glyphs; its stale “Hugeicons” test title does not override actual Phosphor imports. It is not VoiceOver/contrast/touch testing. `src/styles/tokens.contrast.test.ts` verifies dark ink on base/surface and on-accent/on-primary ≥4.5; it does not prove every light/on-art/disabled combination. `PhoneMenuSheet` gives disabled rows visual/invocation protection but not native disabled state; `Sheet`/full player declare modal without the shared Dialog's full focus trap/restore implementation. Queue drag handle lacks a verified VoiceOver reorder alternative. These are U3/U4, not verified accessibility parity.

**A7 — iOS accessibility accommodation:** verify VoiceOver reading/focus order, modal focus isolation and restoration, adjustable seek/ranges, accessible menu disabled state, gesture alternatives, and text enlargement on physical device. Retain all existing labels/actions and minimum44×44pt equivalent hit regions without shrinking the current48px controls. Only enlarge invisible hit area or allow local vertical reflow/scroll to resolve actual clipping; no global aesthetic rescaling. Baseline `.hit-area` min is40px, Android48; an iOS44px minimum requires an explicit platform rule and overlap audit. Do not describe Android48 as an existing iOS rule.

Larger text must not obscure primary actions; retain RTL and multilingual line behavior. Record defects instead of declaring Dynamic Type support: most type is fixed pixels, `--lyric-scale` does not affect the fixed phone line classes, and the iOS text-size mapping is not yet specified. Keep the existing five font choices; don't impose a new accessibility font family. Validate contrast on actual flat art and both themes before accepting (A7).

## 9. Necessary iPhone accommodations — explicitly not extracted rules

| ID | Minimum accommodation | Boundary / acceptance |
|---|---|---|
| A1 | Detect iOS and route it to existing PhoneShell/usePhone branches using short side<840, including landscape. Extend platform class/font/theme decisions individually. | `bridge.detectPlatform` currently has no ios and can classify iPhone UA as macos; `App`/`usePhone` require Android. No desktop chrome/sidebar/rail, no tablet redesign. Preserve existing Android behavior. |
| A2 | Use **one** safe-area coordinate system for WKWebView/host; supply top/bottom and, where needed, left/right insets without double padding. Permit edge-to-edge backdrop while controls stay clear. | `phoneNav` uses `--inset-*` before env fallback; `startInsets/applyInsets` is Android-native and may write zero. `index.html` lacks `viewport-fit=cover`; host and viewport choices need device verification before adjustment. Native status icon tone must match base/tinted header/player in light/dark. Don't draw fake status/home bars. |
| A3 | Keyboard/visual viewport accommodation only where measured: keep active input, suggestions, dialog validation, and confirm/cancel reachable above keyboard; restore underlying scroll on dismissal. | `viewport.ts` listens to visualViewport resize but reads innerHeight; sheets use90vh and fixed overlays. WKWebView resizing policy is unverified. Do not add a second page scroller, overpad home indicator twice, or hide the tab hierarchy permanently. Input focus preservation must still pass Search phone test. |
| A4 | Compact-height/landscape accommodation: retain phone shell and control order; ensure full player and forms can reflow/scroll within safe bounds if actual clipping occurs. | Full player combines56vh art with fixed controls and min16px spaces; not proven on short phones. Preserve artwork ratio and64px central play; shrink flexible art before reducing touch targets. Honor left/right notch insets in landscape; current shell primarily consumes top/bottom. |
| A5 | Resolve WKWebView/native interactive-back conflict with one owner; reuse in-app history, visible back/close and gesture exclusion rules. | Keep baseline gesture until tested; Android24…44 zone is not an iOS mandate. Do not layer duplicate native/page back pops; no double-back exit or swipe-to-exit on iOS. If edge-zone changes are necessary, record measurement/test and obtain lead/design sign-off. |
| A6 | Translate real OS service presentations (document/photo picker, sandbox save/share/export/reveal, auth return, permission explanations, native cast/media output capability, haptics) beneath existing flows. | No native no-op success; no new AirPlay/CarPlay feature assumed. Native picker appearance may be OS-owned, but shared trigger/copy/result/error states remain. `haptics.ts` uses Android navigator.vibrate; map tick/select/success/warning semantics to actual iOS feedback, retain preference/visibility/throttle40ms. Audit settings membership per §7. |
| A7 | Accessibility accommodations in §8, including Reduce Motion/transparency propagation from OS and modal focus behavior. | Minimum local changes backed by VoiceOver/large-text evidence; no icon/font/palette redesign. |
| A8 | WKWebView rendering fallbacks only when unsupported CSS actually fails: corner-shape, masks, dvh, canvas/video, scrolling/overscroll. | Rounded fallback, plain image, semantic fills and existing reveal behavior first; no replacement gradients/glass. Compare snapshots/videos at matching logical viewport, theme, font, content and motion setting. |

## 10. Unresolved issues and acceptance gate

| ID | Open issue / lead handoff | Required evidence or decision |
|---|---|---|
| U1 | Font policy: Android System=Inter/title Instrument, generic System on iOS would use SF. Both are existing source policies, but not identical visually. | Lead/design decision before font adapter change: preserve phone default metrics for strict visual reference, or explicitly accept source-defined system font on iOS. Keep selected font IDs and Hushio choice intact either way. |
| U2 | Reference completeness: no successful native iPhone capture; no fresh populated search/playlist/album/artist/player/queue/lyrics capture, and missing states/themes/sizes. | `REFERENCE_VIEWS.md` capture plan. Existing browser errors must not be cropped away to imply native parity. |
| U3 | Baseline inconsistencies: phone lyrics fixed size bypasses lyric scale; phone blur branch bypasses blur toggle; full-bleed setting is not visibly consulted by PhoneNowPlaying; hero fill theme-change refresh depends on src effect; some settings exist with no phone surface effect. | Separate baseline defect from port regression; reproduce native baseline and decide narrowly with lead. Don't silently “fix” as part of port styling or claim preferences verified. |
| U4 | Accessibility/touch evidence incomplete: generic modal focus isolation/restore, queue reorder alternatives, menu disabled semantics,40px shared controls, fixed-size chips/EQ handles at narrow widths, icon20 exceptions. | VoiceOver/keyboard/target overlap/contrast audit; keep source working behavior while applying only necessary A7 fixes. |
| U5 | Unreachable/existing alternative UI: Onboarding/LaunchIntro components versus SessionGate directly mounting App. | Source atlas/lead determines reachability; no new mandatory welcome flow. |
| U6 | iPhone keyboard, compact-height player, landscape notch, native back/status bar, permission copy, haptic and WKWebView feature support are not verified. | Simulator + physical iPhone tests, screenshots and gesture recordings; classify failures without redesign. |
| U7 | Android-hidden rows versus all existing shared capabilities (crossfade/Automix/etc.) and iOS-specific updates/files/cast limitations. | Feature-matrix owners decide adapter/capability contracts. Do not treat Android hiding as proof an existing shared feature can be deleted from iOS parity. |

### Verification performed

Designer ran the following using installed dependencies only:

```sh
pnpm exec vitest run src/styles/tokens.contrast.test.ts src/lib/motionPhone.test.ts src/lib/phoneGestures.test.ts src/lib/phoneNav.test.ts src/lib/insets.test.ts src/components/phone/PhoneNowPlaying.test.tsx src/components/phone/PhoneShell.test.tsx src/components/phone/PhoneQueueSheet.test.tsx src/components/phone/useSheetDragBody.test.tsx src/views/HomeView.phone.test.tsx src/views/SearchView.phone.test.tsx src/views/LibraryView.phone.test.tsx src/views/SettingsPhone.test.tsx src/components/SyncedLyrics.phone.test.tsx
```

Result: **14 files, 167 tests passed** (22.30s, 2026-11-23). This is a targeted frontend baseline check, not full-suite/typecheck/Rust/device sign-off. Other cited tests are source references unless included in this command. Coordinator-owned full-baseline logs are separate evidence, not this designer's execution claim.

### Minimum safe adaptation and design gate

Start with A1/A2 (actual phone shell and nonduplicated safe areas), then A3/A4 only to prevent real keyboard/compact clipping, A5 single back owner, A6 truthful native capabilities, A7 accessibility/OS preferences, A8 measured rendering fallbacks. **Do not reimplement the visual components or change shared business logic.** Leave U1…U7 visible until resolved.

Design acceptance requires required reference views at compact+large logical iPhone sizes, light+dark, normal+Reduce Motion; matched data/fonts/scroll/player state; keyboard and inset variants; VoiceOver/large text; and physical-device evidence. Compare color/geometry/type/icon/order/state against source and known-good native phone references, record all differences and authorize only necessary accommodations. The currently available error-state browser captures and promotional montage do not satisfy this gate.
