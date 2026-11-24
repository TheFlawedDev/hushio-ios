# Architecture decisions and implementation hold points

Baseline for source references: `2122110f9b41436723f368d3e1fb4d8a2a4276c2`.

## ADR-001 — Shared product, narrow platform conversion

Keep React/Zustand business rules, catalogue resolution, persistence payloads and identifiers shared. Introduce iOS beneath existing command/event contracts. `src/lib/bridge.ts` exports `Platform`, `detectPlatform`, native command wrappers and event listeners; it is a lead-owned interface. Extending the type requires auditing all Android/desktop checks individually, not a global rename.

## ADR-002 — Existing phone UI is authoritative

`src/App.tsx::App` selects `PhoneShell` only for Android and `shellFor(shortSide) === "phone"`. `src/lib/usePhone.ts` independently checks Android. A future host task must make both consistent for iOS and audit associated `htmlClasses`, insets, back handling and motion. Reuse `src/components/phone/PhoneShell.tsx`; do not design a new tab hierarchy. Existing phone screens must remain authoritative at baseline dimensions.

## ADR-003 — No playback-through-desktop fallback

`src-tauri/tauri-plugin-hushio-player/src/lib.rs::plugins` registers real native plugins only for Android; its non-Android branch registers an empty `hushio-player` plugin. This is **not an iOS playback implementation**. Do not report it as one, route iOS to desktop mpv subprocesses, or disguise rejected/missing commands as success. Native playback work requires source-identity/error/queue contracts and device verification.

## ADR-004 — Audit inherited mobile stubs

`src-tauri/src/mobile.rs` already contains mobile stubs for desktop tray/window/PiP/update commands. Their presence is baseline source behavior, not evidence of an iOS adapter. Classify desktop-only UI individually; iOS-facing updates or PiP controls cannot claim a working capability from `Ok(())` or idle responses. Record any intended disabled/unavailable state in feature matrix and design review.

## ADR-005 — Toolchain legal setup belongs to user

Use explicit `DEVELOPER_DIR` for local commands rather than altering the user's global Xcode selection. Do not accept Xcode agreements on the user's behalf. SDK inventory and actual target compilation must follow license/first-launch readiness. `rustc --print target-libdir --target aarch64-apple-ios` prints a *prospective* path even if target libraries are absent; this output is not proof a target is installed. The Homebrew rustlib directory currently contains only `aarch64-apple-darwin`.

## ADR-006 — Evidence vocabulary

- **Source extracted:** behavior traced in baseline code; not runtime tested on iOS.
- **Baseline passes:** existing frontend/macOS Rust tests passed; not iOS parity.
- **Browser reference:** real renderer screenshot with missing-native errors recorded; not device evidence.
- **Prototype host works:** only after an actual simulator/device launch of shared UI.
- **Core playback passes:** only after physical device transport, background and state-sync evidence.
- **Full parity:** only after complete matrix verification, design review and documented blocker disposition. Blockers never count as successful parity.

## Shared-interface coordination

Lead approval is required before changing `src/lib/bridge.ts`, playback event/payload types, native plugin registration, or shared persistence/storage formats. Implementation tasks may prepare proposals but must wait for source/design contract review. Each file group has one active owner; all current specialists are documentation-only.

---

## ADR-007 — Playback occurrence identity and background ownership on iOS

Status: **accepted** (step 3 of `REMAINING_SEQUENCE.md`). Resolves contracts **C-1/C-2**
(`BEHAVIOR_CONTRACTS.md` §P3 "Stale events" and §P6 "Background, native/shared ownership").
Decided before any `PlayerEngine` change, as required.

### Problem

The hardware baseline emits transport state with no source identity: `PlayerSnapshot` carries
`id`/`index` (which a same-ID `A → B → A` sequence cannot distinguish), `player-ended` carries
`{}`, and `player-error`'s `id` is not checked by the consumer. `androidEngine.applySnapshot`
accepts every snapshot and `player-ended` dispatches unconditionally, so a late event from a
replaced source can move the shared store. This is source defect **D03** on Android and it is
inherited, not created, by iOS.

### Decision 1 — Wire payloads stay compatible; additions are optional and additive

No existing field changes name, unit or meaning. Exactly one additive field is authorised:

| Event | Baseline payload | iOS payload | Compatibility |
|---|---|---|---|
| `player-state` | `{playing,buffering,positionMs,durationMs,index,id,speed,repeat,shuffle}` | identical | unchanged |
| `player-ended` | `{}` | `{id: string}` | additive; a consumer must treat a **missing** `id` as "unattributable" |
| `player-error` | `{index,id,code,message,recoverable}` | identical | unchanged |
| `player-stream-needed` | `{index,id,reason}` | identical | unchanged |
| `player-action`, `player-focus`, `player-route` | no source identity | unchanged | out of scope (media-button actions are user-initiated) |

Rationale: `player-ended {id}` is the only event whose staleness is unfixable without identity,
and §P3 explicitly permits "a protocol extension … documented with compatibility and tests".
Android keeps emitting `{}` — that is the documented legacy shape, not a divergence bug.

### Decision 2 — Staleness is filtered on both sides, with the JS guard platform-neutral

1. **Native (iOS) drops emissions from a replaced item.** The engine keeps a monotonic item
token per installed `AVPlayerItem`; snapshot/ended/error emissions carry that token internally
and are dropped when it is no longer current. This is invisible on the wire and covers
`A → B → A` inside one process.
2. **JS filters by identity when identity exists** (`src/lib/androidEngine.ts`):
   - `applySnapshot` ignores a snapshot whose non-null `id` differs from `currentId` unless
     `currentId` is `null` (startup adoption preserved); ignored snapshots must not update
     `last`, emit media events, or auto-pause.
   - `player-ended` dispatches only when the payload has no `id` (legacy) or the `id` matches
     `currentId`.
   - `player-error` toasts only when the `id` matches `currentId` or `currentId` is `null`.

   This is a shared-engine guard, so it also closes D03 on Android. It is guarded by tests and
   must not depend on iOS-only signals.

### Decision 3 — Background ownership: transport only, never queue semantics

Native (both mobile platforms) owns **transport for the single installed item**: start, pause,
seek, volume, speed, completion detection, audio-session interruption, route change, and the
sleep-timer deadline. Native MUST NOT:

- advance to another queue row, or synthesise `player-ended` on behalf of the queue;
- apply repeat / shuffle / smart-shuffle / autoplay rules;
- insert, remove, reorder or replace queue items on its own initiative;
- rewrite `id`/`index` semantics or invent a second queue.

Consequence, stated plainly: **with the WebView suspended, a track that finishes stays finished.**
The next row is not started until the shared engine resumes and sees `player-ended`. This matches
the Android singleton-queue reality (D02) rather than inventing native queue logic, and it means
iOS must not claim "background advance" parity. `player_next` / `player_previous`,
`player_set_repeat`, `player_set_shuffle`, `player_append`, `player_insert_next`,
`player_remove_at`, `player_move` therefore stay honest `not_supported` rejections until a future
ADR grants native queue ownership.

Sleep timer is allowed to pause (transport) because pausing cannot desynchronise the queue.

### Acceptance

- `src/lib/androidEngine.ts` guard tests: late snapshot for A after selecting B; `A → B → A`;
  unknown `player-ended` with a stale `id` must not advance.
- iOS emits `player-ended {id}`; a payload without `id` still ends playback (legacy).
- Reviewer can point at this ADR for every payload addition.

