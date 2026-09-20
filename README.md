# The Gap Track

**Playback-time audio description for Fire TV — that stops itself rather than talk over the dialogue.**

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com).
Primary track: **Fire TV / Vega OS**. Mini challenges: **AWS Builder**, **Open Source**.

---

## The problem

If you can't see the screen you get the dialogue and the sound effects, and you
miss everything that happens silently. A character reads a letter and their face
changes. Someone pockets a knife. A car pulls up outside. None of it is in the
audio, so the story stops making sense.

Audio description fixes it with a second voice speaking in the pauses between
lines. Today a person writes those lines — watching the film, finding each gap,
timing it, writing something that fits. That costs **$15–30 per finished minute**
and up to $75 for feature film, because a describer needs six to twelve minutes
of work per minute of video.

Netflix describes roughly 40% of its library. Everyone smaller describes none of
it: a thousand-hour catalogue is $900,000 at the cheapest professional rate.
Archive film, independent distributors, regional and community broadcasters,
educational libraries — all publishing to the Fire TV Appstore, none of them able
to pay for it.

## What this is

A Fire TV player that writes the description itself, at playback time, for video
nobody has ever described.

It runs ahead of the playhead, finds and **measures** the pauses in the dialogue,
looks at what is on screen, writes a line short enough to fit the pause it is
aimed at, synthesises the speech, and then checks the arithmetic.

```
admit cue  ⟺  ttsDuration + safetyMargin ≤ measuredGap
```

If it fits, it plays. If it doesn't, **the line is discarded** — not shortened,
not faded under, not played late.

## Why that rule is the point

The failure that would ruin this isn't a mediocre description. It's one that
talks over the dialogue: now the viewer has lost the line they could hear *and*
didn't get the picture.

So the model never decides whether to speak. It writes to a word budget derived
from a measured gap. A scheduler compares two numbers. Late, long, or malformed
cues all take the same path — dropped, with the reason logged.

The model proposes. The scheduler disposes.

## Status

> **Pre-spike.** Three runtime assumptions are unverified and everything waits on
> them. See [`spike/`](./spike) — nothing else gets built until `spike/RESULTS.md`
> has numbers in it.

| Question | Status | If it fails |
|---|---|---|
| Can a cue element sound while video audio plays? | unverified | Pause-and-Describe becomes the primary mode |
| Can programme volume duck independently? | unverified | Synthesise cues louder, leave the mix alone |
| What is the real resolution of `currentTime`? | unverified | Widen the margin, or use a separate timebase |

## Two modes

**Adaptive Description** — narration plays inside verified dialogue-free gaps.
Cues that cannot fit are skipped silently.

**Pause-and-Describe** — for content with no usable gaps (lectures, documentaries,
dense dialogue) the player pauses at a scene boundary, speaks, and resumes. Costs
flow, safe by construction: a paused programme has no dialogue to mask.

Both run through the same scheduler, so the guarantee holds either way.

## Architecture

```
Fire TV / Vega OS app
  │  playhead + lookahead window
  ▼
Gap scheduler · admission control          ← deterministic, no model
  │                        ▲
  │ visual context         │ measured audio duration
  ▼                        │
Amazon Bedrock ──────► Amazon Polly
  (word-budgeted           (synthesis; the asset is
   candidate line)          measured, not estimated)
  │
  ▼
Amazon S3 — cue cache, keyed by media hash + timestamp
```

The device never decodes a frame for analysis. It sends a playhead position; the
backend already has the media URL.

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and
[`docs/AWS-INTEGRATION.md`](./docs/AWS-INTEGRATION.md).

## Getting started

Requires the Vega SDK (macOS or Linux; Windows is not supported).

```bash
# Prerequisites
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
[[ $(arch) == "arm64" ]] && softwareupdate --install-rosetta --agree-to-license
brew update && brew install binutils coreutils gawk findutils grep jq lz4 gnu-sed watchman

# Vega Developer Tools (close VS Code first)
curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash && source ~/vega/env
vega --version

# Run on the virtual device
vega virtual-device start
vega run-app <vpkg-path> <app-id> -d VirtualDevice
```

## Demo content

Blender Foundation open movies (CC-BY). Attribution is carried in-app and in
[`assets/ATTRIBUTION.md`](./assets/ATTRIBUTION.md). No third-party copyrighted
material appears anywhere in this repository or the demo video.

## Licence

Apache-2.0. See [LICENSE](./LICENSE).
