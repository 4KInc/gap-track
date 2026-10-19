# Devpost submission — The Gap Track

Paste-ready. Section headings match Devpost's standard prompts.

---

## Inspiration

If you cannot see the screen you get the dialogue and the sound effects, and you
miss everything that happens silently. A character reads a letter and their face
changes. Someone pockets a knife. A car pulls up outside. None of it is in the
audio, so the story stops making sense.

Audio description solves this with a second voice speaking in the pauses. The
reason most content does not have it is not technical — it is that a person has
to watch the film, find every gap, time it, and write something that fits, which
takes six to twelve minutes of work per minute of video. Commercial description
is priced per finished minute and widely quoted in the $15–30 range, so a
thousand-hour catalogue runs to roughly a million dollars.

That means description goes to the content someone can justify paying for, and
archive film, independent distribution, regional broadcasting and educational
libraries go without. All of them publish to the Fire TV Appstore.

The interesting problem is not generating a description. It is generating one
that is **safe to play** — because a description that talks over the dialogue
has made the film less accessible, not more.

## What it does

The Gap Track is a Fire TV / Vega OS player that generates audio description for
content that has none, and provably never speaks over the dialogue.

It inverts the caption track to find where nobody is speaking, measures each
silence, writes a line short enough to fit the one it is aimed at, synthesises
it, measures the rendered audio, and then checks a single inequality:

```
admit cue  ⟺  audioDurationMs + safetyMarginMs ≤ gap.durationMs
```

Both sides are measurements. `audioDurationMs` is read back off the rendered
audio file — sample count over sample rate — never a words-per-minute estimate.
`gap.durationMs` comes from the captions, which mark dialogue to the
millisecond.

If the line does not fit, it is **discarded**. Not shortened, not faded under
the dialogue, not played late.

The app shows that arithmetic on screen with both operands labelled, so the
claim can be checked rather than trusted. The safety margin is adjustable,
because it is the one constant in the rule that is a preference rather than a
measurement — and raising it visibly costs descriptions.

## How we built it

**Finding the silences.** Captions, not voice activity detection. Captions mark
*dialogue* specifically, so a passage carried by music reads correctly as
describable, where an energy threshold would refuse it for being loud. Long
silences are subdivided — Sintel's 107-second opening would otherwise have been
one gap with a 267-word budget, which is a rambling paragraph spoken over a
scene that has moved on three times since it began.

**Writing the line.** Claude Opus, with frames sampled across each gap and the
dialogue immediately before it for context. The word budget is derived from the
measured silence and is a hard ceiling: on a miss it retries once naming the
overage, then declines. It never truncates, because a sentence cut off mid-way
is worse than silence. Declining is first-class — on Sintel it declined 6 of 107
gaps, which are the dark or static moments where nothing has changed.

**Speaking it.** Amazon Polly, asked for PCM rather than MP3. This is not a
quality preference: an MP3's duration has to be inferred from frame headers and
the encoder may pad the final frame, while PCM's duration is the sample count
over the sample rate, exactly. The whole product rests on that number. Verified
live: a 15-word description returned 152,444 bytes at 16 kHz mono — 4762.5ms
from the sample count, against 4763ms reported.

**Deciding.** Admission control is pure arithmetic over measured values and
contains no model call, which is why the guarantee survives the model being
wrong.

**Playing it.** The description is a timeline-aligned HLS track served from S3,
and the app applies the same admission rule again at playback against the live
playhead — so seeking, pausing and rate changes cannot strand a cue into the
dialogue it was cleared against.

## Challenges we ran into

**The virtual device cannot play media.** It has no audio output, and it cannot
decode video — not our streams, and not Amazon's own reference stream, which is
how we know it is the device and not our packaging. We lost time to three wrong
hypotheses before running the control test that settled it in five minutes. The
lesson was to run the control *first*.

So the app shows preview stills advanced by the playhead where it cannot decode,
and says so on screen. Every decision and measurement is real; only the picture
is substituted, and the substitution is labelled rather than hidden.

**Nothing but fragmented HLS will play.** `file://` fails at 0ms with
SRC_NOT_SUPPORTED; a plain progressive HTTPS MP4 fails at 50ms with a decode
error. Only MSE through a patched Shaka Player works, which meant vendoring
Shaka and building fMP4 HLS for both the programme and the description track.

**The guarantee kept finding bugs in us.** Admission originally asked whether a
cue *started on time* rather than whether it could *finish*, and dropped a cue
300ms into a five-second gap. The mixed film clipped — 39,206 samples at full
scale against 694 in the source — because narration was boosted on a track
already near peak. The player's tick loop closed over a player that is filled in
asynchronously, so on device it would have held null forever and never ticked at
all. Each of those was caught by measuring the output rather than trusting it.

## Accomplishments that we're proud of

Running a real film end to end and watching the system **refuse**.

Sintel, 14.8 minutes, no audio description anywhere it is published:

```
107 silences found
 99 described
  6 declined by the describer
  2 refused by admission
512s of narration around 77.2s of dialogue, 0 collisions
```

One refusal is four words — *"It settles, eye closing."* — needing 1788ms in a
1900ms gap. 138ms too long, so it does not play. That is the product working.

And the verification is independent of the code that produced it: every cue is
replayed as the interval it will occupy and intersected with speech intervals
parsed straight out of the caption file, so a bug that corrupted the gap list
could not also corrupt the thing checking it.

Cost: **$0.13** to describe the film, a measured **$0.53 per described hour**.

## What we learned

That a safety property is only worth as much as the measurement behind it. Every
time we were tempted to estimate — speaking rate, MP3 duration, whether a gap
"looked long enough" — the estimate was eventually wrong, and the only reason it
did not matter is that nothing load-bearing was built on one.

Concretely: our assumed speaking rate of 2.5 words/second turned out to be 3.10
measured across 98 rendered descriptions. We corrected it, but the guarantee was
never at risk, because admission compares the rendered file rather than the
assumption.

## What's next for The Gap Track

Voice activity detection as a fallback for content with no captions. Per-viewer
verbosity, since the margin control already proves the trade is legible. And
lifting `src/engine/` out as a standalone package — it is dependency-free and
has no knowledge of Vega, React Native or AWS.

## Built with

TypeScript · React Native 0.83 · Vega OS / Fire TV · Shaka Player ·
Claude (Anthropic API) · Amazon Polly · Amazon S3 · ffmpeg

## Try it out

- Repository: https://github.com/4KInc/gap-track
- Friction log: `FRICTION.md` — 12 entries, every one measured during this build
