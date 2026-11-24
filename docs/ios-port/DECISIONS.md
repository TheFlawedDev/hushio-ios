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
