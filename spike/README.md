# Runtime probes

Four probes against the assumptions the whole build rests on. Two of them can
change what gets built, so nothing else starts until `RESULTS.md` has numbers.

The probe code lives in [`../src/probes/`](../src/probes) and the harness screen
in [`../src/SpikeScreen.tsx`](../src/SpikeScreen.tsx). This directory holds the
method and the results.

## The questions

| Probe | Question | If it fails |
|---|---|---|
| **C · clock** | Real resolution and jitter of `currentTime` | Widen the margin, or run cues on a separate timebase |
| **A · usage** | Does declaring `USAGE_ACCESSIBILITY` buy concurrent playback? | **Pause-and-Describe becomes the primary mode** |
| **B · ducking** | Does the programme duck — by hand, or by itself? | Synthesise cues louder, leave the mix alone |
| **A2 · placement** | Across 10 runs, how far off target does a cue start? | Margin comes from the worst run, never the median |

Run **C first.** Concurrency results are uninterpretable if the clock is unreliable.

## What Probe A actually tests

The SDK exposes audio attributes on the `AudioPlayer` constructor:

```ts
new AudioPlayer(AudioContentType.CONTENT_TYPE_SPEECH, AudioUsageType.USAGE_ACCESSIBILITY)
```

`USAGE_ACCESSIBILITY` is the platform's own category for accessibility prompts.
On an attribute-driven audio policy that is normally what earns a stream
concurrent playback alongside media — and often automatic ducking of the media
stream, handled by the system rather than by the app.

So the question is not "can two streams play at once" but **"does declaring the
right usage make the platform do it for us."** Probe A runs the identical test
twice — once `USAGE_MEDIA`, once `USAGE_ACCESSIBILITY` — and compares.

If accessibility wins and media does not, that attribute is the unlock, manual
ducking may be unnecessary, and the app gets more device-native rather than less.

## Running

```bash
cd ..                       # repo root
npm install
npm run build:debug

vega virtual-device start
vega run-app <packageFile> com.fourkinc.gaptrack -d VirtualDevice
```

Point `index.js` at `SpikeScreen` instead of `App` while probing, then put it back.

Then repeat every probe on a physical Fire TV Stick. **The virtual device and
the stick can disagree about audio, and the stick is the one that counts.**
Label each run in `RESULTS.md`.

## Two assets you need to supply

Local files, not URLs — a network fetch would put bandwidth jitter inside the
timing being measured. Both are gitignored.

- `src/assets/clip.mp4` — ~2 min, CC-BY, with real dialogue and real silences.
  Sintel works. Record the attribution in `assets/ATTRIBUTION.md` now.
- `src/assets/cue-1400ms.wav` — any speech around 1.4s. Say *"she folds the
  letter"* into a voice memo. Polly comes later; this probe only needs a sound
  of known length.

## The probes cannot hear

A media element will report `paused === false` while routed to a sink producing
no sound. Machine evidence — does the clock advance, does `volume` read back —
is **necessary but not sufficient**, so set the "what you heard" verdict on
screen before trusting any result.

**A machine PASS with a human FAIL is the most likely failure here**, and it is
exactly the outcome that would otherwise surface in week three.

## Recording

Fill in `RESULTS.md` as you go, and copy any thrown error **verbatim** into
`../FRICTION.md`. Exact strings are what separate a friction log that scores
from one that reads as filler, and you will not remember the wording on
20 October.
