# Runtime probes

Four probes against three questions. Everything else in the project waits on
these answers, because two of the three change what gets built.

Delete this directory once the answers are in `RESULTS.md`.

## The questions

| Probe | Question | If it fails |
|---|---|---|
| **C · clock** | What is the real resolution of `currentTime`, and how much does it jitter? | Widen the margin, or schedule cues on their own timebase seeded from the playhead |
| **A · concurrent** | Can a cue element sound while video audio plays? | **Pause-and-Describe becomes the primary mode.** The product still ships |
| **B · ducking** | Can programme volume drop independently while a cue plays? | Synthesise cues louder, leave the mix alone |
| **A2 · placement** | Across 10 runs, how far off target does a cue actually start? | Margin comes from the worst run, never the median |

Run **C first.** Concurrency results are uninterpretable if the clock is unreliable.

## Setup

```bash
# 1. Scaffold, if you haven't
vega init gap-track-spike && cd gap-track-spike

# 2. Drop these files in
cp -r /path/to/spike/src ./src

# 3. Two local assets — local, not remote. Network jitter would land inside
#    the timing you are measuring.
mkdir -p assets
#   assets/clip.mp4        ~2 min, CC-BY, with real dialogue and real silences.
#                          Sintel works. Note the attribution now, not in week four.
#   assets/cue-1400ms.wav  any speech ≈1.4s. Say "she folds the letter" into
#                          a voice memo. Polly comes later; this probe only
#                          needs a known-length sound.

# 4. Run
vega virtual-device start
vega run-app <vpkg-path> <app-id> -d VirtualDevice
```

Then repeat every probe on a physical Fire TV Stick. **The VVD and the stick can
disagree about audio, and the stick is the one that counts.** Label each run in
`RESULTS.md` accordingly.

## Before you run: confirm two imports

`src/SpikeScreen.tsx` imports `VideoPlayer` and `KeplerVideoView` from
`@amazon-devices/react-native-w3cmedia`. Amazon's docs show those names, and
also document an `HTMLAudioElement` class, but the export surface moves between
SDK versions.

Open `node_modules/@amazon-devices/react-native-w3cmedia`, match the real names,
fix the import, and delete the `TODO(confirm)` comments. If `HTMLAudioElement`
turns out to be the right handle for the cue element, use it — it is the more
honest fit, and its own `volume` property is what Probe B needs.

## The probes cannot hear

This is the important caveat and the reason Probe A returns two verdicts.

A media element will report `paused === false` while routed to a sink producing
no sound. Machine evidence — does the clock advance, does `volume` read back —
is **necessary but not sufficient**. So set the "what you heard" verdict on
screen before trusting any result.

**A machine PASS with a human FAIL is the most likely failure here**, and it is
precisely the outcome that would otherwise surface in week three.

## Recording results

Every run appends to `RESULTS.md`. Copy any thrown error **verbatim** — exact
strings are what separate a friction log that scores from one that reads as
filler, and you will not remember the wording on 20 October.

## What the answers unlock

```
Probe C  ─→  the safety margin, as a measured number rather than a guess
Probe A  ─→  Adaptive Description as primary, or Pause-and-Describe as primary
Probe B  ─→  ducking, or louder cues
Probe A2 ─→  the margin's floor: worst run × 1.5, never the median
```

Once these four lines have numbers in them, the engine phase can start and the
build plan's first gate is met: *a cue lands in a silence on real hardware.*
