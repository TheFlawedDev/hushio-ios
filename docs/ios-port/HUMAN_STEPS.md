# Human steps — work that only the repo owner can perform

Everything else in the port is code or verification an agent can do. This file is the single
place to check when a task looks "blocked": if it is listed here, the code seam is already
prepared and the remaining action is the item below.

Agents: when you reach a step that needs one of these, **do not skip the task** — write the
code to the seam, leave a comment pointing at this file, record it in `BLOCKERS.md`, and say
so in the commit message. Never simulate the missing input.

---

## H1 — Physical iPhone install (unblocks the biggest block of work)

Needed for: `REMAINING_SEQUENCE.md` steps 6–8 (device install, playback parity, services
parity), and `BLOCKERS.md` B003 / B016.

1. Xcode → Settings → Accounts → add the Apple Account.
2. Select the development team for the `hushio-desktop_iOS` target, **or** set
   `bundle.iOS.developmentTeam` in `src-tauri/tauri.ios.conf.json` (or export
   `APPLE_DEVELOPMENT_TEAM`).
3. Connect the iPhone by cable, trust this Mac, enable Developer Mode on the phone
   (Settings → Privacy & Security → Developer Mode), and trust the developer certificate
   (Settings → General → VPN & Device Management).
4. Then:
   ```sh
   cd src-tauri
   pnpm exec tauri ios build -t aarch64
   ```

State today: `security find-identity -v -p codesigning` reports 0 identities on this Mac and
`devicectl` shows no connected phone, so the build stops at
`Signing for "hushio-desktop_iOS" requires a development team`.

## H2 — OAuth client IDs (unblocks sign-in verification)

Needed for: `REMAINING_SEQUENCE.md` step 8; `PARITY_MATRIX.md` §3 "OAuth" row.

- `HUSHIO_GOOGLE_CLIENT_ID` — an **iOS-type** OAuth client in Google Cloud Console.
- `HUSHIO_SPOTIFY_CLIENT_ID` — a Spotify app with the `hushio-spotify` redirect scheme.

The flows, PKCE, state handling and URL schemes are already wired (`src-tauri/src/ios_scheme.rs`,
`google_auth.rs`, `spotify_auth.rs`, `Info.ios.plist`). Without the IDs the app correctly
reports "not configured" — that is honest, not a gap to paper over.

## H3 — Repository actions

- The fork already has `port/ios` and `port/ios-completion` pushed. Opening a pull request is a
  owner action; no agent opens one.
- Nothing needs publishing, purchasing or App Store submission.

---

## What is deliberately NOT in this list

- Simulator builds, tests, typecheck, `cargo check`, Swift builds — all automated.
- Simulator install/launch — automated (`simctl`).
- Anything that needs a *tap* in the UI (document picker, notification prompt) is listed as
  "unexercised" in `PARITY_MATRIX.md` rather than blocked here, because it needs a device or a
  UI-automation harness, not a credential.
