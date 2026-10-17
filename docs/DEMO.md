# Demo video — shot list

Target under 3:00. Public, English, YouTube or Vimeo.

Two sources, used for different jobs:

- **`sintel-described.mp4`** — the real film with narration mixed in. Use this
  whenever the point is *what it sounds like*. Real video, real audio, no
  caveats.
- **The app on the Vega Virtual Device** — use this whenever the point is
  *how it decides*. The emulator cannot decode video (FRICTION.md entry 10),
  so the picture there is preview stills advanced by the playhead, and the app
  says so on screen. Address that in one sentence rather than hoping nobody
  reads it; a judge who spots an unexplained notice will assume worse than the
  truth.

---

## 1 · The problem (0:00–0:22)

**On screen:** Library screen. Scroll it. Most titles carry no description
badge.

**Say:**
> Audio description is the narration that tells a blind viewer what's on
> screen. Netflix describes a fraction of its catalogue. For everything else —
> archives, independent film, anything older — there is none. This is a Fire TV
> player that makes it at playback time, for content that never had it.

---

## 2 · What it sounds like (0:22–1:00)

**On screen:** `sintel-described.mp4`, playing from **00:10 to 00:50**.
Let it run. Don't talk over it.

Narration lands at **00:15, 00:23, 00:30, 00:38, 00:45** — five descriptions
in forty seconds, every one inside a silence.

**Say, before it starts, then be quiet:**
> This is Sintel. It has no audio description anywhere it's published. Here it
> is with one, generated in a pipeline — and listen to where the narration
> sits.

---

## 3 · The rule (1:00–1:40)

**On screen:** the app. Sintel, Adaptive Description on, **Show admission
detail**. Let a cue arrive and freeze on the arithmetic.

The tightest fit in the film is at **06:14** — use it if you want the closest
call:

```
SPEECH 7405ms  +  MARGIN 250ms   ≤   SILENCE 7965ms
      measured      configured         measured
                                    spare 310ms
```

**Say:**
> Every description is checked against one inequality before it's allowed to
> play. How long the speech actually is — measured from the rendered audio
> file, not estimated. Plus a safety margin. Against how long the silence
> actually is, measured from the caption track. Both sides are measurements.
> That's what makes it a guarantee instead of a hope.

**Then, one sentence on the notice:**
> The emulator can't decode video, so the picture here is stills from the
> pipeline advanced by the playhead — the app says so rather than pretending.
> The audio path and every decision are real.

---

## 4 · The refusal (1:40–2:25)

This is the beat the whole thing turns on. Don't rush it.

**On screen:** press **1500ms**, then **3000ms** on the SAFETY MARGIN row.
Watch the history fill with DROP and the arithmetic flip to `>`.

Numbers, measured on this film:

| Margin | Plays | Refused | Narration |
|---|---|---|---|
| 250ms | 99 | 0 | 512s |
| 750ms | 97 | 2 | 500s |
| 1500ms | 86 | 13 | 438s |
| 3000ms | 18 | **81** | 78s |

**Say:**
> The margin is a preference, so it belongs to the viewer. Ask for more room
> and watch what happens. At one and a half seconds it refuses thirteen
> descriptions. At three seconds it refuses eighty-one of ninety-nine — and
> goes almost completely quiet. It would rather say nothing than say something
> over the dialogue. That's the product.

**Then the strongest single fact:**
> One of the descriptions this film refused at build time is four words long.
> "It settles, eye closing." Seventeen hundred and eighty-eight milliseconds,
> into a nineteen-hundred-millisecond gap. A hundred and thirty-eight
> milliseconds too long. So it doesn't play.

---

## 5 · How it's built (2:25–2:50)

**On screen:** the terminal — `npx tsx pipeline/cli.ts` output scrolling, or
the verifier:

```
$ npx tsx scripts/verify-no-overlap.ts track.json sintel_en.srt
99 cues against 26 speech runs
  narration      512.0s
  dialogue       77.2s
  collisions     0
  no description overlaps any line of dialogue
```

**Say:**
> Captions give the dialogue to the millisecond, so inverting them gives the
> silences. Claude writes to a word budget derived from each silence and
> declines when there's nothing worth saying. Polly speaks it as PCM, so the
> duration is exact. Then it's measured, and admitted or refused. Five hundred
> and twelve seconds of narration placed around seventy-seven seconds of
> dialogue, and not one millisecond of overlap — checked against the caption
> file, not against our own arithmetic.

---

## 6 · Close (2:50–3:00)

**Say:**
> Audio description for everything that never got any, and a guarantee you can
> check rather than trust.

---

## Before you record

- [ ] Device up: `vega virtual-device start --gui`
- [ ] App current: `npm run build:release && vega device install-app -p <vpkg>`
- [ ] Start from the library screen, not mid-playback
- [ ] Margin back to **250ms** before the take, so the change is visible
- [ ] Record system audio — the narration is the point
- [ ] Watch the full take once for anything on screen you haven't explained
