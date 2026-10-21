# YouTube upload

Paste-ready. The video is a required deliverable: **public**, English, under 3 minutes.

---

## Title

```
The Gap Track: audio description for Fire TV that refuses to talk over dialogue
```

79 of 100 characters. Leads with the project name, because judges arrive from
Devpost looking for it, and with "refuses", because that is the part nobody
else is claiming.

---

## Description

```
Most films have no audio description, because somebody has to sit down, watch the whole thing, and write every line by hand. The Gap Track writes it instead. The hard part isn't writing the description, it's knowing when not to play one, because narration that lands on top of the dialogue has made the film worse rather than better. So every line gets checked against one rule before it is allowed to play. How long the speech actually is, plus a safety margin, has to fit inside the silence it is aimed at. Both of those are measured. The speech is read back off the audio file after it is made, and the silence comes from the caption track, which marks dialogue down to the millisecond. If a line doesn't fit, it gets thrown away. Not shortened, not quietly faded under the dialogue, not played a moment late.

Sintel is 14.8 minutes long and has no audio description anywhere it is published. This wrote 99 of them across 107 silences. Six it declined, because nothing had changed on screen worth mentioning. Two it refused, because they would not have fit. That is eight and a half minutes of narration placed around seventy-seven seconds of dialogue, without ever landing on a word of it, and it cost fourteen cents.

One of the two it refused is four words long. "It settles, eye closing." It needed 1788 milliseconds. The gap was 1900. With the safety margin that is 138 milliseconds too long, so you never hear it.

00:00 The problem
00:22 What it sounds like
01:00 The rule
01:40 The refusal
02:25 How it is built
02:50 Close

Code: https://github.com/4KInc/gap-track
Friction log: https://github.com/4KInc/gap-track/blob/main/FRICTION.md

Built for the Build, Ship, Shape: Amazon Developer Hackathon, on Fire TV and Vega OS, with React Native 0.83, Amazon Polly, Amazon S3 and Claude.

One thing worth saying about the picture. The Vega Virtual Device cannot decode video or play audio, and that is true of Amazon's own reference stream as well as ours, which is how we know it is the emulator and not our packaging. So the app falls back to showing stills from the pipeline, and tells you on screen that it is doing it. Every decision, measurement and refusal you see is real.

Sintel (c) copyright Blender Foundation, durian.blender.org, licensed CC-BY 3.0.
```

---

## Thumbnail

Two routes. A real frame is the stronger one, so try it first.

### Option A: a frame from the video

**Select from video**, and take a frame from shot 3 or 4 showing the admission
arithmetic with both operands labelled. No other submission will have anything
resembling it, and it is genuinely what the app looks like.

### Option B: generated art

Prompt for Gemini (Imagen). Generate the art clean and set the text yourself in
any editor, because image models still misspell short labels and a thumbnail
with a typo reads as careless.

```
A 16:9 dark editorial illustration for a technology video thumbnail.

Subject: two audio waveforms on a near-black background, arranged
horizontally like a timeline. The upper waveform is dense and busy,
rendered in warm amber, representing speech. It stops abruptly, leaving a
wide empty stretch of flat line, then resumes further right. Inside that
empty stretch, and clearly not touching either side of it, sits a second
smaller waveform in bright teal, representing narration placed into the
silence. The teal waveform is noticeably shorter than the gap it occupies,
with visible clearance at both ends.

Above the gap, a thin precise measurement bracket spans the empty stretch,
the kind used on an engineering drawing, with small tick marks at each end.
A second shorter bracket spans only the teal waveform, nested beneath the
first. Leave the brackets unlabelled.

Style: precise, technical, restrained. Flat vector illustration with
crisp edges, not 3D, no glow, no lens flare, no bloom. Generous negative
space. The composition should read instantly at thumbnail size.

Palette, use exactly: background #0C1113, speech waveform #D99A3E,
narration waveform #4FBAC1, brackets and tick marks #8B9A9B, thin
horizontal baseline #253032.

Composition: waveforms occupying the lower two thirds, centre-left
weighted, with clear empty space in the upper right for a title to be
added later. No text, no letters, no numbers anywhere in the image.
```

Then set two lines of text over the empty upper right, in a clean sans at
large size:

```
NEVER TALKS
OVER DIALOGUE
```

White on the dark ground, with the word NEVER in the teal `#4FBAC1`.

**Why this image.** It is the product drawn literally: narration sized to
fit a measured silence, with room left at both ends. Somebody who watches
the video will recognise it afterwards, which a generic waveform or a
picture of a television would not give you.

---

## Before publishing

- [ ] **Public**, not Unlisted. The rules require public.
- [ ] Chapter timestamps match the actual cuts. The first must be `00:00` or
      YouTube renders no chapters at all.
- [ ] The Sintel credit is present. CC-BY requires attribution, and it has to
      be visible to anyone watching, which makes the description the right
      place for it.
- [ ] Language set to English.
- [ ] Under 3:00.

## After publishing

The URL goes in two places on Devpost: the video field in **Project details**,
and optionally **Project Testing Link** under Additional info. See
[`DEVPOST-FORM.md`](./DEVPOST-FORM.md).
