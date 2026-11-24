# Remaining sequence — chronological order to finish the port

Baseline `2122110f9b41436723f368d3e1fb4d8a2a4276c2`, branch `port/ios-completion`
(branched from `port/ios` @ `1191f49`). Companion ledgers: `TASK_BOARD.md` (ownership),
`PARITY_MATRIX.md` (evidence), `BLOCKERS.md` (what only the user can unblock).

**Why this order.** The port is source-complete for the simulator. What remains is either
(a) a decision, (b) a user-gated input (Apple account/device, provider client IDs), or
(c) verification that can only happen on a real iPhone. So the order below does the work
that is *unblocked today* first, puts the decision before the code it governs, and leaves
the device-gated verification last — because every one of those steps needs the same
blocked input (an installed build on a physical iPhone).

Steps 1–3 need no device. Step 4 is a decision. Steps 5–9 need a physical iPhone and the
provider credentials.

---

## Step 1 — Close the fabricated-success gaps in the bridge facade (code, unblocked)

| | |
|---|---|
| Scope | `src-tauri/src/android.rs`, `ios/Sources/HushioServicePlugins.swift` |
| Work | Route every iOS `notification_*` call to the real Swift bridge (**done in this branch**). Audit the remaining iOS branches for any `Ok(...)` that is not backed by the bridge — `schedule_retry` and `secret_*` already route; confirm nothing else silently succeeds. |
| Exit | `cargo check --target aarch64-apple-ios-sim` clean; no iOS path returns a synthesised success. |
| Blocks | Step 9 (notification rows cannot be evidence-led while the facade lies). |

## Step 2 — Server-side/UX check of the "unavailable capability" surfaces (code, unblocked)

| | |
|---|---|
| Scope | `src/views/settings/categories.tsx`, `src/lib/updates.ts`, `src/lib/theme.ts` |
| Work | Finish the leftover Android-only branches flagged in `BLOCKERS.md` B011: the updater row is hidden on iOS but `updates.ts` still keys off `android`; system-bar handling stays Android-only by design. Make the iOS path explicit rather than accidental. |
| Exit | `pnpm typecheck` 0, `pnpm test` green, rows hidden for the right reason with a comment naming iOS. |
| Blocks | Step 8 (visual/settings review needs the final row set). |

## Step 3 — Decision record: playback occurrence identity + background ownership (decision)

| | |
|---|---|
| Scope | `docs/ios-port/DECISIONS.md`, `BEHAVIOR_CONTRACTS.md` §P3/§P6 |
| Work | Resolve contract C-1/C-2: does a native occurrence/generation ID get added to the wire payloads, or does iOS keep the singleton-queue model the shared TS engine already drives on Android? Also settle what the native side may advance while the WebView is suspended. Write the answer down before touching `PlayerEngine`. |
| Exit | A signed decision in `DECISIONS.md` naming the chosen identity model, the compatibility impact on existing payloads, and the events that must carry it. |
| Blocks | Steps 6 and 7. **Do not implement either before this is written.** |

## Step 4 — Stale-event tests against the decided contract (code, unblocked)

| | |
|---|---|
| Scope | `src/lib/androidEngine.test.ts`, shared engine, new Swift-side test if applicable |
| Work | Encode the P3 scenarios as tests: delayed resolve for A after selecting B, A→B→A, pause during URL refresh, rapid seek then replace, queue mutation while next item prepares. Tests describe the contract even where the device cannot yet run them. |
| Exit | Tests fail against a deliberately stale-event implementation and pass against the fixed engine. |
| Blocks | Step 7. |

## Step 5 — Advanced audio: EQ first, then the rest (code + per-capability decision)

| | |
|---|---|
| Scope | `ios/Sources/PlayerEngine.swift`, `HushioPlayerPlugin.swift` |
| Work | `player_set_eq` currently rejects `not_implemented`. Implement the documented C3 proposal (`AVAudioEngine` + `AVAudioUnitEQ`) **or** keep the honest rejection and record the decision. Then handle crossfade/Automix, skip-silence, LUFS leveling and the sleep timer one capability at a time — each either implemented or explicitly `not_supported` with the reason. |
| Exit | Every advanced capability is implemented or rejects with a real code; none return a fake `appliedBands`/success. |
| Blocks | Step 9. |

## Step 6 — Physical device: signing and first install (user-gated)

| | |
|---|---|
| Scope | Xcode / Apple account / connected iPhone (`src-tauri/tauri.ios.conf.json` `developmentTeam`) |
| Work | User adds an Apple Account, sets the development team, connects and trusts the iPhone. Then `tauri ios build -t aarch64` and install. |
| Exit | App launches on the physical device. |
| Blocks | **Everything in steps 7–9.** This is the single critical path item. |

## Step 7 — Physical playback parity (device)

| | |
|---|---|
| Scope | verification only |
| Work | Ordered by risk: controlled WAV on device → background audio past lock/screen-off → app switch → interruption (transient/permanent) → route change (unplug, Bluetooth) → remote commands → natural completion + advance → stream refresh with real HTTPS headers/byte ranges → A→B late-event scenarios from step 4. |
| Exit | Evidence per row in `PARITY_MATRIX.md` (§2), flipping `SRC` → `V-DEV`. Interruption/route rows are the ones most likely to fail. |
| Blocks | Step 9. |

## Step 8 — Physical services parity (device + credentials)

| | |
|---|---|
| Scope | verification only, plus the two client IDs |
| Work | Configure `HUSHIO_GOOGLE_CLIENT_ID` / `HUSHIO_SPOTIFY_CLIENT_ID`, then exercise: sign-in unconfigured / cancel / deny / success / sign-out; Keychain persistence across relaunch; document picker cancel, deny, revoked access, bookmark persistence after restart; tree scan + sidecar LRC; download export round-trip; real notification state/request/settings; BGTaskScheduler actually firing; WebDAV/SMB/add-on reachability under ATS. |
| Exit | Evidence per row (§3) flipping `SRC`/`BLOCK` → `V-DEV`, with honest remaining gaps. |
| Blocks | Step 9. |

## Step 9 — Parity closure and release handoff (documentation)

| | |
|---|---|
| Scope | `PARITY_MATRIX.md`, `HANDOFF.md`, `BLOCKERS.md`, `PROGRESS.md` |
| Work | Final sweep: every matrix row becomes `V-DEV`, `N/A` with a reason, or `OPEN` with a named owner. Record signing/install/refresh steps actually used. Separate pre-existing source defects (D04/D05/D08/D09/D10/D12/D17 — e.g. download filesystem delete no-op, plaintext secret fallback, unreachable erase dialog) from port regressions. |
| Exit | No row silently dropped; a second person can build, install and verify from `HANDOFF.md` alone. |

## Dependency chain (critical path)

```
1 notification facade ─┐
2 settings surfaces ───┤
3 identity/background decision ──► 4 stale-event tests ──┐
5 advanced audio ──────────────────────────────────────┤
                                                        ├─► 6 device install ─► 7 playback ─► 8 services ─► 9 closure
```

Steps 1, 2, 3, 4 and 5 can be worked in parallel; only 6 gates the rest.

## If the device stays unavailable

Do 1–5 completely, then declare the port "simulator-complete, device-gated":
`PARITY_MATRIX.md` keeps 7/8 rows at `SRC` with the blocker named, and `HANDOFF.md`
documents the exact one-time signing step. That is an honest stopping point — the
contract in §6 allows blocked rows provided nothing claims unverified parity.
