# Device verification checklist — what to run once a physical iPhone is available

Everything below is already implemented and compiles; none of it can be verified on the
simulator. Work top to bottom, record evidence in `PARITY_MATRIX.md`, and flip `SRC` → `V-DEV`
only for rows you actually observed. Prerequisite: `HUMAN_STEPS.md` H1 (signing + trusted
device) completed.

Owner-only inputs still required for some rows: `HUMAN_STEPS.md` H2 (OAuth client IDs).

## 0. Install

```sh
cd src-tauri
pnpm exec tauri ios build -t aarch64
```

Expected: a signed `.ipa`/`.app` installable on the device. If it stops at
`Signing for "hushio-desktop_iOS" requires a development team`, that is H1, not a code bug.

## 1. Playback transport (P8 proving case, continue from the simulator PASS)

- [ ] Controlled 45 s WAV (or a rights-controlled local file) plays audibly.
- [ ] Duration matches the file; position advances in seconds.
- [ ] Pause holds with no drift; seek to 10 s lands exactly; resume works.
- [ ] Natural completion fires once and the shared store advances **once**.
- [ ] `player-ended` no longer double-advances: check the log shows one `ended` per track
      (ADR-007 D1: iOS now sends `{id}`, the shared engine filters by identity).

## 2. Background and interruption (the rows most likely to fail)

- [ ] Play → lock screen → audio continues ≥ 60 s.
- [ ] Lock-screen controls: play/pause/next/previous act on the app.
- [ ] App switch to another app → audio continues; returning restores accurate position.
- [ ] Transient interruption (incoming call / Siri): pauses, then resumes per policy.
- [ ] Permanent interruption: stays paused, no unsolicited resume.
- [ ] Unplug headphones → pauses (route change); Bluetooth disconnect → pauses.
- [ ] **Documented limit:** with the WebView suspended, a track that ends stays ended
      (ADR-007 D3). Confirm that and record it as expected, not a defect.

## 3. Sleep timer (new this milestone)

- [ ] `player_set_sleep_timer {endsAtEpochMs: now+30s}` → audible fade in the last 10 s,
      pause at the deadline, volume restored ~500 ms later.
- [ ] Past deadline → immediate pause.
- [ ] `endOfSong: true` → pauses at the end of the current track, does not advance.
- [ ] `{null,false}` cancels an armed timer mid-fade and restores volume.
- [ ] Arming while the app is backgrounded still fires (the process stays alive while
      playing audio — verify, do not assume).

## 4. Services

- [ ] Keychain: set a secret, force-quit, relaunch, read it back (`secure_get`).
- [ ] Document picker: cancel → `{uri:null}`; pick a folder → reference returned.
- [ ] Relaunch the app → the picked folder still resolves (security-scoped bookmark).
- [ ] `scan_tree` returns items whose keys are exactly
      `uri,name,size,mtime,title,artist,album,genre,durationMs`.
- [ ] `read_sidecar_lrc` returns text when a `.lrc` sits next to an audio file.
- [ ] Download export: publish a file → it appears where the user chose.
- [ ] Notifications: `notification_state` reports `notDetermined` on a fresh install,
      `notification_request` reflects the real user choice (deny must stay `denied`),
      `notification_settings` opens the app's settings page.
- [ ] BGTaskScheduler: `schedule` resolves; confirm no crash when the refresh task fires
      (the handler completes it as *failed* on purpose — see `FACADE_AUDIT.md`).

## 5. Auth (needs H2)

- [ ] Unconfigured → sign-in reports "not configured", never a fake success.
- [ ] Google: PKCE flow completes, redirect returns to the app, session persists in Keychain.
- [ ] User cancels the web sheet → `auth_await` rejects `cancelled` (no fabricated URL).
- [ ] Spotify: same flow with the `hushio-spotify` scheme.

## 6. Network sources

- [ ] WebDAV/SMB reachability under ATS (`NSAllowsLocalNetworking` is already set; a public
      plain-HTTP host must still fail).
- [ ] Stream proxy: remote HTTPS audio with per-stream headers and byte ranges
      (seek in a long track exercises `HushioResourceLoader`).

## Reporting

For each item, append a row to `PARITY_MATRIX.md` with status `V-DEV`, the build/commit SHA,
the device model + iOS version, and one line of what was observed. Anything not run stays
`SRC`. A failed item becomes `OPEN` with the observed symptom — never a green row.
