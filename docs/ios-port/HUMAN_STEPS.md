# Human steps — work that only the repo owner can perform

Everything else in the port is code or verification an agent can do. This file is the single
place to check when a task looks "blocked": if it is listed here, the code seam is already
prepared and the remaining action is the item below.

Agents: when you reach a step that needs one of these, **do not skip the task** — write the
code to the seam, leave a comment pointing at this file, record it in `BLOCKERS.md`, and say
so in the commit message. Never simulate the missing input.

---

## H1 — Physical iPhone install (unblocks the biggest block of work)

**Status: the code side is finished; one GUI step remains.** Verified state as of this commit:

| Item | State |
|---|---|
| Development team | a **free personal team** (`isFreeProvisioningTeam = 1`); the team ID lives in `src-tauri/tauri.ios.conf.json` and is not reproduced here |
| Config | `bundle.iOS.developmentTeam` in `src-tauri/tauri.ios.conf.json`; Tauri embeds `DEVELOPMENT_TEAM` into the generated Xcode project on build |
| Signing flags | `tauri ios build` already passes `-allowProvisioningUpdates`; nothing extra to type |
| Signing certificate | **created** — an `Apple Development` identity is present in the keychain (check with `security find-identity -v -p codesigning`) |
| Apple ID session | authenticated (the certificate proves the portal call succeeded) |
| Device | the iPhone is paired (`devicectl manage pair --device <name>`) and Xcode lists it as usable, but **Developer Mode is Off**, so device builds are refused; the device is also not yet registered to the team |
| Pairing | `xcrun devicectl manage pair --device <name>` pairs it; no cable re-plug needed once paired over USB |

That combination produces exactly this, and nothing else:

```
error: Communication with Apple failed: Your team has no devices from which to
generate a provisioning profile. Connect a device to use or manually add device IDs
in Certificates, Identifiers & Profiles.
error: No profiles for 'com.hushio.app.iosdev' were found
```

The certificate exists, so the only thing missing is a **device Xcode can reach**. A free
team cannot register a device from the command line, and Xcode will not register a device it
cannot see. So the remaining action is physical, then one command:

1. **Connect the iPhone by cable** (USB attachment currently reads 0), unlock it, and tap
   *Trust This Computer*. If iOS asks, enable **Developer Mode**
   (Settings → Privacy & Security → Developer Mode).
2. Optionally, to keep it working cable-free later: Xcode → **Window → Devices and
   Simulators** → select the iPhone → tick **Connect via network**.
3. Confirm the device is visible to Xcode:
   ```sh
   ./scripts/ios-signing-check.sh     # "devices Xcode considers available" must be >= 1
   ```
4. Build and install — Xcode registers the device and mints the profile on this run:
   ```sh
   cd src-tauri && pnpm exec tauri ios build --debug -t aarch64 --ci
   ```
   (`-allowProvisioningUpdates` is already passed; expect one keychain prompt — *Always Allow*.)
5. On the phone: **Settings → General → VPN & Device Management** → trust the developer
   certificate, if iOS has not already asked.
6. From then on the same command is what agents should use for every device build:
   ```sh
   cd src-tauri && pnpm exec tauri ios build --debug -t aarch64 --ci
   ```

Free-team consequences to keep in mind: certificates/profiles expire after **7 days**
(re-run step 4 or the command above to refresh), and only a few apps can be signed at once.

Check the whole picture any time with:

```sh
./scripts/ios-signing-check.sh
```

## H2 — OAuth client IDs (unblocks sign-in verification)

Needed for: `REMAINING_SEQUENCE.md` step 8; `PARITY_MATRIX.md` §3 "OAuth" row.

- `HUSHIO_GOOGLE_CLIENT_ID` — an **iOS-type** OAuth client in Google Cloud Console.
- `HUSHIO_SPOTIFY_CLIENT_ID` — a Spotify app with the `hushio-spotify` redirect scheme.

The flows, PKCE, state handling and URL schemes are already wired (`src-tauri/src/ios_scheme.rs`,
`google_auth.rs`, `spotify_auth.rs`, `Info.ios.plist`). Without the IDs the app correctly
reports "not configured" — that is honest, not a gap to paper over.

## H3 — Repository actions

Commit identity: commits on this branch use a GitHub **noreply** address, not a personal
mailbox. If a new machine is used, set it before committing:

```sh
git config user.email "<your-github-id>+<username>@users.noreply.github.com"
```

`scripts/check-local-path-leaks.sh` fails if a commit in the port's range carries a personal
address, or if any tracked file contains one.

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
