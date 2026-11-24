# Hushio iPhone port

**Checkpoint, not a completed iPhone build.** Start at `PROGRESS.md` and `BLOCKERS.md`. Application implementation is gated by source/design review and the unavailable Xcode license/target setup. Simulator/device operation has not been verified.

## Source of truth

- Starting commit: `2122110f9b41436723f368d3e1fb4d8a2a4276c2`.
- Branch/worktree: `port/ios`.
- Original checkout preserved in a separate local copy.
- Supplied `MASTER_PLAN.md` copied from the lead's plan (local machine paths redacted).

## Documents

| Document | Purpose |
|---|---|
| `MASTER_PLAN.md` | Supplied scope, phases, roles and acceptance gates |
| `SOURCE_ATLAS.md` | Source routes, services, stores and source discrepancies |
| `FEATURE_MATRIX.md` | Per-feature source/owner/acceptance/platform/status inventory |
| `BEHAVIOR_CONTRACTS.md` | Detailed boundary semantics and controlled playback proof |
| `DESIGN_SPEC.md` | Binding extracted design and permitted iPhone accommodations |
| `REFERENCE_VIEWS.md` | Reference-view coverage and missing captures |
| `PLATFORM_READINESS.md` | Reviewed toolchain/native/configuration risks and primary documentation |
| `DECISIONS.md` | Lead's architecture/interface/evidence decisions |
| `TASK_BOARD.md` | Dependency order, exclusive ownership, source references and acceptance |
| `BASELINE_VERIFICATION.md` | Exact baseline checks and evidence scope |
| `BLOCKERS.md` | User/toolchain/platform/source blockers, never counted as parity |
| `PROGRESS.md` | Current execution record |
| `REMAINING_SEQUENCE.md` | Chronological order for the remaining work and the critical path |
| `FACADE_AUDIT.md` | Fabricated-success sweep of every iOS-reachable Rust command |
| `ADVANCED_AUDIO.md` | Per-capability EQ/crossfade/skip-silence/leveling/sleep decisions |
| `HUMAN_STEPS.md` | The only owner-gated inputs; agents prepare the seam instead of faking them |
| `DEVICE_VERIFICATION.md` | Ordered device checklist that closes the remaining matrix rows |
| `BUGFIX_LOG.md` | Every defect fixed to reach a running device build, with root cause and commit |
| `SECRET_SCAN.md` | Credential/identity scan results and the policy for the one allowlisted public key |
| `LAUNCH_IOS.md` | Deep-link/custom-scheme routing on iOS: what Tauri delivers and what stays open |
| `ACCESSIBILITY_AUDIT.md` | Ranked P1/P2/P3 accessibility findings for the iPhone shell |

## Verification so far

Type checking, 3,741 frontend tests (354 files), 634 Rust tests and production renderer build pass on unchanged baseline source. See full logs and exit files in `evidence/baseline-tests/`. Browser screenshots are in `evidence/browser-baseline/`, with missing-native errors and scope recorded. No iOS test or install pass is claimed.

## Resume critical path

1. User reviews Xcode agreement interactively:
   ```sh
   sudo env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -license
   ```
2. Recheck Xcode first-launch status, SDKs and simulator runtimes using per-command `DEVELOPER_DIR`; do not alter global `xcode-select`.
3. Establish pinned Rust iOS target libraries without disturbing existing Homebrew toolchain. Follow reviewed readiness report; do not mistake a printed target-libdir path for installed std.
4. Review source/design contracts, resolve shared background queue/event identity ownership, then assign Phase B implementation. Keep `TASK_BOARD.md` ownership exclusive.
5. Generate/build the real Tauri iOS host using its installed CLI and a distinct development bundle identifier chosen with signing. Only then claim host launch.
6. Prove physical-device playback and background transitions before service/UI/parity completion. Account authentication and device trust stay user-operated.

There is currently **no working iPhone build/install path or installation-refresh evidence**. Those are required final handoff artifacts after Phase F, not files to fabricate at this checkpoint. No upload, publication, App Store submission or paid membership authorized/performed.
