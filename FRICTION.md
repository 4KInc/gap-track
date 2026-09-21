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

### 5. A packaged local file cannot be played with `src`; MSE is mandatory, and nothing says so

- **Task attempted:** Play a short bundled `.mp4` and `.wav` from app assets, to
  measure playhead behaviour and concurrent audio.
- **Steps taken:** Resolved the packaged URIs with
  `Image.resolveAssetSource(require('./assets/clip.mp4'))`, which returned
  `file:///pkg/bundle/assets/src/assets/clip.mp4`. Confirmed both files are in
  the build output at that exact relative path and at full size (4,999,379 and
  99,176 bytes). Assigned `player.src = uri`, called `player.load()`, then
  polled `readyState`.
- **Expected result:** `readyState` reaching `HAVE_METADATA`, a real `duration`,
  and a `currentTime` that advances on `play()`.
- **Actual result:** The element errors **immediately**, at 0ms, before any
  fetch or decode could have occurred:
  `error: code=4 (SRC_NOT_SUPPORTED) msg=""`, with `duration=NaN` and
  `readyState=0 (HAVE_NOTHING)`. The message string is empty, so the error
  carries no indication of *what* about the source was unsupported — scheme,
  container, or codec.

  The failure is silent in the worst way: `play()` still resolves and `paused`
  still flips to `false`, so an app looks like it is playing. The only symptoms
  are a black surface and a `currentTime` frozen at 0 — which read as a decode
  or rendering problem and send you looking in the wrong subsystem.
- **Severity:** High. It blocks the most obvious first thing any developer
  tries — play a bundled asset — and the diagnostics actively mislead.
- **Workaround:** Feed the player through Media Source Extensions instead. The
  official [vega-video-sample](https://github.com/AmazonAppDev/vega-video-sample)
  ports Shaka Player for exactly this, and every example in the
  `react-native-w3cmedia` README uses `MediaSource` + `addSourceBuffer` +
  `appendBuffer` for both video and audio. That is a strong implicit signal,
  but it is never stated as a requirement.
- **Actionable suggestion:** Say plainly in the W3C Media API overview that
  progressive `src` assignment is not supported and MSE is required, ideally in
  the first paragraph. Populate `MediaError.message` with the reason — "scheme
  not supported", "use MediaSource" — so the failure is self-describing. Better
  still, have `src` assignment of an unsupported scheme throw synchronously
  rather than resolving `play()` and leaving the app apparently playing.
