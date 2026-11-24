# Hushio iPhone — reference views and capture ledger

Baseline source: `2122110f9b41436723f368d3e1fb4d8a2a4276c2`. Inventory/visual review: 2026-11-23. Designer owns this file and `DESIGN_SPEC.md` only. The designer did not create captures or modify the coordinator-owned evidence/script. Existing phone UI remains authoritative; this is not a screenshot-derived redesign.

## 1. Evidence classes and honest coverage

- **P — existing promotional image:** actual repository JPEG, visually opened; capture device/version/theme/settings provenance not recorded. Useful illustration, not a fresh baseline render or pixel-perfect acceptance image.
- **B — browser observation:** actual PNG + JSON produced by coordinator tooling from the baseline renderer, Android user agent selecting its real phone shell. Native Tauri bridge absent. Useful shell/empty/error evidence, **not** Android-device/iPhone runtime success.
- **N — native baseline capture:** none verified in this review.
- **I — iPhone capture:** none verified in this review.
- **S — source contract only:** inspected source/test; **not visual review** and never a substitute for a screenshot/gesture recording.

The designer opened both JPEGs and all 12 listed browser PNGs using the image reader. Source extraction and visual inspection are explicitly separate activities. No generated mockups, synthetic catalogue data, reconstructed screenshots or hidden native-error success captures are supplied.

## 2. Actual artifact inventory

### 2.1 Baseline-tracked screenshots

| Artifact | Actual dimensions | Visually reviewed content | Limits |
|---|---|---|---|
| [`.github/assets/phone.jpg`](../../.github/assets/phone.jpg) | 1800×936 raster | Four-panel light-looking phone montage: Home with quick tiles/featured/shelf + mini/dock; album The Arijit Singh Collection with art/header/actions/filter/numbered rows + mini/dock; Now playing with cover/title/seek/transport; lyrics with small track header and active/falloff lines. | P. Assembled presentation with rounded frames, no live OS status/home indicators; individual viewport/DPR unknown. Second panel is **album**, not evidence of local-playlist editing. No dark theme, actual transitions, queue, search results, artist, downloads/local/settings or keyboard. README labels image Android; exact native capture build/device/date not established. |
| [`.github/assets/desktop.jpg`](../../.github/assets/desktop.jpg) | 1920×1080 raster | Light-looking desktop Home, library sidebar, top search/window chrome, right Now playing/queue rail, bottom player. | P. Shared branding/type/artwork illustration and desktop→phone comparison only; rail/sidebar must not become iPhone navigation. Cannot independently establish phone dimensions or any iOS behavior. |

Visually observable agreement with source: phone montage uses four dock items, circular mini art, centered album art/action row, full player repeat-left/shuffle-right, and an embedded lyric presentation. Source in `PhoneShell`, `PhoneHeader`, `PhoneNowPlaying`, `SyncedLyrics` supplies measurements and behavior; the montage does not prove those exact metrics or all current defaults.

### 2.2 Coordinator browser evidence

Directory: [`evidence/browser-baseline/`](evidence/browser-baseline/). Each PNG has a same-stem JSON sidecar containing body text/page errors. [`capture.py`](evidence/browser-baseline/capture.py) records the actual procedure. These are newly collected observations against unchanged baseline source, not baseline-tracked screenshots.

Shared setup from script: Chromium headless, `is_mobile=True`, touch enabled, device scale factor2, **Android14 UA**, `reduced_motion='reduce'`; requested dark at375×812 CSS pixels and light at430×932. Fresh context per size/theme; native bridge intentionally **not mocked**. Initial navigation waits `networkidle`; later screens are selected through actual `useNavigation.navigate({name})`, then600ms wait. Screenshots use `full_page=True`; root is fixed viewport with inner scrollers, so this does **not** expand/record all inner list content.

| Screen/state actually present | Compact dark PNG (750×1624 raster) | Large light PNG (860×1864 raster) | Visual review and qualification |
|---|---|---|---|
| Home initial loading/failure environment | [`compact-dark-initial.png`](evidence/browser-baseline/compact-dark-initial.png) | [`large-light-initial.png`](evidence/browser-baseline/large-light-initial.png) | Wash skeleton, persistent four-tab dock, stacked native-error toasts across header. Not populated Home, not successful catalogue load, not stable final Home empty/error after settling. |
| Search idle | [`compact-dark-search.png`](evidence/browser-baseline/compact-dark-search.png) | [`large-light-search.png`](evidence/browser-baseline/large-light-search.png) | Sticky search field + Online/On device chips, empty body, selected Search dock item. Header obscured by inherited startup toasts. No keyboard/suggestions/results. |
| Library fresh/default grid | [`compact-dark-library.png`](evidence/browser-baseline/compact-dark-library.png) | [`large-light-library.png`](evidence/browser-baseline/large-light-library.png) | Two-column Liked/Downloads/History/Local/Import tiles; Liked accent, fallback glyphs, pin/subtitles, Library dock selected. Header obscured; lower playlist section not fully represented. No saved playlists/artwork/list variant. |
| Downloads empty | [`compact-dark-downloads.png`](evidence/browser-baseline/compact-dark-downloads.png) | [`large-light-downloads.png`](evidence/browser-baseline/large-light-downloads.png) | Fallback tile, Downloads/Nothing saved yet, dim Play/Shuffle, No downloads yet/Find songs. Native-error stack remains at top. No download progress/completed/failed rows. |
| Local music empty | [`compact-dark-local.png`](evidence/browser-baseline/compact-dark-local.png) | [`large-light-local.png`](evidence/browser-baseline/large-light-local.png) | Play your own files, folder glyph, Choose a folder. Header obscured by native-error toasts. No picker or successfully imported library. |
| Settings guest root | [`compact-dark-settings.png`](evidence/browser-baseline/compact-dark-settings.png) | [`large-light-settings.png`](evidence/browser-baseline/large-light-settings.png) | Search settings, guest account/Downloads inset group and grouped category rows. About partially behind dock at compact viewport, reachable by inner scrolling in source (not demonstrated by image). Root header obscured. No category controls/search/keyboard/sign-in verification. |

Observed errors include `Cannot read properties of undefined (reading 'invoke')`, `'transformCallback'`, `'metadata'`, and Couldn't load your local music. `compact-dark-initial.json` explicitly states `nativeBridge: absent; no mock/native success responses or fabricated data`. These images must retain that qualification wherever reused. Their error toast opacity/shadows are a legitimate observation of failed host startup, not intended permanent page decoration.

Coverage is **paired compact-dark + large-light only**, not the full 2 sizes ×2 themes matrix. All are reduced motion with no mini/player. They cannot verify normal motion, phone safe areas, native permissions, sign-in, downloads, playback, accessibility, backgrounding or physical-device fidelity.

### 2.3 Other actual visual assets (not app-screen evidence)

Repository raster scan excluding `.git` and `node_modules` also found:

- `src-tauri/app-icon-1024.png` (1024×1024), `src-tauri/icons/*.png` (desktop/platform icon sizes).
- `src-tauri/icons/ios/AppIcon-*.png` (existing app icon renditions, **not evidence of a working iOS target**).
- `src-tauri/icons/android/mipmap-*/ic_launcher*.png` and `src-tauri/gen/android/app/src/main/res/mipmap-*/ic_launcher*.png` (launcher icons).
- SVG assets: `public/hushio.svg`, `src/assets/hushio.svg`, plus starter `react.svg`/`tauri.svg`/`vite.svg`. Existing `AppLogo` remains authoritative branding; starter logos are not replacement product icons.

These icon assets were inventoried by paths, not visually reviewed as screen references. No repository app-state video/GIF was found in this scan. Library covers and catalogue art in screenshots are content, not a new bundled screenshot fixture. Dependencies' images are not reference captures.

## 3. Required reference-view ledger

**Every required view still needs an N/I matched pair.** P/B below are partial existing evidence, not acceptance completion. For every row capture light+dark, compact+large, populated and applicable loading/empty/error states; normal+Reduce Motion for animated/gesture surfaces. Exact states/geometry are binding in `DESIGN_SPEC.md`.

| ID / required view | Evidence now | Reproducible native-baseline navigation and state preparation | Uncaptured / blockers | Source and test anchors |
|---|---|---|---|---|
| R01 Home | P phone panel1 + B initial both presets | Launch real baseline Android phone shell; Home. Play/open real music to populate recents; return Home, wait actual feed completion. Capture with and without mini; scroll to shelf/footer, pull refresh. Record market/time/greeting. | Fresh populated native feed, stable loading→content/error, offline/retry, both font defaults, safe areas, light/dark pair at both sizes. Browser native bridge absent, initial feed did not resolve in captured state. | `src/views/HomeView.tsx::{HomeView,PhoneSkeleton}`, `HomeView.phone.test.tsx`, `phone/PhoneShelf.tsx` |
| R02 Search | B idle both | Tap Search; capture empty idle; perform actual query and wait≥300ms debounce + actual network completion. Capture suggestions with keyboard, top result, songs/albums/artists/playlists filters, pagination, clear/no results; On device after real local import, Add-ons only configured. | All populated/suggestion/keyboard/loading/retry/scoped states; browser idle does not prove search backend works. Live service/add-on availability is an explicit prerequisite, not fabricated results. | `src/views/SearchView.tsx`, `SearchView.phone.test.tsx`, `phone/PhoneSearchField.tsx` |
| R03 Library | B default/fresh grid both | Tap Library. Capture fresh grid, then create a real named playlist via Create/New playlist; add real songs, create folder/pin; switch grid/list, reopen to verify setting. Save real album for Albums section. | Header unobscured, populated grid/list, first-cover/collage/pin, long hold menu and no-mini/mini variants. Missing native persistence in browser. | `src/views/LibraryView.tsx`, `LibraryView.phone.test.tsx`, `phone/PhoneLibraryRows.tsx` |
| R04 Playlist | S only; P album must not count | Library → New playlist → name → add songs via finder/search menu. Open local playlist; capture hero, description/edit sheet,≥8-song filter, normal and reorder state; remote-linked playlist separately. Also open genuine remote catalogue playlist from Search/Home. | All fresh local/remote playlist screenshots, editing/cover-picker/empty/missing/filter/menu states and drag video. Actual library/remote service needed. | `src/views/{PlaylistView,RemotePlaylistView}.tsx`, `PlaylistView.test.tsx`, `RemotePlaylistView.phone.test.tsx`, `components/PlaylistEditDialog.tsx` |
| R05 Album | P phone panel2 | Search → Albums → actual album; record browse ID/title/art/year/tracks. Capture centered/tinted header, save selected/unselected, filter≥8, numbered/current rows, release notes and More by artist; enter error through real offline/retry scenario. | No fresh baseline render, no dark album/tint/no-art/loading/error capture, no iPhone safe-area band. Promotional album identity need not remain available; do not hardcode its catalogue data. | `src/views/AlbumView.tsx`, `AlbumView.test.tsx`, `components/phone/PhoneHeader.tsx` |
| R06 Artist | S only | Search → Artists → real artist; capture round144 portrait, stats, Play/Shuffle/menu, Popular, About, liked songs collapsed/expanded, shelves/discography. Follow then show selected menu state. | Every screenshot/scroll/state; service data and artist image must genuinely resolve. | `src/views/ArtistView.tsx::{ArtistContent,LikedByArtist}`, `ArtistView.test.tsx` |
| R07 Downloads | B empty both | Library/Settings → Downloads, empty. Start real supported song download via menu/player; capture queued,downloading N%,waiting Wi-Fi,failed/retry,cancel,done; play downloaded while offline. Use actual transport/network conditions for failure, not edited state. | All populated/progress/error native and offline proof. Need native writable storage/download events; browser lacks them. | `src/views/DownloadsView.tsx::{DownloadRow,statusLine}`, `DownloadsView.test.tsx`, `components/motion/DownloadRing.tsx` |
| R08 Local music | B empty both | Library → Local music → Choose a folder; use user-approved folder with real audio/art/tags, cancel once, then import. Capture scan,index,On this device,Songs/Albums/Artists/Folder path/search/source filters; Opened files and actual network server only if configured. | Native picker/permission/sandbox behavior, populated/music-missing/search/no-results and network failure. User-approved files/server credentials needed; don't assume access to personal Music directory. | `src/views/LocalMusicView.tsx::{LocalMusicView,IndexView,CollectionView,NetworkCollectionView}`, `LocalMusicView.test.tsx` |
| R09 Settings | B guest root both | Profile and settings (not a new tab). Capture root; open each category, search match/no match, switch theme/app font/reduce animation; sliders/radios/EQ + preset menu; auth unconfigured/wait/cancel only from actual state. Capture nested home-sections/network/add-on/crash-log pages. | Category rows/control states, larger text, keyboard, signed-in/sync states, iOS capability filtering. Credentials/pickers/updates must be genuine; browser cannot prove success. | `src/views/SettingsView.tsx`, `settings/{categories,SettingsLayout}.tsx`, `SettingsPhone.test.tsx`, `SettingsLayout.phone.test.tsx` |
| R10 Queue | S only; desktop rail is not phone queue | Play≥3 real tracks; mini→Now Playing→Queue. Capture modes,Now playing/source,Up next,previous collapsed/expanded,autoplay tail,empty future; drag ordinary future via grip and swipe remove/Undo. | All phone queue screenshot/video, tint transparency, scroll boundary and reorder accessibility evidence. Playback/queue needed; don't use desktop rail as substitute. | `components/phone/PhoneQueueSheet.tsx::PhoneQueueList`, `PhoneQueueSheet.test.tsx` |
| R11 Now playing | P phone panel3 | Play actual track; tap/pull mini to full player; capture playing/paused/buffering,no artwork/known artwork,long title,unknown duration,liked/unliked,repeat/shuffle,download states. Record opening/closing/interrupted-close and horizontal art swipe. | Fresh player at both sizes/themes, safe areas, short-height/landscape, seek interaction and physical playback. Browser captures have no track. | `components/phone/{MiniPlayer,PhoneNowPlaying,ArtCarousel,sheetTravel}.tsx/ts`, `PhoneNowPlaying.test.tsx`, `MiniPlayer.test.tsx`, `PhoneShell.test.tsx` |
| R12 Lyrics | P phone panel4 | Actual track with timed lyrics → mini/full player → Lyrics or upward swipe. Record track/source/position/offset. Capture active/inactive lines,seek-on-line,manual scroll/refollow,word-synced/translation/romanization where supplied; plain text/no lyrics/custom reset separately. | Fresh synced/plain/loading/unavailable/RTL/translation, font/text-size/blur preference behaviors, reduce-motion video. Need real timed lyrics; do not invent provider response. | `components/phone/PhoneLyrics.tsx`, `components/SyncedLyrics.tsx`, `SyncedLyrics.phone.test.tsx`, `PhoneLyrics.test.tsx` |

Paths beginning `components/` in this table are under `src/`; tests are adjacent to the named component/view unless otherwise specified. Routes/stores are source anchors, not URL routes; app does not expose these views through arbitrary made-up URL paths.

### Additional existing surfaces (not optional feature removal)

Capture Hotlist (`ChartsView`, `charts`), Liked Songs (`library:liked`), folders, History, discography, New releases, Daylist, Replay stories/share, Import & export/matching/results, Song info, menus/submenus, new/rename/delete dialogs, Add to playlists popup, Edit playlist sheet, EQ/preset editing, account/sync/scrobbling forms and permission banners. `CurrentView.tsx` and the `DESIGN_SPEC.md` per-screen table identify their actual mappings. No N/I captures yet. Onboarding/LaunchIntro exist but current SessionGate does not mount them; do not stage a new entry flow just to produce a screenshot.

## 4. Reproduction of existing browser observations

This does **not** resolve the native blockers or expand the limited six-view coverage.

1. Confirm `git rev-parse HEAD` is the baseline above and source is unchanged; preserve others' worktree differences. Use existing installed dependencies; no installation/update.
2. Run renderer in a normal command session (no agent terminal manipulation):

   ```sh
   pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort
   ```

3. Existing Python Playwright is associated with Command Line Tools Python, **not** the `python3` selected on this designer's PATH. The latter import failed `ModuleNotFoundError: playwright`. Read-only verification using `/Library/Developer/CommandLineTools/usr/bin/python3` successfully found Playwright and installed the Chromium executable into the user-level Playwright cache (chromium-1223). WebKit and Firefox cache executables were absent. No dependency/browser install was attempted.
4. Coordinator's existing script is reproducible with:

   ```sh
   /Library/Developer/CommandLineTools/usr/bin/python3 docs/ios-port/evidence/browser-baseline/capture.py
   ```

   **This overwrites its evidence files. Only the evidence owner should run it there.** To collect a separate run, use an owner-approved copy/output location and preserve the original images/JSON. Designer did not execute this capture script.
5. Script uses Android UA because `src/lib/bridge.ts::detectPlatform`, `App.tsx`, and `usePhone.ts` only select phone mode for Android+shortSide<840. Shrinking a desktop browser alone is not equivalent. Do not label these captures Safari/WKWebView/iOS merely because the viewport dimensions are iPhone-sized.
6. Retain native failures and log them. Do not inject fake `__TAURI_INTERNALS__` responses, fabricated songs, placeholder success, or claim the resulting data are native. The B artifacts are intentionally failure-environment observations. For new pure component-test screenshots, label any test fixtures explicitly and keep them separate from real-service/native acceptance evidence.

The installed macOS apps `/Applications/Hushio (Local Build).app` and `/Applications/Hushio.app` were observed in directory inventory, not launched or visually reviewed by the designer. Their presence does not establish baseline commit or phone/iPhone behavior. No claim is made that Android SDK, connected device, Xcode signing or iOS target was validated by this role.

## 5. Native reference and iPhone comparison protocol

### 5.1 Controlled state, not fabricated state

- Baseline: run actual Android phone application from pinned source with supported toolchain/device (`pnpm tauri android dev`, per CONTRIBUTING); record the runtime/build and dimensions. Don't reset a user's library. Use an isolated approved test profile and real files/catalogue results; record stable IDs and nonsecret fixture provenance. Do not place tokens, account emails, personal file paths or credentials in public screenshots/logs.
- iPhone: run integrated port on simulator then physical iPhone using build/release owner's instructions; record port commit and adapter status. A simulator picture is not background audio, haptics or device acceptance.
- Use same theme,font,settings,market,locale,content/IDs,queue,index,paused position,library state and scroll position in both. Time-of-day greetings and live recommendations may differ; record that, don't silently paint replacements.
- Source defaults currently: System theme/font; Android System font resolves Inter + Instrument titles; library grid; synced/blur lyrics on, romanization off; animated covers on/data saver off; Reduce animation off (`settings.ts`, `fonts.ts`). Resolve DESIGN_SPEC U1 before comparing iOS font metrics; never call SF vs Inter unexplained drift a layout pass.

### 5.2 Minimum capture matrix (A: verification accommodations)

| Axis | Required set |
|---|---|
| Logical phone size |375×812 and430×932 for comparison with current B presets; additionally short-height375×667 stress case and actual user's physical iPhone viewport. These are **proposed QA viewports**, not claims about connected hardware. |
| Theme | Light and dark at **each** size; System follows actual OS switch. Include tinted hero/player and no-art fallback. |
| Motion | Normal screenshots + gesture recordings; Reduce Motion on then off while app visible. Reduced still must expose all controls/states and preserve state transitions without automated spatial motion. |
| Insets | Portrait notch/Dynamic Island and home indicator; landscape left/right obstruction; no fabricated OS bars. Record both host and CSS inset values/viewport metrics. |
| Keyboard | Search empty→typed→suggestions/results, settings filter, playlist name/description, paste import, server/account/preset dialogs; active field and action reachable, cancel/submit restores scroll/focus. |
| Accessibility | VoiceOver focus/reading/modal boundaries/adjustable seek, text enlargement, RTL/long text, target overlap, high-contrast legibility/reduced transparency. Record exact settings and defects; screenshots alone cannot verify spoken interaction. |
| Content states | Initial/loading, populated, empty, network/error/retry, offline cached/downloaded, selected/liked/pinned, disabled, progress,cancelled/permission denied. Only demand states applicable to actual component; no new generic offline screen invented. |

### 5.3 Capture steps and file manifest for the next owner

For each R01…R12 and auxiliary surface:

1. Prepare real native state using §3 navigation. Wait for explicit loading completion for populated capture; separately capture actual loading/error states. Keep a short video when timing/gestures matter.
2. Record on-device screenshot using approved device/simulator tooling. Example, for an already booted simulator: `xcrun simctl io booted screenshot <approved-output>.png`; screenshot does not imply app launch/install succeeded. Physical iPhone screenshots/recording require device access and user approval as needed.
3. Store evidence under an owner-approved run directory with names such as `R11-now-playing-375x812-dark-paused-normal.png`, not a filename claiming “verified” before review. Record logical viewport and raster dimensions/DPR independently.
4. Sidecar metadata minimum: source commit, port commit, build/OS/device or browser/engine, origin(N/I/B/P), requested and resolved theme/font, OS/app motion settings, dimensions/DPR/insets, route/param,content IDs/nonsecret provenance, player state/position,settings,scroll,keyboard,network/permissions,steps,errors,timestamp,capture owner,visual reviewer. Hash artifacts if frozen for comparison. Never log auth secrets.
5. Compare matched native baseline/iPhone images at1 logical px scale: surface token values, gutter/radii/border/shadow, title and metadata baselines/truncation, artwork crop/shape, glyph weight/size, control order/targets, status/home safe zones and dock occlusion. Record pixel differences with cause, not a guessed universal tolerance. System glyph rendering/font policy must be explicitly distinguished from layout regressions.
6. Review video: gesture arbitration/cancel, mini→cover handoff, sheet spring endpoints, horizontal artwork skip, lyrics→queue exclusivity, row swipe/reorder/Undo, scroll handoff, pull refresh, background interruption during close. Static screenshots do not establish motion parity.
7. Log pass/fail, baseline defect versus regression, relevant source/test, accommodation ID from DESIGN_SPEC, reviewer decision and unresolved blockers. Do not mark Rxx complete if only S/P/B evidence exists.

## 6. Current blockers and unresolved visual questions

1. **No N/I evidence.** Browser native `invoke/metadata/transformCallback` failures obstruct titles and block persistence/local loading/playback; cannot certify populated Home or required player/catalogue states. Need real native run, not mocks. Existing P montage fills illustration gaps only.
2. **No normal-motion reference video.** Current B captures explicitly Reduce Motion; neither P nor B proves easing, threshold, cancellation, haptic timing, sheet/scroll arbitration or paused-cover transition. Source/tests in DESIGN_SPEC are contracts pending video/device review.
3. **iOS host layout unverified.** Phone mode is Android-gated; viewport-fit/safe areas/status bar/keyboard/landscape and WKWebView feature support need A1…A8 and device evidence. Current Chromium cannot substitute for missing installed Playwright WebKit or a physical iPhone.
4. **Font/lyrics preferences unresolved.** DESIGN_SPEC U1/U3: Android versus iOS System font, fixed phone lyric sizing/blur behavior, full-bleed preference effect, theme-switch palette refresh. These are baseline/port decisions, not grounds for unrequested redesign.
5. **Settings capabilities/auth/files.** iOS adapters and optional credentials are outside designer ownership; truthful configured/unconfigured/denied/failure states must be captured before asserting parity. Do not click destructive reset/erase or real account changes just for evidence without an approved disposable profile.
6. **Accessibility not visually provable.** Modal `aria-modal` is not VoiceOver isolation, named drag grip is not accessible reordering, fixed pixel text is not Dynamic Type. U4/A7 need actual testing.

**Minimum safe handoff:** preserve the phone React design verbatim first; supply real iOS phone detection/safe areas/keyboard behavior, retain control order/tokens/fonts, map only necessary OS presentations, and document every deviation against `DESIGN_SPEC.md`. Required visual/behavioral acceptance remains open until matched native and physical-iPhone evidence exists.
