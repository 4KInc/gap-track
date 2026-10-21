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
Most films have no audio description because a person has to watch the film and write every line by hand. The Gap Track generates it instead, and proves it will never speak over the dialogue: every line is checked against one inequality, speech duration plus safety margin must fit inside the measured silence, where both sides are measurements rather than estimates. The speech is read off the rendered audio file; the silence comes from the caption track, which marks dialogue to the millisecond. If a line does not fit it is discarded, not shortened and not faded under. On Sintel (14.8 minutes, undescribed anywhere it is published) that produced 99 descriptions across 107 silences, with 6 declined for having nothing worth saying and 2 refused for not fitting: 512 seconds of narration placed around 77.2 seconds of dialogue, zero collisions, for $0.14. One of the refusals is four words. "It settles, eye closing." It needed 1788ms, the gap was 1900ms, so 138 milliseconds too long and it does not play.

00:00 The problem
00:22 What it sounds like
01:00 The rule
01:40 The refusal
02:25 How it is built
02:50 Close

Code: https://github.com/4KInc/gap-track
Friction log: https://github.com/4KInc/gap-track/blob/main/FRICTION.md

Built for the Build, Ship, Shape: Amazon Developer Hackathon. Fire TV / Vega OS, React Native 0.83, Amazon Polly, Amazon S3, Claude. The Vega Virtual Device cannot decode video or play audio, including Amazon's own reference stream, so the app shows preview stills and says so on screen; every decision and refusal is real.

Sintel (c) copyright Blender Foundation, durian.blender.org, licensed CC-BY 3.0.
```

---

## Thumbnail

**Select from video**, and take a frame from shot 3 or 4 showing the admission
arithmetic with both operands labelled. It is the one image that states the
whole project, and no other submission will have anything resembling it.

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
