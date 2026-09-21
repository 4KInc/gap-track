# Architecture

## The constraint that shapes everything

A Fire TV app cannot read another app's video or audio — Prime Video and Netflix
output is DRM-protected and there is no system-wide overlay. So the app **is the
player**, with its own library. That is not a compromise: content without a
commissioned description track is exactly the content this serves.

## Lookahead, not reaction

A vision call plus synthesis takes seconds. Starting when a gap starts is always
too late.

So the player works **20–30 seconds ahead of the playhead**. Latency stops being
a race and becomes a buffer, with a graceful failure mode: an underrun means
silence, which is what the viewer has today.

Start at 10–20 seconds, measure on hardware, extend only once the numbers justify it.

## Pipeline

Each stage runs on a rolling window ahead of the playhead.

1. **Map the gaps** — VAD over the audio track finds every stretch ≥1.2s with no
   speech. Deterministic, no model. This measurement is what everything
   downstream is checked against.
2. **Sample the scene** — frames from the seconds *preceding* the gap. What needs
   describing is usually what just changed.
3. **Write to a word budget** — gap duration sets a hard budget at ~2.5 words per
   second. At the tight end the problem is *selection*, not compression: with
   three words, an entrance and a reaction and an object on a table are mutually
   exclusive, and choosing needs recent dialogue as context.
4. **Synthesise and measure** — Polly renders the line; the generated asset is
   measured. This is the step that turns a guess into a number.
5. **Admit or drop** — `ttsDuration + margin <= gapDuration`. One comparison.
6. **Play under the scene** — cue on a second audio element, programme ducked
   beneath it, restored on completion.

## Where it runs

| Component | Runs on |
|---|---|
| Playback, library, D-pad navigation | Device |
| Cue scheduler and admission control | Device |
| Second audio element, ducking | Device |
| Gap map (VAD) | Cloud |
| Frame sampling and description | Cloud |
| Synthesis and measurement | Cloud |
| Cue cache | Cloud |

**The device never decodes a frame for analysis.** It sends a playhead position;
the backend already has the media URL. This removes the one genuinely uncertain
platform capability — whether the hardware video pipeline hands decoded frames
back to JavaScript — from the critical path entirely.

## What the scheduler must survive

| Event | Behaviour |
|---|---|
| Seek | Flush queue, drop everything unplayed, enter cue-buffering until the window rebuilds |
| Pause | Stop scheduled narration, cancel cues in flight |
| Short rewind | Do not replay a cue already heard unless past a defined threshold |
| Rate change | Gaps shrink with speed; every admission decision is invalid. Disable cues above 1x in v1 |
| Late cloud response | Discard. A cue that misses its window is never played at the next one |
| Synthesis failure | Skip silently. Never substitute an untimed fallback |
| Network loss | Serve from cache if present, else stay silent. No error over playback |
| Scene not understood | Prefer silence to a vague or invented line |

## How the viewer turns it on

W3C `audioTracks` is a **read-only list of tracks inside the media resource** —
`AudioTrackList` has no way to add one, so a cue stream synthesised at playback
time cannot be registered as a platform audio track. The Vega Media Controls
`AudioTracks` capability lets a viewer switch between tracks the content already
carries; it does not let an app invent one.

So: a Fire TV-native accessibility setting, reachable by remote, persisted per
viewer.

```
Accessibility
  Audio Description
    Off
    Adaptive Description
    Pause-and-Describe
```

Vega Media Controls still supplies transport — Play, Pause, Stop,
TogglePlayPause always; StartOver, Previous, Next, SkipForward, SkipBackward by
opt-in. The vocabulary is fixed; custom intents are not registrable.

## Platform facts, verified 20 Sep 2026

- React Native for Vega is pinned to **0.83** (SDK 0.24; the 0.72 pin applied to SDK 0.22) with Fabric and TurboModules
- Media is the W3C Media API via `@amazon-devices/react-native-w3cmedia`, over GStreamer
- `HTMLAudioElement` exists as a class distinct from the video element, with its own standard `volume`
- The Vega Virtual Device needs no hardware; a physical stick is still required for real performance testing
- Vega Media Controls ships as `@amazon-devices/kepler-media-controls`
- **Playback requires MSE.** A progressive `src` — including a packaged
  `file://` asset — is rejected with `MEDIA_ERR_SRC_NOT_SUPPORTED` at 0ms.
  Media must be fed through `MediaSource` + `appendBuffer`; the official sample
  ports Shaka Player to do it. Verified on device, not inferred.

Unverified and load-bearing: concurrent audio playback, per-element gain,
playhead clock resolution. The media player FAQ is a stub and answers none of
them. See [`../spike/`](../spike).
