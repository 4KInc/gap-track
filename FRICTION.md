# Friction log

Contemporaneous record of where the platform fought back. Written as it happens,
never reconstructed — the exact error string is the part that makes an entry
useful, and it is the first thing memory loses.

Six fields per entry, per the hackathon's format. If nothing went wrong on a
given task, there is no entry. An empty section is an honest section.

---

## Template

### <n>. <one-line title>

- **Task attempted:**
- **Steps taken:**
- **Expected result:**
- **Actual result:** *(verbatim — paste the error, do not paraphrase it)*
- **Severity:** Critical / High / Medium / Low
- **Workaround:**
- **Actionable suggestion:**

---

## Entries

### 1. macOS prerequisites are overstated; the installer needs far less

- **Task attempted:** Install Vega Developer Tools on a clean macOS 26.5.2
  (Apple Silicon) machine with no Homebrew and no admin session.
- **Steps taken:** Read the documented prerequisites at
  `developer.amazon.com/docs/vega/0.23/install-vega-sdk.html`, which require
  Homebrew, Rosetta 2 via `softwareupdate --install-rosetta`, and nine packages
  (`binutils coreutils gawk findutils grep jq lz4 gnu-sed watchman`). Before
  running any of it, inspected `get_vvm.sh` directly.
- **Expected result:** All of the above genuinely needed before the SDK
  installer will run.
- **Actual result:** The installer's own prerequisite gate (`_001_check_prereqs`)
  hard-requires only **curl, tar and jq**. Its exact failure text for the one
  missing on a clean Mac is:
  `jq is required. Please install jq and ensure it is on the PATH.`
  There is **no `sudo` call anywhere in the macOS path** — the two `sudo`
  mentions in the script are printf help text for Ubuntu/snap. Installing the
  standalone `jq` binary to `~/.local/bin` and running
  `NONINTERACTIVE=true bash get_vvm.sh` completed successfully: SDK 0.24.12044
  installed to `~/vega`, VVD included, without Homebrew, without Rosetta, and
  without ever entering a password.
  A full `react-native build-vega --build-type Debug` then also completed on the
  same machine, producing `gaptrack_x86_64.vpkg` (2.9 MB, OS version 1.2) with
  `vega vtbuild exited with code 0`. So none of `binutils coreutils gawk
  findutils grep gnu-sed lz4 watchman` — nor Rosetta 2 — was required to install
  the SDK, generate a project, or build it.
- **Severity:** Medium. Not a blocker, but it wrongly tells developers without
  admin rights on a managed machine that they cannot start — and Rosetta 2 is
  requested on Apple Silicon without the docs saying which component needs it.
- **Workaround:** Install `jq` standalone, then
  `NONINTERACTIVE=true bash get_vvm.sh`.
- **Actionable suggestion:** Split the prerequisites into "required" (curl, tar,
  jq) and "recommended" (the GNU toolchain and watchman, which improve the Metro
  dev loop but gate nothing in install, generate or build), and say
  plainly that the macOS installer needs no elevated privileges. Documenting
  `NONINTERACTIVE=true` on the install page would also help CI setups — it is
  supported by the script but appears nowhere in the docs.

### 2. Documented React Native version does not match what the SDK generates

- **Task attempted:** Confirm the React Native version to target before writing
  any component code.
- **Steps taken:** The Vega documentation states React Native for Vega is based
  on React Native 0.72, and the API reference is published under a
  `/docs/react-native-vega/0.72/` path. Installed SDK 0.24.12044 and ran
  `vega project list-templates`, then generated with the default `helloWorld`
  template and read the resulting `package.json`.
- **Expected result:** A project targeting React Native 0.72.
- **Actual result:** Two templates are offered — `helloWorld` (targets RN v0.83)
  and `helloWorld-rn72` (targets RN v0.72). The default produced
  `react-native: 0.83.0`, `react: 19.2.0`,
  `@amazon-devices/react-native-kepler: ~4.0.0`, `engines.node: >=20`.
- **Severity:** Medium. Version-specific documentation reachable without a
  version selector means a developer can plan an entire component architecture
  against a runtime two years out of date. Third-party write-ups repeat the 0.72
  figure as current.
- **Workaround:** Trust the generated `package.json` over the prose docs, and
  read the `.d.ts` files in `node_modules` as the authority.
- **Actionable suggestion:** Surface the RN version each SDK release targets in
  the release notes and on the overview page, with the older pages clearly
  labelled by SDK version rather than by RN version.

### 3. `scalingmode` is misspelled in the public surface-view API

- **Task attempted:** Set the video scaling mode on `KeplerVideoSurfaceView`.
- **Steps taken:** Read the prop's type union in
  `node_modules/@amazon-devices/react-native-w3cmedia/dist/interface/KeplerVideoSurfaceView.d.ts`.
- **Expected result:** The four documented modes spelled correctly.
- **Actual result:** The union is
  `'none' | 'fit' | 'strech' | 'fill'` — "stretch" is misspelled, and it is
  also the documented default. The typo is in the public type, so the correct
  spelling fails to compile and callers must reproduce the error deliberately.
- **Severity:** Low. Cosmetic, but it is load-bearing in a type union, so it
  cannot be corrected without a breaking change later.
- **Workaround:** Write `'strech'`, or avoid the prop and accept the default.
- **Actionable suggestion:** Accept both spellings now — widen the union to
  `'stretch' | 'strech'` and treat them identically — then deprecate the
  misspelling. Fixing it silently in a later release would break every app that
  spelled it the required way.

### 4. Surface handle and player initialise independently, with no guidance on ordering

- **Task attempted:** Render video from a `VideoPlayer` into a
  `KeplerVideoSurfaceView`.
- **Steps taken:** Followed the package README, which shows
  `onSurfaceViewCreated` calling `videoPlayer.setSurfaceHandle(handle)` directly.
- **Expected result:** Video renders.
- **Actual result:** Black surface. `VideoPlayer.initialize()` is asynchronous
  and `onSurfaceViewCreated` fires when the native view mounts, so on a cold
  start the callback runs while the player reference is still null and the
  handle is silently dropped. Playback proceeds — `play()` resolves and
  `currentTime` advances — so the only symptom is a black rectangle, which
  reads as a decode or codec problem rather than a lifecycle one.
- **Severity:** Medium. Costs real debugging time and points the developer at
  the wrong subsystem.
- **Workaround:** Park the handle in a ref and attach when both the handle and
  an initialised player exist, whichever arrives second. Release it in
  `onSurfaceViewDestroyed` via `clearSurfaceHandle`.
- **Actionable suggestion:** Say in the README that the two are independent and
  can arrive in either order, and show the rendezvous rather than the direct
  call. Better still, have `setSurfaceHandle` on an uninitialised player either
  queue the handle or throw, rather than doing nothing.

### 5. Neither a packaged file nor a plain progressive MP4 will play; only MSE works

- **Task attempted:** Play short media from app assets, to measure playhead
  behaviour and concurrent audio.
- **Steps taken:** Built a probe that tries three sources in sequence through
  the same `VideoPlayer`, each with `src` assigned, `load()` called, and
  `readyState` polled to an 8s timeout.
- **Expected result:** At least the progressive https MP4 to play, since the
  official sample's `loadStaticMediaPlayer` assigns `src` directly for MP4.
- **Actual result:** Measured on device (VVD, SDK 0.24.12044):

  | Source | Verdict | Error |
  |---|---|---|
  | `file:///pkg/bundle/assets/.../clip.mp4` | REJECTED | `code=4 (SRC_NOT_SUPPORTED) msg=""` at **0ms** |
  | `https://.../Big_Buck_Bunny_720_10s_5MB.mp4` | REJECTED | `code=3 (DECODE) msg="Error Occurred."` after **50ms** |
  | `https://.../bipbop_adv_example_fmp4/master.m3u8` via Shaka | **manifest parsed** | — |

  These are two different failures, and the distinction matters. The `file://`
  case is rejected at 0ms without a fetch: the **scheme** is refused, so a
  packaged asset is unreachable no matter what it contains. The https case is
  accepted as a source, fetched, and then fails in the demuxer at 50ms: a plain
  non-fragmented MP4 cannot be progressively demuxed. Only MSE-fed fragmented
  content plays.

  Both failures are silent in the same misleading way: `play()` resolves,
  `paused` flips to `false`, and the only symptoms are a black surface and a
  `currentTime` frozen at 0 — which read as a rendering problem rather than a
  source that was refused.

  The `msg` field is empty on the scheme rejection and the uninformative
  `"Error Occurred."` on the decode failure, so neither error says what was
  wrong or what to do instead.
- **Severity:** High. It blocks the first thing any developer tries — play a
  bundled asset — and the official sample's own static path suggests a
  progressive MP4 should work, which sends you looking for a codec problem.
- **Workaround:** Serve fragmented content over https and drive it through the
  Shaka port from
  [vega-video-sample](https://github.com/AmazonAppDev/vega-video-sample).

  **Correction.** This entry originally recorded the Shaka path as ACCEPTED.
  That verdict used `readyState >= 1` (`HAVE_METADATA`) as its test, which
  proves only that the manifest parsed and the duration is known. It does not
  prove anything decoded, and on the virtual device nothing does — see entry
  10. The row above is restated accordingly.
- **Actionable suggestion:** State in the W3C Media API overview that `file://`
  is not a supported scheme and that progressive MP4 is not demuxed — MSE is
  required. Populate `MediaError.message` with the reason ("scheme not
  supported", "use MediaSource") instead of `""` and `"Error Occurred."`. And
  either make `loadStaticMediaPlayer` in the official sample work, or remove
  it, since as written it implies a capability the player does not have.

### 6. The one file you must copy is marked "PROPRIETARY/CONFIDENTIAL" inside an MIT-0 repo

- **Task attempted:** Reuse the Shaka Player integration from the official
  [vega-video-sample](https://github.com/AmazonAppDev/vega-video-sample), which
  the documentation points to as the way to play media on Vega.
- **Steps taken:** Cloned the sample and opened
  `src/w3cmedia/shakaplayer/ShakaPlayer.ts` — the file the README names as the
  helper that "instantiates the Shaka player class and links it to the W3C
  Media API".
- **Expected result:** A permissively licensed sample, consistent with the
  repository licence.
- **Actual result:** That file carries the header:

  > `AMAZON PROPRIETARY/CONFIDENTIAL`
  > `You may not use this file except in compliance with the terms and`
  > `conditions set forth in the accompanying LICENSE.TXT file.`

  There is no `LICENSE.TXT` in the repository. The actual `LICENSE` is
  **MIT No Attribution**, which grants use, copy, modify and distribute without
  restriction.

  It is not one file. `ShakaPlayer.ts` is the only checked-in file carrying the
  header, but the build generates seven more that carry it too —
  `PlayerInterface.ts` and all six polyfills — because they are unpacked from
  `shaka-rel-v4.8.5-r1.2.tar.gz` at install time and are gitignored, so they are
  invisible until you run the build. **Every file the integration requires is
  marked proprietary-confidential**, in a repository licensed MIT-0.
- **Severity:** Medium. Nothing technical breaks, but the headline integration
  file of the official sample appears to forbid the use the repository licence
  permits, and it names a licence file that does not exist. Any developer doing
  licence diligence before shipping — which is exactly what a public,
  open-source submission requires — stops here.
- **Workaround:** Rely on the repository `LICENSE` (MIT-0), which governs, and
  treat the file header as stale. Shaka Player itself is Apache-2.0 and
  correctly recorded in `LICENSE-THIRD-PARTY`.
- **Actionable suggestion:** Delete the proprietary header from
  `ShakaPlayer.ts`, or replace it with the MIT-0 notice used implicitly by the
  rest of the repository. A one-line fix that removes a real adoption blocker.

### 7. The Shaka build script assumes `kepler` on PATH and a `python` that macOS no longer ships

- **Task attempted:** Run `shaka-setup/build.sh` from the official
  vega-video-sample to produce the Shaka Player artifacts the W3C media player
  needs.
- **Steps taken:** Installed the Vega SDK, sourced `~/vega/env`, cloned the
  sample, ran `./build.sh`. All ~45 Amazon patches applied to Shaka v4.8.5
  successfully; the failure came at the compile step.
- **Expected result:** A compiled `dist/shaka-player.compiled.js`.
- **Actual result:** Two failures in sequence, verbatim:

  ```
  ./build.sh: line 110: kepler: command not found
  Vega build failed, attempting direct build
  env: python: No such file or directory
  Build failed. Resetting state
  ```

  The first is because the script invokes `kepler`, the backward-compatibility
  symlink the installer creates alongside `vega`, but `~/vega/env` is not
  sourced by the script and a fresh non-login shell will not have it. The
  installer itself prints "Use `vega` directly for all future invocations",
  so the build script is calling the name its own installer deprecates.

  The second is because the fallback path invokes `python`. macOS has not
  shipped a `python` binary since Monterey — only `python3`. So on a current
  Mac, which is one of the two supported platforms, **both** the primary and
  the fallback build paths fail.
- **Severity:** High. It blocks the documented route to playing any media at
  all, and the `ERR` trap resets the repository, so the ~45-patch application
  is repeated on every retry.
- **Workaround:** `export PATH="$HOME/vega/bin:$PATH"` so `kepler` resolves,
  and put a `python` shim on PATH: `printf '#!/bin/sh\nexec python3 "$@"\n' >
  ~/.local/bin/python && chmod +x ~/.local/bin/python`.
- **Actionable suggestion:** Source `~/vega/env` at the top of `build.sh`, or
  call `vega` rather than the deprecated `kepler`. Prefer `python3` with a
  fallback to `python`, not the reverse. And check for both before applying 45
  patches, so the failure arrives in seconds rather than after the slowest part
  of the build.

### 8. The Shaka build needs a JDK, and nothing says so until 45 patches in

- **Task attempted:** Produce `shaka-player.compiled.js` via
  `shaka-setup/build.sh`.
- **Steps taken:** Resolved entry 7 (`kepler` on PATH, `python` shim), reran.
  All ~45 patches reapplied, linting passed, then the compile step failed.
- **Expected result:** A compiled Shaka bundle.
- **Actual result:** Verbatim, on both the Vega build path and the direct
  fallback:

  ```
  The operation couldn't be completed. Unable to locate a Java Runtime.
  Please visit http://www.java.com for information on installing Java.
  [ERROR] Build failed
  ```

  Shaka compiles with Closure Compiler, which requires a JRE. macOS ships
  `/usr/bin/java` as a **stub** that exists on PATH and fails when invoked, so
  a `command -v java` check passes on a machine with no JDK at all. Neither the
  sample's prerequisites nor the Vega SDK prerequisites mention Java.
- **Severity:** High. It blocks the only supported route to media playback, and
  the `ERR` trap resets the Shaka repository on failure, so every retry
  re-applies all 45 patches before failing again at the same point.
- **Workaround:** Install a JDK without admin rights — extract a Temurin
  tarball to `~/.local/jdk` and export `JAVA_HOME`. Build then succeeds.
- **Actionable suggestion:** Add a JDK to the documented prerequisites, and
  preflight it in `build.sh` with `java -version` (not `command -v java`, which
  the macOS stub defeats) before applying any patches. Combined with entries 7,
  this is three separate environment prerequisites discovered one failed build
  at a time, each after the slowest part of the script.

### 9. The Vega Virtual Device has no audio device, and nothing says so

- **Task attempted:** Determine whether a second audio stream can play
  concurrently with video, and whether declaring
  `AudioUsageType.USAGE_ACCESSIBILITY` changes that. This is the core question
  for an audio-description app.
- **Steps taken:** Built a probe that plays video through Shaka while an
  `AudioPlayer` plays an audio-only HLS rendition over it, twice — once
  declared `USAGE_MEDIA`, once `USAGE_ACCESSIBILITY`. Both players reported
  metadata loaded (`482ms` and `0ms`) and no errors. Listened on a Mac with
  output confirmed working.
- **Expected result:** To hear one stream, or two, and learn which.
- **Actual result:** Silence. Inspecting the running virtual-device process
  shows **no audio device is configured at all**. The complete flag list is:

  ```
  -avd-arch -skindir -skin -ports -dns-server
  -sysdir -datadir -data -keyboard-mapping -qemu -qmp
  ```

  No `-audio`, `-soundhw`, `virtio-snd`, HDA or AC97. The media pipeline
  initialises, loads and reports healthy because GStreamer renders to a sink
  that goes nowhere, so nothing in the API surface indicates that audio is
  impossible. An app can play, report `paused === false`, advance
  `currentTime`, and produce no sound, with no error at any layer.
- **Severity:** High for any audio-centric app. The virtual device is
  presented as the way to develop without hardware, and the Fire TV track
  explicitly lists accessibility among its priorities, but **no audio feature
  can be validated on it at all**. Worse, the failure is indistinguishable
  from a working app until you put on headphones, so the time is spent before
  you learn the test was never possible.
- **Workaround:** None on the emulator for *hearing* anything. The project
  works around it by keeping the scheduler free of any platform dependency,
  so the identical engine can be run against a desktop audio stack, and by
  rendering a mixed file of the programme with its descriptions at the
  offsets the scheduler admitted. Both are honest demonstrations of a
  feature the simulator cannot play, but neither tells you anything about
  Vega's audio policy — which remains untested.
- **Actionable suggestion:** Either configure an audio device on the VVD and
  route it to the host, or state plainly in the virtual-device documentation
  that audio output is not emulated. A line in the VVD limitations section
  would have saved this entirely. Surfacing it at runtime would be better
  still: a warning on the first `AudioPlayer` construction, or a documented
  capability query so an app can detect it rather than infer it from silence.

### 10. The Vega Virtual Device cannot decode video either

- **Task attempted:** Play a described title in the finished app on the
  virtual device.
- **Steps taken:** Built the programme as fragmented HLS, published it to S3
  with correct content types and CORS, confirmed from the host that the
  playlist fetches and that ffmpeg decodes it. On device the picture stayed
  black and the playhead stayed at zero. Added an on-screen readout of the
  media element's own state, then pointed the identical code path at
  **Apple's `img_bipbop_adv_example_fmp4` reference stream** as a control.
- **Expected result:** The reference stream to play, isolating the fault to
  our packaging.
- **Actual result:** Both fail identically, verbatim:

  ```
  ready=METADATA dur=600.0 paused=false
  err=3 "error msg[ Internal data stream error. ] debug info[ ../gstreamer-…"
  ```

  `dur=600.0` is correct for that stream, so the manifest parsed, the
  duration is known, and `play()` was accepted. The failure is in the
  decoder, for Amazon's own documented reference stream.

  Combined with entry 9 — no audio device at all — **the virtual device can
  run UI and nothing else.** It cannot play picture or sound.
- **Severity:** High, and arguably the most consequential item here. The VVD
  is presented as the way to develop without hardware, and the hackathon
  rules accept it in place of a device for the demo video. For any media app
  — which, on a television platform, is most of them — it can validate
  layout, focus and logic, and not one frame of playback.

  The diagnostics actively mislead. A developer sees a parsed manifest, a
  correct duration, `paused=false` and no exception, then a black rectangle.
  Every signal says the stream is fine. Three plausible fixes were tried
  here — lower H.264 profile, an added audio track, a master playlist — all
  wasted, because the premise that our stream was at fault was never true.
- **Workaround:** None. Verify playback on hardware, and demonstrate media
  behaviour by other means — this project renders a mixed file of the
  programme with its descriptions so the result can be heard at all.
- **Actionable suggestion:** State in the virtual-device documentation that
  media playback is not emulated, next to the statement about audio. Better,
  surface it at runtime: a `MediaError` whose message says "decoding is not
  supported on the virtual device" instead of a GStreamer internal error
  would end this in seconds rather than an evening. Best of all, emulate
  decode — a simulator for a television that cannot show a picture is a
  simulator for the one part of a TV app nobody doubts.
