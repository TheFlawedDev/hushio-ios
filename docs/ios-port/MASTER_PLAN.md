# Hushio iPhone Port — Master Plan and Agent Execution Prompt

## 1. Objective and source of truth

Port the existing Hushio application to iPhone while retaining its existing features, business logic, visual identity, and interaction behavior. Reuse the React/TypeScript interface and Rust backend wherever possible. Write new native code only where iOS requires a different platform implementation.

This is a conversion project. Agents must not invent features, redesign workflows, replace algorithms, or reconstruct functionality from screenshots when working source code already exists.

### Repository and starting state

- Upstream: https://github.com/Nexvyn/hushio
- Local clone: a local checkout of the upstream repository (path redacted)
- Inspected baseline commit: `2122110f9b41436723f368d3e1fb4d8a2a4276c2`
- Existing application: React/TypeScript, Zustand state, Rust backend, Tauri 2.
- Existing mobile implementation: Android phone layouts and Kotlin native services.
- Existing macOS build: `/Applications/Hushio (Local Build).app`
- Xcode.app is present, but the active developer directory currently points to Command Line Tools. Full Xcode setup and installed iOS SDKs must be verified.
- Existing worktree differences: deleted mpv `.gitkeep` and an untracked generated plugin permission reference. Preserve these; do not silently reset or commit them.

Create the iOS work in an isolated Git worktree on `port/ios`. Keep the baseline checkout available for comparison. A local branch/worktree is sufficient to begin; creating or publishing a GitHub fork is a separate external action.

### Definition of success

A development-signed application runs on the user’s physical iPhone, retains the existing Hushio appearance at phone dimensions, and passes documented behavior comparisons against the original code.

Completion requires an evidence-backed feature matrix. Every existing feature must be either:

1. Implemented and verified on iOS.
2. Inapplicable because it is specific to another operating system.
3. Blocked by a documented iOS, entitlement, credential, or source-service limitation.

A blocker is not successful parity. No feature may disappear silently or be represented by a nonfunctional control.

## 2. Agent organization and operating rules

The Senior Lead Engineer coordinates the following roles. These are responsibilities, not a requirement to run every agent simultaneously. With four concurrent slots, use the lead plus up to three active specialists.

| Agent | Responsibility | Required output |
|---|---|---|
| **Senior Lead Engineer / Port Coordinator** | Own architecture, scheduling, integration, decisions, and acceptance gates | Master progress record, integration branch, decision log |
| **Source Logic and Feature Archaeologist** | Extract existing behavior and trace UI → state → services → native implementation | Source atlas, feature matrix, behavior contracts |
| **Principal App Designer / Design Custodian** | Extract the existing visual system and define faithful iPhone adaptations | Binding design document and reference screenshot inventory |
| **Senior Tauri and Rust Platform Engineer** | Establish the iOS target and make existing Rust/backend capabilities compile and run | Buildable iOS shell and platform capability adapters |
| **Senior iOS Media Engineer** | Convert existing playback/native media behavior to iOS APIs | Native playback adapter, lifecycle handling, media controls |
| **Senior iOS Services Engineer** | Port filesystem, secure storage, authentication, network, and other native services | Source-traced iOS service adapters |
| **Senior React Port Engineer** | Reuse the existing phone interface and connect iOS platform behavior | Functional iPhone UI using existing components |
| **QA and Behavioral Parity Engineer** | Verify behavior, regressions, physical-device operation, and visual fidelity | Test matrix, evidence, defect reports |
| **Build and Release Engineer** | Own reproducible builds, signing instructions, installation, and handoff | Build/run instructions and device installation evidence |

The Principal App Designer may delegate to:

- **Visual System Extraction Agent:** inventory tokens, fonts, icons, spacing, surfaces, artwork, and motion.
- **iPhone Layout Adaptation Agent:** document safe areas, keyboard interaction, screen dimensions, and existing phone navigation.
- **Visual Fidelity Reviewer:** compare implementation screenshots with the design document and baseline.

These subagents must follow the Principal App Designer’s document. They cannot establish independent styles or redesign screens.

### Mandatory rules for every implementation agent

- Read the source atlas, design document, and assigned behavior contracts before editing.
- Cite baseline commit, source file, symbol, and relevant tests for each behavior being ported.
- Distinguish business logic from platform plumbing. Keep business logic shared; translate OS integrations.
- If existing implementations disagree, record the difference. Use existing phone behavior for phone interactions and shared code for shared business rules; escalate unresolved contradictions to the lead.
- Preserve data formats, identifiers, event meanings, error behavior, ordering, units, cancellation, and retry rules unless an explicit platform constraint requires an adaptation.
- Do not invent missing behavior. Mark it unresolved and continue independent work.
- Do not use placeholder success responses, fabricated catalogue data, or silent no-op adapters to claim completion.
- Avoid dependency upgrades and broad refactors unrelated to the port.
- Report changed behavior, source references, tests, and remaining gaps with every handoff.
- Assign each file group to one active owner. Changes to shared interfaces require coordination through the lead.

## 3. Source extraction and design documentation

Before feature implementation, create a `docs/ios-port/` documentation set in the implementation worktree.

### Source atlas and feature matrix

The Source Logic and Feature Archaeologist must inventory actual code, not just README claims.

Initial navigation points include:

- `src/views`, `src/components`, and `src/components/phone`: screens and interactions.
- `src/stores`: state, persistence boundaries, navigation, library, and playback decisions.
- `src/lib`: audio orchestration, stream resolution, imports, lyrics, downloads, platform bridge, gestures, and presentation helpers.
- `src-tauri/src`: backend commands, persistence, streaming, downloads, local-library behavior, accounts, and network sources.
- The existing Android player plugin: native mobile playback, authentication, permissions, media storage, and background services.

For each feature, record:

| Required field | Meaning |
|---|---|
| Feature and entry point | How a user reaches it |
| Source references | Commit, files, symbols, and existing tests |
| Behavior contract | Inputs, outputs, state transitions, errors, side effects |
| Shared implementation | Code that should remain in use |
| Platform dependency | Android/desktop APIs requiring conversion |
| iOS mapping | Adapter responsibility and verified platform constraints |
| Acceptance scenario | Observable proof of equivalent behavior |
| Status and owner | Implemented, pending, blocked, or inapplicable |

Inventory all existing functionality, including discovery, search, library, playlists, queue, playback, lyrics, imports/exports, downloads, local files, network sources, accounts, sync, settings, accessibility, and optional integrations. Extend this inventory whenever code reveals additional behavior.

Separate source defects from port regressions. Record baseline failures instead of silently rewriting their behavior.

### Binding design document

The Principal App Designer must produce `DESIGN_SPEC.md` from the existing code and captured reference views.

The repository already has a phone shell, tab bar, mini player, full player, sheets, gestures, and phone-specific tests. Reuse these as the starting layout rather than creating a new iPhone design from the desktop screen.

Document:

- Existing color and semantic tokens, light/dark themes, fonts, typography, spacing, radii, borders, shadows, and artwork treatments.
- Existing Phosphor icon conventions, including phone sizing and selected states.
- Component anatomy for navigation, track rows, cards, forms, dialogs, sheets, menus, player controls, and notifications.
- Existing motion curves, timings, gesture behavior, and Reduce Motion handling.
- Per-screen mapping from desktop and existing Android phone layouts to iPhone.
- Safe-area, notch/Dynamic Island, home-indicator, keyboard, orientation, and scrolling adaptations.
- Loading, empty, error, selected, disabled, and offline states.
- Accessibility labels, focus, contrast, and touch-target expectations.

Every design rule must reference an existing token/component or be explicitly labeled an iOS layout accommodation. Screenshots illustrate the rules; source tokens remain authoritative.

Required reference coverage: home, search, library, playlist, album, artist, downloads, local music, settings, queue, now playing, and lyrics.

No new branding, replacement icon family, alternate color palette, or new navigation hierarchy.

## 4. Implementation phases and gates

### Phase A — Preserve baseline and establish contracts

Owners: Lead, Source Archaeologist, Design Custodian.

1. Record repository status, baseline commit, tool versions, and existing test results.
2. Create the isolated worktree without resetting existing files.
3. Produce the source atlas, feature matrix, design specification, and initial blocker register.
4. Define the smallest existing playback flow to use as an end-to-end proving case.

**Gate:** All identified features have source references and an owner; UI and native implementation agents have agreed contracts.

### Phase B — Establish a functioning iOS host

Owner: Tauri and Rust Platform Engineer.

1. Verify full Xcode initialization, iOS SDKs, simulator runtimes, Rust iOS targets, and Tauri prerequisites.
2. Generate and configure the iOS project using the repository’s Tauri version.
3. Use a distinct development bundle identifier selected with the signing setup.
4. Audit Rust dependencies and conditional compilation for iOS compatibility.
5. Prevent desktop-only tray, window, updater, and external mpv-process paths from initializing on iOS.
6. Add iOS platform detection and route the application to the existing phone shell.
7. Preserve existing macOS and Android paths.

**Gate:** App launches in the simulator and shows the actual shared phone interface, with no startup failures from unavailable native capabilities.

### Phase C — Convert native playback

Owner: iOS Media Engineer, supported by Source Archaeologist.

Use existing mobile playback command/event contracts as the primary integration boundary. Reuse existing queue decisions, stream resolution, quality choices, retry behavior, metadata handling, and store logic.

Implement iOS equivalents for native responsibilities:

- Source loading, play/pause, seek, duration, position, completion, and errors.
- Background audio and audio-session lifecycle.
- Lock-screen metadata and transport commands.
- Audio interruptions, route changes, headphones, and Bluetooth.
- Queue transitions and native/shared-state synchronization.
- Existing speed, volume, equalizer, crossfade, and silence-related behavior where present in the source.

Begin with AVFoundation for native playback, then validate each advanced capability against the extracted contract. Do not assume a basic AVPlayer implementation provides full parity. Any requirement needing additional native audio processing gets a source-backed implementation proposal and test before integration.

The design must account for WebView suspension: continued background playback cannot depend on JavaScript timers remaining active. Translate necessary existing mobile-native ownership into iOS while preserving its behavior.

First prove local or controlled test-audio playback. Then connect the existing source-resolution pipeline and verify actual supported formats and request behavior.

**Gate:** Physical iPhone plays, pauses, seeks, advances, and reports state correctly in foreground and background. Late events from replaced sources cannot corrupt current playback state.

### Phase D — Convert remaining platform services

Owner: iOS Services Engineer with Tauri/Rust Engineer.

Reuse the Rust or TypeScript implementation wherever it runs unchanged. Add iOS adapters for:

- User-selected files and directories, sandbox access, import/export, artwork, and downloads.
- Secure credential storage and existing authentication redirect flows.
- Notifications, clipboard, haptics, sharing, and network-state reporting.
- Existing network music sources and optional integrations.
- Background work within actual iOS capabilities.

Preserve existing storage schemas and identifiers. Translate external file access into iOS-appropriate references; do not assume desktop paths or Android content URIs work on iPhone.

Document desktop-only and Android-only integrations individually. Do not invent substitutes such as a new CarPlay feature merely because Android Auto exists.

Missing API credentials remain explicit configuration blockers. Do not fake successful sign-in or sync.

**Gate:** Every service has a verified adapter or a documented limitation. Unsupported controls clearly communicate their status.

### Phase E — Complete iPhone UI adaptation

Owner: React Port Engineer, reviewed by Design Custodian.

1. Connect the existing phone components to iOS capabilities.
2. Audit Android-specific checks individually rather than globally replacing “Android” with “mobile.”
3. Apply safe-area, keyboard, viewport, scrolling, and touch adjustments from the design document.
4. Retain existing screens, actions, copy, visual tokens, and interaction patterns.
5. Verify all settings accurately reflect implemented iOS capabilities.

**Gate:** Design review passes at compact and large iPhone dimensions, with light/dark themes and Reduce Motion.

### Phase F — Parity verification and installation

Owners: QA, Build/Release, Lead.

Run the repository’s frontend type checking/tests and applicable Rust checks. Add meaningful adapter and behavior tests, then perform simulator and physical-device validation.

Install through Xcode development signing using the user’s Apple Account. Account authentication, device trust, and any required developer settings remain user-operated steps.

Provide:

- Reproducible build/install instructions.
- Commit and dependency versions.
- Test and screenshot evidence.
- Final feature-parity matrix.
- Known limitations and unresolved blockers.
- Instructions for refreshing an expiring development build.
- A concise maintenance guide for incorporating upstream changes.

App Store submission and public distribution are outside this implementation. They must not drive unrequested feature removal.

## 5. Interfaces, verification, and acceptance standards

### Interface strategy

- Extend existing platform types to represent iOS where necessary.
- Preserve existing frontend/backend command payloads and event meanings whenever possible.
- Reuse the mobile playback bridge; add a separate iOS native implementation beneath it.
- Keep shared stores, navigation, catalogue logic, playlist operations, and persistence schemas authoritative.
- Document any unavoidable interface change with its source contract, compatibility impact, and tests.
- Keep iOS integration changes narrow so upstream updates remain practical.

### Required test scenarios

| Area | Scenarios |
|---|---|
| Startup | Fresh install, relaunch, persisted settings/library |
| Discovery | Search results, pagination, error and retry behavior |
| Playback | Play/pause, seek, skip, repeat/shuffle, queue edits, rapid track replacement |
| Background | Lock screen, app switching, interruptions, route changes, resume |
| Media failures | Expired URL, unavailable source, lost network, unsupported format |
| Library | Likes, playlist changes, imports/exports, persistence |
| Files/downloads | Selected files, permission denial, cancellation, partial failure, offline playback |
| Accounts | Unconfigured state, cancel, success where credentials exist, disconnect |
| UI | Compact/large iPhones, keyboard, safe areas, themes, scrolling, sheets, gestures |
| Accessibility | VoiceOver, labels, focus, readable text, Reduce Motion |
| Regression | Existing desktop/Android tests and relevant builds remain healthy |

A simulator pass does not establish background audio or device integration correctness. Physical-device testing is mandatory.

### Completion rules

- Each completed feature includes source references and verification evidence.
- Shared logic changes require an explanation of why platform adaptation could not be isolated.
- All visual changes receive Design Custodian review.
- All native changes receive platform/media review appropriate to their responsibility.
- The lead must distinguish “prototype works,” “core flows pass,” and “full parity achieved.” These are separate milestones.

### Defaults and assumptions

- Target iPhone first; no new iPad layout or unrelated product features.
- Preserve all existing product behavior as the parity target, subject to documented platform constraints.
- Use current Tauri-compatible iOS deployment defaults initially; verify the user’s actual device compatibility before installation.
- Use the existing phone interface with the desktop application’s shared visual identity.
- No new subscriptions, backend service, catalogue, analytics, or authentication model.
- No paid membership purchase, public upload, or repository publication without explicit authorization.
- Any unresolved platform limitation stays visible in the blocker register instead of being guessed away.

