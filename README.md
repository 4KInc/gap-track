# The Gap Track

**Playback-time audio description for Fire TV — that stops itself rather than talk over the dialogue.**

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com).
Primary track: **Fire TV / Vega OS**. Mini challenges: **AWS Builder**, **Open Source**.

---

## The problem

If you cannot see the screen you get the dialogue and the sound effects, and you
miss everything that happens silently. A character reads a letter and their face
changes. Someone pockets a knife. A car pulls up outside. None of it is in the
audio, so the story stops making sense.

Audio description fixes that with a second voice speaking in the pauses between
lines. Today a person writes those lines — watching the film, finding each gap,
timing it, writing something that fits — which takes six to twelve minutes of
work per minute of video. Commercial description is priced per *finished minute*
and is widely quoted in the $15–30 range.

At that rate a thousand-hour catalogue costs on the order of a million dollars.
So the content that gets described is the content someone can justify paying to
describe, and everything else — archive film, independent distribution, regional
and community broadcasting, educational libraries — goes undescribed. Not
because the technology is missing, but because the economics never close.

For comparison, this pipeline described a 14.8-minute film for **$0.13**, a
measured **$0.53 per described hour**.

## What this is

A Fire TV player that writes the description itself, for video nobody has ever
described.

It finds and **measures** the pauses in the dialogue, looks at what is on screen,
writes a line short enough to fit the pause it is aimed at, synthesises the
speech, measures the rendered audio, and then checks one inequality:

```
admit cue  ⟺  audioDurationMs + safetyMarginMs ≤ gap.durationMs
```

If it fits, it plays. If it does not, **the line is discarded** — not shortened,
not faded under, not played late.

## Why that rule is the point

Both sides of that comparison are measurements, not estimates.

`audioDurationMs` is read back off the rendered audio file — sample count over
sample rate — never a words-per-minute guess. `gap.durationMs` comes from the
caption track, which marks dialogue to the millisecond. Nothing in the decision
is a model's opinion about how long it takes to say something.

That is what makes "never talks over dialogue" a guarantee rather than a hope. A
system that estimated would be right most of the time, and the times it was
wrong would be exactly the moments the viewer needed.

The arithmetic is shown on screen, with both operands labelled, so the claim can
be checked rather than trusted.

## Results, on a real film

[Sintel](https://durian.blender.org) — 14.8 minutes, Blender Foundation, CC-BY,
no audio description anywhere it is published.

```
107 silences found
 99 described
  6 declined by the describer   (nothing worth saying)
  2 refused by admission        (would not fit)

512s of narration placed around 77.2s of dialogue
  0 collisions
```

One of the two refusals is four words long — *"It settles, eye closing."* —
needing 1788ms in a 1900ms gap. 138ms too long, so it does not play.

Verified two ways, independently of the code that built it:

```bash
npm run demo:assets   # fetch the film and captions (CC-BY, not in the repo)
npm run demo:verify   # both checks against the built track
```

The first re-checks every cue against the engine. The second replays each cue as
the interval it will occupy and intersects it with the speech intervals parsed
straight out of the caption file — so a bug that corrupted the gap list could
not also corrupt the thing checking it.

The safety margin is adjustable in the app, because it is the one constant in
the rule that is a preference rather than a measurement. Raising it buys
distance from the dialogue and costs descriptions:

| Margin | Plays | Refused | Narration |
|---|---|---|---|
| 250ms | 99 | 0 | 512s |
| 750ms | 97 | 2 | 500s |
| 1500ms | 86 | 13 | 438s |
| 3000ms | 18 | **81** | 78s |

At three seconds the engine goes almost completely quiet rather than crowd the
dialogue.

## Architecture

Description is built by a pipeline, ahead of playback. The app schedules and
plays what the pipeline produced, and applies the same admission rule again at
playback time against the live playhead.

```
BUILD TIME (pipeline/)
  captions ──► gaps ──────────────────────┐   invert the dialogue
  video ─────► frames at each gap ──┐     │
                                    ▼     ▼
                            Claude (Anthropic API)
                       writes to a word budget, or declines
                                    │
                                    ▼
                            Amazon Polly  (PCM, so duration is exact)
                                    │
                                    ▼
                          measure the rendered audio
                                    │
                                    ▼
                          ADMISSION  ← deterministic, no model
                                    │
                                    ▼
                    fMP4 HLS description track ──► Amazon S3

PLAYBACK (src/)
  programme clock ──► scheduler ──► admission ──► description track
                                        │
                                        ▼
                                  trust overlay
                          (the arithmetic, both operands)
```

Admission is pure arithmetic over measured values and contains no model call,
which is why the guarantee survives the model being wrong.

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and
[`docs/AWS-INTEGRATION.md`](./docs/AWS-INTEGRATION.md).

## AWS

**Polly** synthesises every description, as PCM rather than MP3 so the duration
is exact rather than inferred from frame headers. **S3** serves the programme,
the description track and the preview frames as fragmented HLS — the only media
shape Vega will play (see [`FRICTION.md`](./FRICTION.md) entry 5).

Bedrock is deliberately not used: Claude is reached through the Anthropic API
directly. The describer sits behind an interface, so Bedrock would be a swap at
that seam with nothing above it changing. Lambda, DynamoDB and CloudWatch are
left out for the same reason — they would raise the service count without doing
work the pipeline needs.

## Getting started

Requires the Vega SDK (macOS or Linux; Windows is not supported).

The documented prerequisites are overstated. The installer hard-requires only
**curl, tar and jq**, and needs no `sudo`, no Homebrew and no Rosetta 2 — this
was measured, and is [`FRICTION.md`](./FRICTION.md) entry 1.

```bash
# SDK
curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash
source ~/vega/env && vega --version

# Build and run
npm install
npm run build:release
vega virtual-device start --gui
vega device install-app -p build/.../gaptrack_aarch64.vpkg
vega device launch-app -a com.fourkinc.gaptrack.main   # the COMPONENT id
```

`launch-app` wants the component id, not the package id, and says neither when
it refuses — [`FRICTION.md`](./FRICTION.md) entry 11.

### Building a description track

```bash
export ANTHROPIC_API_KEY=...
npx tsx pipeline/cli.ts \
  --video film.mp4 --captions film.srt --title myfilm \
  --out build/tracks --publish <s3-bucket> --transcode --mix
```

`--synth say` substitutes macOS speech for Polly, to work without AWS
credentials. `--dry` checks gaps and timing without calling any model.

## A note on the virtual device

The Vega Virtual Device has no audio output and cannot decode video — not for
our streams and not for Amazon's own reference stream, which is how we know it
is the device rather than our packaging ([`FRICTION.md`](./FRICTION.md) entries
9 and 10).

So on the emulator the app shows preview stills advanced by the playhead, and
**says so on screen**. Every decision, measurement and refusal is real; only the
picture is substituted, and the substitution is labelled rather than hidden.

## Friction log

[`FRICTION.md`](./FRICTION.md) — 12 entries, every one measured on this machine
during this build, with the exact error text and a suggested fix. Nothing in it
is reconstructed or assumed.

## Demo content

Blender Foundation open movies (CC-BY). Attribution is carried in-app and in
[`assets/ATTRIBUTION.md`](./assets/ATTRIBUTION.md). No third-party copyrighted
material appears anywhere in this repository or the demo video.

Shaka Player is vendored from
[`AmazonAppDev/vega-video-sample`](https://github.com/AmazonAppDev/vega-video-sample)
under MIT-0. The files carry stale `PROPRIETARY/CONFIDENTIAL` headers despite
the repository's licence — [`FRICTION.md`](./FRICTION.md) entry 6.

## Licence

Apache-2.0. See [LICENSE](./LICENSE).
