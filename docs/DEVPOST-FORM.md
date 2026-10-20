# Devpost form — every field, paste-ready

Submission: `devpost.com/submit-to/30992-build-ship-shape-amazon-developer-hackathon`

Fields marked **[YOU]** need your own answer — I don't have the facts for them.

---

# Step 2 · Project overview

## Project name
```
The Gap Track
```

## Elevator pitch *(200 char limit)*
```
Playback-time audio description for Fire TV that provably never talks over the dialogue. Both sides of the rule are measured, so a line that will not fit is discarded.
```
*167 characters.*

## Thumbnail
A still of the admission overlay mid-decision — the arithmetic with both operands
labelled. It is the one image that states the whole project, and it is the frame
nobody else will have. 3:2, under 5MB.

---

# Step 3 · Project details

## About the project

Paste the whole of [`DEVPOST.md`](./DEVPOST.md). It is already written in
Devpost's section order (Inspiration / What it does / How we built it /
Challenges / Accomplishments / What we learned / What's next).

## Built with *(tags, up to 25)*
```
typescript  react-native  vega-os  fire-tv  amazon-polly  amazon-s3
anthropic-claude  shaka-player  hls  ffmpeg  jest  accessibility
audio-description  node.js  w3c-media
```

## "Try it out" links
```
https://github.com/4KInc/gap-track
```

---

# Step 4 · Additional info

## Upload a file
Skip. The repo has everything and the 35MB limit will not hold the described film.

## Submitter Type
**[YOU]** — Individual, unless you are entering under 4K Inc.

## Organization Name
**[YOU]** — `N/A`, or `4K Inc` if you are entering under it. Match the previous answer.

## Submitter Country of Residence
**[YOU]**

## Canada province
```
N/A
```

## Primary Track(s)
```
Fire TV
```
Already selected. Do not add others — the project only meets Fire TV's requirements.

## Code repository URL
```
https://github.com/4KInc/gap-track
```
Public, Apache-2.0, detected by GitHub and visible in the About panel.

## New or existing?
```
New
```
First commit 2026-09-20, inside the window.

## If existing, what was updated
Leave blank.

---

## Are you submitting for the AWS Builder Mini Challenge?
```
Yes
```

## Which AWS services did you incorporate and how?

```
Amazon Polly and Amazon S3, both load-bearing.

POLLY synthesises every description. It is asked for PCM rather than MP3,
and that choice is the product's safety guarantee rather than a quality
preference. An MP3's duration has to be inferred from frame headers and an
encoder may pad the final frame; PCM's duration is the sample count divided
by the sample rate, exactly. The entire project rests on one comparison:

    audioDurationMs + safetyMarginMs <= gap.durationMs

A duration that is approximately right turns that guarantee into an
estimate. Verified against live Polly: a 15-word description returned
152,444 bytes at 16 kHz mono, which is 4762.5ms from the sample count
against 4763ms reported — the only discrepancy is integer rounding. The
audio is measured back off the written file rather than the buffer in
memory, which costs one read and removes a class of bug where the bytes
measured and the bytes written are not the same.

Neural voices, Joanna by default. Measured cost: 8,690 characters for a
14.8-minute film, which is $0.14 for the film and $0.56 per described
hour.

S3 serves the programme, the description track and the preview frames as
fragmented HLS over HTTPS. This is not a convenience. Vega's media stack
will not play file:// at all (MEDIA_ERR_SRC_NOT_SUPPORTED at 0ms) and will
not play a progressive HTTPS MP4 either (decode error at 50ms). Only MSE
through a patched Shaka Player works, so origin-served fMP4 HLS is the only
path to playback. Content types are set explicitly — a playlist served as
application/octet-stream is rejected before Shaka sees it.

Both sit behind interfaces. Polly implements the same Synthesizer contract
as a local macOS `say` fallback, so the engine cannot tell them apart and
the pipeline builds without AWS credentials when needed.

DELIBERATELY NOT USED: Bedrock, Lambda, DynamoDB, CloudWatch. Claude writes
the descriptions through the Anthropic API directly; the describer sits
behind an interface so Bedrock would be a swap at that seam with nothing
above it changing. The other three would raise the service count without
doing work the pipeline needs, and a judging rubric is built to catch
exactly that.

Documented in full: https://github.com/4KInc/gap-track/blob/main/docs/AWS-INTEGRATION.md
```

---

## Are you submitting for the Open Source Mini Challenge?
```
Yes
```

## Contribution URL
```
https://github.com/4KInc/gap-track
```

## Project Repository URL
```
https://github.com/4KInc/gap-track
```

## GitHub Username
```
karanheart96
```

## What you did, how it works, why it matters

```
A new open-source project, Apache-2.0, written entirely during the
hackathon window — first commit 2026-09-20.

WHAT IT IS. A Fire TV / Vega OS player that generates audio description for
content that has none, and provably never speaks over the dialogue.

HOW IT WORKS. It inverts the caption track to find where nobody is
speaking, measures each silence, writes a line short enough to fit the one
it is aimed at, synthesises it, measures the rendered audio, then checks a
single inequality:

    audioDurationMs + safetyMarginMs <= gap.durationMs

Both sides are measurements. audioDurationMs is read back off the rendered
file; gap.durationMs comes from captions, which mark dialogue to the
millisecond. Nothing in the decision is a model's opinion about how long it
takes to say something. If the line does not fit it is discarded — not
shortened, not faded under, not played late.

The admission rule contains no model call, which is why the guarantee
survives the model being wrong.

WHY IT MATTERS. Audio description exists, and most content does not have
it, because a person has to watch the film and write every line by hand —
six to twelve minutes of work per minute of video. At the rates that
implies, a thousand-hour catalogue is on the order of a million dollars. So
description goes to content someone can justify paying for, and archive
film, independent distribution, regional broadcasting and educational
libraries go without. This pipeline described a 14.8-minute film for $0.14.

The hard part is not generating a description. It is generating one that is
safe to play, because a description that talks over the dialogue has made
the film less accessible, not more. That is the part this project solves
and the part it can prove.

REUSABLE PARTS. src/engine/ is the scheduler and admission control: no
dependencies, no knowledge of Vega, React Native or AWS, and lifts out
nearly cleanly for any player facing the same problem. The two verifier
scripts check a built track independently of the code that produced it.

RESULTS, on Sintel (Blender Foundation, CC-BY, 14.8 min, no description
anywhere it is published):

    107 silences found
     99 described
      6 declined by the describer (nothing worth saying)
      2 refused by admission (would not fit)
    512s of narration placed around 77.2s of dialogue
      0 collisions

One refusal is four words — "It settles, eye closing." — needing 1788ms in
a 1900ms gap. 138ms too long, so it does not play.

189 tests. The verification is independent of the code that produced the
track: every cue is replayed as the interval it will occupy and intersected
with speech parsed straight out of Blender's own subtitle file, so a bug
that corrupted the gap list could not also corrupt the thing checking it.
```

---

## [Optional] Feature Requests

```
1. SHIP THE MANIFEST SCHEMA WITH THE SDK — Critical.
   pkgmgr logs "Empty application icon file name for package ... It might
   not be defined in manifest." The message is right that it is not
   defined; it does not say what to define. No .toml in the installed SDK
   mentions an icon key, no manifest JSON schema ships, and no
   @amazon-devices/* package in node_modules contains one. The generated
   project ships no icon and no manifest entry, so every scaffolded app
   logs this on first install with no local source of truth for the fix.
   The icon is what a Fire TV home screen shows, so every developer meets
   this at submission time.

2. A VIRTUAL DEVICE THAT CAN PLAY MEDIA — Critical.
   The VVD has no audio output and cannot decode video, including Amazon's
   own reference stream. For any media application the emulator cannot
   demonstrate the application. This is the single largest barrier to
   building a Fire TV media app without buying hardware, and it is not
   stated in the documentation — it has to be discovered by elimination.

3. ERRORS THAT NAME THE VALUE THEY RECEIVED — Important.
   `vega device launch-app -a <package-id>` fails with "App could not be
   determined", naming neither the identifier it got nor the one it wanted
   (the component id). The phrasing points at the install rather than the
   argument, which is the wrong place to look.

4. A SUPPORTED PATH TO MSE PLAYBACK — Important.
   Playing video at all requires vendoring and patching Shaka Player from a
   sample repository, via a build script that assumes `kepler` on PATH, a
   `python` binary macOS no longer ships, and an undocumented JDK. A
   supported package would remove a day of work from every media project.

5. CORRECT THE DOCUMENTED PREREQUISITES — Nice-to-have.
   The macOS prerequisites list Homebrew, Rosetta 2 and nine packages. The
   installer's own gate requires curl, tar and jq, and the whole toolchain
   installs and builds without sudo. The current list wrongly tells
   developers without admin rights that they cannot start.
```

---

## [Optional] Friction Log  ← **the 10% bonus**

```
https://github.com/4KInc/gap-track/blob/main/FRICTION.md
```

Twelve entries, each with the task attempted, steps taken, expected vs
actual result, severity, workaround and a suggested fix. Every one measured
on this machine during this build, with exact error text. Nothing
reconstructed.

---

## [Optional] Project Testing Link
Leave blank. Add the YouTube URL here too if you want judges to reach it from
this step as well as the video field.

## Testing instructions

```
No credentials needed. Everything the judges need is in the repo.

  git clone https://github.com/4KInc/gap-track && cd gap-track
  npm install
  npm run demo:assets    # fetches Sintel + captions (CC-BY, not in repo)
  npm run demo:verify    # the central claim, checked against the captions
  npx jest               # 189 tests

demo:verify re-checks the built description track independently of the code
that produced it, and prints:

    99 cues across 14.8 min
    admitted        99/99
    overlapping     0
    outside its gap 0
    512s of narration, 77.2s of dialogue, 0 collisions

To run the app on the Vega Virtual Device:

  npm run build:release
  vega virtual-device start --gui
  vega device install-app -p build/.../gaptrack_aarch64.vpkg
  vega device launch-app -a com.fourkinc.gaptrack.main

IMPORTANT, PLEASE READ: the Vega Virtual Device cannot decode video and has
no audio output — not for our streams and not for Apple's own reference
stream, which is how we established it is the device rather than our
packaging (FRICTION.md entries 9 and 10). On the emulator the app therefore
shows preview stills advanced by the playhead, and says so on screen. Every
decision, measurement and refusal is real; only the picture is substituted,
and the substitution is labelled rather than hidden.

To hear the actual result, play build/demo/sintel-described.mp4 after
running demo:assets — that is the real film with the generated narration
mixed in.
```

---

# Feedback questions

## 1 · Which developer tools, APIs, and SDKs did you use and for what?

```
VEGA SDK 0.24.12044 / Vega Developer Tools — project generation, building,
and the Vega Virtual Device.

REACT NATIVE FOR VEGA 0.83 (@amazon-devices/react-native-kepler) — the whole
application: library, player, D-pad focus via VegaFocusManager.

@amazon-devices/react-native-w3cmedia 2.3.2 — media playback. VideoPlayer,
AudioPlayer with AudioContentType/AudioUsageType, KeplerVideoSurfaceView.
Two elements at once: the programme and the description track.

@amazon-devices/kepler-media-controls — transport controls.

SHAKA PLAYER, Amazon-patched, vendored from AmazonAppDev/vega-video-sample —
required, because MSE is the only path to playback on Vega.

AMAZON POLLY (@aws-sdk/client-polly) — speech synthesis, PCM output so the
duration is exact.

AMAZON S3 — origin for fragmented HLS: programme, description track,
preview frames.

ANTHROPIC API (@anthropic-ai/sdk, claude-opus-5) — writes each description
from sampled frames plus surrounding dialogue, under a word budget derived
from the measured silence. Vision plus structured outputs.

FFMPEG (ffmpeg-static) — frame extraction, HLS packaging, and mixing the
described film.

JEST + @testing-library/react-native — 189 tests, including a full
14.8-minute playthrough of the real manifest at the device's tick rate.
```

## 2 · What worked well?

```
VEGA SDK INSTALLER. Installed cleanly on a managed macOS machine with no
admin rights, no Homebrew and no Rosetta — despite documentation saying all
three were required. NONINTERACTIVE=true worked exactly as expected.

REACT NATIVE FOR VEGA. Standard React Native with Fabric and TurboModules.
Hot reload, Metro, and the usual tooling all behaved. If you know React
Native you are productive immediately, which is the strongest argument for
the platform.

THE W3C MEDIA API SHAPE. Modelling media as HTMLMediaElement means existing
knowledge transfers directly, and AudioPlayer being a distinct class with
its own volume is what made ducking straightforward.

VEGAFOCUSMANAGER. Once the ordering requirement was understood, D-pad focus
was reliable and predictable.

THE VIRTUAL DEVICE FOR UI WORK. For everything that is not media, the VVD
is fast, stable, and removed any need to buy hardware. The GUI mode with
the on-screen remote is genuinely good.

ESLINT-PLUGIN-KEPLER. The system-distributed-library warnings are a real
service — they flag a class of mistake that would otherwise surface at
runtime on a device.

AMAZON POLLY. Correct on the first call, and PCM output made exact
measurement trivial. Neural voice quality is well suited to description:
flat and unhurried rather than performed.
```

## 3 · What needs work?

```
THE VIRTUAL DEVICE CANNOT PLAY MEDIA. No audio output, and video does not
decode — not our streams, and not Amazon's own reference stream, which is
how we know it is the device. For a media application this means the
emulator cannot demonstrate the application. Neither limitation is
documented; both have to be found by elimination. This is the single
largest problem on the platform for anyone building media without hardware.
(FRICTION.md 9, 10.)

PLAYBACK REQUIRES MSE AND NOTHING SAYS SO. file:// fails at 0ms with
SRC_NOT_SUPPORTED; a progressive HTTPS MP4 fails at 50ms with a decode
error. The only working path is a patched Shaka Player, vendored from a
sample repo. This is the most important fact about media on Vega and it is
not in the media documentation. (FRICTION.md 5.)

THE SHAKA BUILD PATH IS FRAGILE. The script assumes `kepler` on PATH and a
`python` binary macOS has not shipped since 12.3, and needs a JDK that is
mentioned nowhere — the failure arrives 45 patches in, after several
minutes of apparent success. (FRICTION.md 7, 8.)

LICENCE HEADERS CONTRADICT THE REPOSITORY. Every file you must copy out of
the MIT-0 vega-video-sample carries a PROPRIETARY/CONFIDENTIAL header. A
developer doing licence diligence has to decide whether the repo licence or
the file header governs, for the one file they cannot avoid copying.
(FRICTION.md 6.)

DOCUMENTED RN VERSION IS WRONG. Docs say 0.72; SDK 0.24 generates 0.83.
That pin was correct for SDK 0.22. (FRICTION.md 2.)

`scalingmode` IS MISSPELLED in the public surface-view API — it should be
scalingMode to match every other prop. It cannot be fixed without a
breaking change, which is an argument for fixing it soon. (FRICTION.md 3.)

NO MANIFEST SCHEMA SHIPS. pkgmgr warns about an undefined app icon and no
.toml, JSON schema or package in the SDK names the key. (FRICTION.md 12.)

ERRORS DO NOT NAME THEIR INPUTS. launch-app's "App could not be determined"
names neither the id it received nor the one it wanted. (FRICTION.md 11.)

THE MEDIA PLAYER FAQ IS A STUB. It answers none of: concurrent audio
playback, per-element gain, or playhead clock resolution. All three are
load-bearing for any media app and all three had to be established by
writing probes.
```

## 4 · How was your onboarding experience?

```
Zero to a built package: good. Zero to playing a video: hard.

The installer worked first time on a locked-down machine, and the generated
React Native project built and ran on the virtual device within an hour.
For a brand-new platform that is a strong start, and the prerequisites
being overstated was a pleasant failure rather than a blocker once the
installer script was read directly.

The wall is media. "Hello world" for a media app is a frame of video on
screen, and reaching it took days rather than hours, because:

  - the documented approach (a src on a media element) does not work
  - the error (SRC_NOT_SUPPORTED at 0ms) does not suggest the cause
  - the actual requirement, MSE via a patched Shaka Player, is in a sample
    repository rather than the documentation
  - building that player fails on three undocumented environment
    assumptions in sequence
  - and when all of it is finally correct, the virtual device still shows
    black, because it cannot decode

That last point is what made it genuinely hard. Every failure looks like
your own bug until you run the control — Amazon's own reference stream
through the identical code path — and watch it fail too. We lost time to
three wrong hypotheses before running that control, and it settled the
question in five minutes. One line in the documentation saying the VVD
cannot decode video would have saved all of it.
```

## 5 · Would you build with these devices and services again?

```
Yes — with one condition.

React Native for Vega is a genuinely good application platform. Standard
React Native, modern version, Fabric and TurboModules, and a focus system
that works once you understand it. The virtual device is excellent for
everything that is not media, which is most of an app. Polly and S3 did
exactly what they should and the W3C media shape means existing knowledge
transfers.

The condition is hardware. Not because the emulator is poor in general —
for UI it is very good — but because a media app cannot be validated on a
device that cannot decode media. We built the entire project without a Fire
TV stick and the engineering is sound, but the demo has to carry a caveat
that nothing in our code caused. We would buy the device first next time.

The platform's real problem is not capability, it is that its hardest
constraints are undocumented. Every day lost was spent establishing
something that could have been one sentence in the docs. That is fixable,
and it is why the friction log in this submission is twelve entries long
and written to be acted on rather than to complain.
```

---

# Final section

## AI tools leveraged
```
Claude Code (Claude Opus) for development throughout, and the Anthropic API
(claude-opus-5) as a runtime component — it writes every description from
sampled frames and surrounding dialogue, under a word budget derived from
the measured silence.
```

## Level of learning
**[YOU]** — a dropdown. Pick honestly.

## Did you gain AI value for your career?
**[YOU]** — a dropdown.

## Age / jurisdiction / not-an-employee checkboxes
**[YOU]** — tick if true.

---

# Still outstanding

- [ ] **Demo video** — under 3:00, public on YouTube, English. See [`DEMO.md`](./DEMO.md).
- [ ] Thumbnail image (3:2, under 5MB)
- [ ] The **[YOU]** fields above
