# Architecture

## The constraint that shapes everything

A Fire TV app cannot read another app's video or audio — Prime Video and Netflix
output is DRM-protected and there is no system-wide overlay. So the app **is the
player**, with its own library. That is not a compromise: content without a
commissioned description track is exactly the content this serves.

## Build time, not playback time

The original design generated descriptions on a rolling 20–30 second window
ahead of the playhead, so a vision call plus synthesis would be absorbed as
buffer rather than raced against the gap.

**That is not what this does.** Descriptions are built ahead of playback by a
pipeline and shipped as a timeline-aligned audio track, for three reasons found
while building it:

- A description is the same every time the film plays. Generating it per
  playback pays the cost repeatedly for an identical result, and makes a
  viewer's experience depend on their network.
- Admission needs the *measured* duration of rendered audio. Measuring is cheap
  at build time and a latency spike at playback time.
- A track that already exists can be verified before anyone watches it. A track
  generated live cannot — and "never talks over dialogue" is a claim worth
  checking before shipping, not after.

The live path kept the part that must be live: the same admission rule runs
again at playback against the real playhead, so seeking, pausing and rate
changes cannot strand a cue into dialogue it was cleared against.

## Pipeline

```
captions ──► gaps ─────────────────────┐    invert the dialogue
video ─────► frames across each gap ──┐│
                                      ▼▼
                              Claude (Anthropic API)
                        writes to a word budget, or declines
                                      │
                                      ▼
                        Polly ── PCM, duration is exact
                                      │
                                      ▼
                       measure the rendered audio file
                                      │
                                      ▼
                              ADMISSION  ← no model
                                      │
                                      ▼
                    fMP4 HLS description track ──► S3
```

1. **Map the gaps** — invert the caption track. Captions mark *dialogue*
   specifically, so a passage carried by music correctly reads as describable
   where an energy threshold would refuse it for being loud. VAD remains the
   fallback for content with no captions, and is second choice for exactly that
   reason. Gaps longer than 8s are subdivided: a two-minute silence is not one
   description, it is several.
2. **Sample the scene** — frames across the gap, plus the dialogue immediately
   before it. With a budget of three words, choosing between an entrance, a
   reaction and an object on a table is a question about what the scene just
   established, not about the frame.
3. **Write to a word budget** — the measured silence sets a hard ceiling at
   `WORDS_PER_SECOND` (2.6, calibrated against 98 rendered descriptions; the
   measured median was 3.10 and this sits under the p10 deliberately). On a miss
   it retries once naming the overage, then declines. It never truncates.
   Declining is first-class.
4. **Synthesise and measure** — Polly renders the line as PCM; the duration is
   read back off the written file. This is the step that turns a guess into a
   number.
5. **Admit or drop** — `audioDurationMs + safetyMarginMs ≤ gap.durationMs`. One
   comparison, no model.

## Where it runs

| Component | Runs on |
|---|---|
| Gap mapping, description, synthesis, measurement | Build machine |
| Admission at build time | Build machine |
| Programme, description track, preview frames | S3 |
| Playback, library, D-pad navigation | Device |
| Cue scheduler and admission at playback | Device |
| Second audio element, ducking | Device |

**The device never decodes a frame for analysis.** It plays a track that already
exists. This removes the one genuinely uncertain platform capability — whether
the hardware video pipeline hands decoded frames back to JavaScript — from the
critical path entirely.

## What the scheduler must survive

| Event | Behaviour |
|---|---|
| Seek | Invalidate everything unplayed; a cue in flight is cut |
| Pause | Stop narration, cancel cues in flight |
| Short rewind | Do not replay a cue already heard unless past `replayThresholdMs` |
| Rate change | Gaps shrink with speed; every admission decision is invalid. Cues disabled above 1x |
| Arriving mid-gap | Admit only if the cue can still *finish* — the question is completion, not punctuality |
| Adjacent gaps | Admission judges one cue at a time, so a later cue that would overlap an earlier one is demoted rather than played |
| Synthesis failure | Skip silently. Never substitute an untimed fallback |
| Scene not understood | Prefer silence to a vague or invented line |

## How the viewer turns it on

W3C `audioTracks` is a **read-only list of tracks inside the media resource** —
`AudioTrackList` has no way to add one, so a description track supplied
alongside the programme cannot be registered as a platform audio track. The Vega
Media Controls `AudioTracks` capability lets a viewer switch between tracks the
content already carries; it does not let an app invent one.

So the app supplies its own control, reachable by remote:

```
Audio Description
  Off
  Adaptive Description     narration over a ducked programme
  Pause and Describe       programme held while the line is spoken

Safety margin
  250ms · 750ms · 1500ms · 3000ms
```

The margin is exposed because it is the only constant in the admission rule that
is a preference rather than a measurement. Raising it buys distance from the
dialogue and costs descriptions, and the overlay shows which ones and why.

## Verification

Two checks, both independent of the code that produced the track:

- `scripts/verify-track.ts` re-decides every cue against the engine: admitted at
  the instant its gap opens, no two able to sound at once, each inside its own
  gap with the margin intact.
- `scripts/verify-no-overlap.ts` replays each cue as the interval it will occupy
  and intersects it with speech parsed straight out of the caption file — so a
  bug that corrupted the gap list could not also corrupt the thing checking it.

On Sintel: 99 cues, 512s of narration around 77.2s of dialogue, 0 collisions.

`test/player/playthrough.spec.ts` drives the real manifest through the real
player at the device's 50ms tick for the full 14.8 minutes and asserts the same
property against the captions.

## Platform facts, verified on this machine

- React Native for Vega is pinned to **0.83** (SDK 0.24; the 0.72 pin applied to
  SDK 0.22) with Fabric and TurboModules
- Media is the W3C Media API via `@amazon-devices/react-native-w3cmedia`, over
  GStreamer
- `HTMLAudioElement` exists as a class distinct from the video element, with its
  own standard `volume`
- Vega Media Controls ships as `@amazon-devices/kepler-media-controls`
- **Playback requires MSE and fragmented HLS.** A `file://` asset is rejected
  with `MEDIA_ERR_SRC_NOT_SUPPORTED` at 0ms; a progressive HTTPS MP4 fails at
  50ms with a decode error. Media must go through `MediaSource` + `appendBuffer`
  via a patched Shaka Player
- **The Vega Virtual Device has no audio output and cannot decode video** — not
  for our streams and not for Apple's reference stream, which is how we know it
  is the device rather than our packaging

See [`../FRICTION.md`](../FRICTION.md) for each of these with the exact error
text, and [`../spike/`](../spike) for the probes that established them.
