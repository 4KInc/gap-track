# Devpost submission: The Gap Track

Paste the whole of this into **About the project**. Headings match Devpost's prompts.

---

## Inspiration

Put a film on and look away from the screen. Not close your eyes. Just look away, and try to follow it.

The dialogue keeps arriving and the story stops. Somebody reads a letter and their face changes; you get a pause. A knife goes into a pocket; you get nothing. A car pulls up outside and the room goes quiet, and you have no idea why. The sound is all there. The film is not.

Audio description fixes that with a second voice speaking in the pauses between lines. The reason most content does not have it is not technical. A person has to watch the film, find every gap, time it, write something that fits that exact gap and no other, and record it: six to twelve minutes of work per minute of video. It is priced per *finished* minute and quoted in the $15-30 range. A thousand-hour catalogue is on the order of a million dollars.

So description goes to the content somebody can justify paying to describe, and everything else goes without: archive film, independent distribution, regional and community broadcasting, educational libraries. All of them publish to the Fire TV Appstore. None of them are going to commission a describer.

The obvious move in 2026 is to point a vision model at a film and have it narrate. I started there and stopped within a day, because the interesting problem is not generating a description. It is generating one that is **safe to play**. A description that runs 200ms into the next line of dialogue has made the film less accessible, not more. The viewer now loses the thing they could follow, in exchange for help following the thing they could not. Every blind viewer I read in forums said a version of the same thing: narration that collides with dialogue is worse than silence.

One rule fell out of that and shaped everything else: **the system must be able to prove it will not talk over the dialogue, before it plays anything.** Not usually. Not with a confidence score. Provably, on arithmetic anyone can check. Every feature got tested against that.

## What it does

It is a Fire TV / Vega OS player that writes audio description for films that have none, and refuses to speak when it cannot fit.

It takes the caption track and inverts it. Captions mark *dialogue* to the millisecond, so the gaps between them are where nobody is talking. For each gap it samples frames across it and the dialogue immediately before it, then writes a line to a word budget derived from the measured length of that specific silence. Amazon Polly speaks it. The rendered audio file is measured, sample count over sample rate, and then one inequality decides whether it plays:

```
audioDurationMs + safetyMarginMs ≤ gap.durationMs
```

Both sides are measurements. Not an estimate of speaking rate, not a token count, not the model's opinion about how long a sentence takes. If the line does not fit, it is **discarded**. Not shortened, not faded under the dialogue, not played late into the next scene.

On Sintel (Blender Foundation, 14.8 minutes, no audio description anywhere it is published):

```
107  silences found
 -6  the writer had nothing worth saying
───
101  descriptions written
 -2  refused: the audio came out longer than the silence
───
 99  in the track

512s of narration placed around 77.2s of dialogue
  0 collisions
```

One of the two refusals is four words. *"It settles, eye closing."* It needed 1788ms. The gap was 1900ms. With the 250ms margin that is 2038ms, so it is 138 milliseconds too long, and it does not play. Four words, written, voiced, measured, thrown away.

The app shows that arithmetic on screen with both operands labelled `measured` and `configured`, because the claim is not "trust us". It is "here are the two numbers, check them."

And the margin is adjustable, because it is the only constant in the rule that is a preference rather than a measurement. Raising it buys distance from the dialogue and costs descriptions, and the cost is real:

| Margin | Plays | Refused | Narration |
|---|---|---|---|
| 250ms | 99 | 0 | 512s |
| 750ms | 97 | 2 | 500s |
| 1500ms | 86 | 13 | 438s |
| 3000ms | **18** | **81** | 78s |

At three seconds the engine goes almost completely quiet rather than crowd the dialogue. That is not a failure mode. That is the product.

## How we built it

**Captions, not voice activity detection.** This was the first real decision and it is load-bearing. VAD finds where the audio is quiet; captions find where nobody is *speaking*. Those differ exactly where it matters: a scene carried by music with no dialogue is the single best place to describe something, and an energy threshold refuses it for being loud. Far more content ships with captions than with description, so inverting the caption track is both more accurate and more available. VAD stays as the fallback for content with no captions, and it is second choice for that reason rather than for effort.

**Build time, not playback time.** The original design generated on a rolling 20-30 second window ahead of the playhead, so model latency would be absorbed as buffer. I abandoned it for three reasons found while building. A description is the same every time the film plays, so generating per-playback pays repeatedly for an identical result and makes a viewer's experience depend on their network. Measuring rendered audio is cheap at build time and a latency spike at playback. And a track that already exists can be verified before anybody watches it, which matters when the whole claim is "never talks over dialogue."

The live path kept the part that must be live: the same admission rule runs again at playback against the real playhead, so seeking, pausing and rate changes cannot strand a cue into dialogue it was cleared against.

**Polly returns PCM, not MP3.** This is the safety guarantee, not an audio preference. An MP3's duration has to be inferred from frame headers and the encoder may pad the final frame. PCM's duration is the sample count divided by the sample rate, exactly, and nothing in the path can round it. Verified against live Polly: a 15-word description returned 152,444 bytes at 16 kHz mono, which is 4762.5ms from the sample count against 4763ms reported. The only discrepancy is integer rounding. The audio is measured back off the *written file* rather than the buffer in memory. One extra read, and it removes a class of bug where the bytes measured and the bytes written are not the same bytes.

**The describer is allowed to decline.** Declining is a first-class return value, not a fallback. On Sintel it declined 6 of 107 gaps: the dark or static openings where nothing has changed. The word budget is a hard ceiling: on a miss it retries once, naming the overage, then declines. It never truncates, because a sentence cut off mid-way is worse than silence. And the brief forbids interpretation: *"She frowns,"* never *"she is angry."* The viewer is owed what is on screen, not a reading of it.

**Admission contains no model call.** It is arithmetic over two measured numbers. That is the entire reason the guarantee survives the model being wrong. The model can write a bad line, an overlong line, a line about the wrong thing, and none of those can produce narration over dialogue.

**Long silences get subdivided.** Sintel's opening is 107 seconds with no dialogue. Left whole it buys a 267-word budget, which produces one rambling paragraph spoken over a scene that has moved on three times since it started. Gaps over 8 seconds are divided evenly, not into 8-second slices with a runt at the end, because a two-second offcut gets described in three words for no reason other than arithmetic.

Shipped on React Native 0.83 for Vega with Fabric and TurboModules, media through `@amazon-devices/react-native-w3cmedia` over a vendored Amazon-patched Shaka Player, Claude Opus for the writing, Polly for the voice, S3 for fragmented HLS, ffmpeg for frames and packaging.

## Challenges we ran into

**Three wrong hypotheses before I ran the control.** Video would not decode. I blamed 720p High profile, then a missing audio track, then a bare media playlist, and wrote code against each. Then I put Apple's own reference stream through the identical code path. It failed too, in five minutes, which proved the fault was the device and not our packaging. I should have run the control first. It is now `FRICTION.md` entry 10, and it is the entry I would most like to have back the days from.

Related, and worse: an earlier probe of mine had reported Shaka as "ACCEPTED" on this path. It checked `readyState >= 1`, which proves a manifest parsed and nothing whatsoever about playback. I had written down a result that was not the result. Corrected in the spike record rather than quietly deleted.

**Admission asked the wrong question.** The first version checked whether a cue *started on time*. A cue arriving 300ms into a five-second gap was dropped as `TOO_LATE`, with four and a half seconds of silence in front of it. The right question is whether it can *finish*: compare against the time remaining from wherever the playhead actually is, not against the gap's start. One comparison, and the behaviour it produced was indefensible until it changed.

**A speaking rate I guessed and never measured.** `wordBudget` assumed 2.5 words per second. Rendering a whole film gave a real distribution: median 3.10, p10 2.63, p90 3.56. The guess sat below even the slowest case observed, which made overrunning arithmetically impossible, so the thing I would have shown as a safety result was partly just a conservative constant.

I corrected it to 2.6, deliberately under the p10 rather than at the median, because the budget is spent before the audio exists and erring fast would push a quarter of cues into refusal. But the more useful finding was in checking before I acted: the describer writes to a median **83%** of whatever budget it is handed. It stops when it has said what is on screen, not when it runs out of room. I had been about to claim the correction would recover about eight words per description. It would not have. Most of that silence was editorial restraint, and padding descriptions to fill silence is bad description practice anyway.

**The mix was clipping and I nearly shipped it.** Measuring the described film found **39,206 samples at full scale against 694 in the source**, a 56× increase. The narration was boosted 1.6× on top of a track already near peak, then summed with `amix normalize=0`, which has no headroom. Audible as a crack on exactly the words the viewer needed. Dropped the boost to 1.0, because the programme is already ducked to a quarter, putting narration about 12 dB above it, so the extra 60% bought nothing but overflow. Then put a limiter after the sum so exceeding full scale is impossible rather than unlikely. Re-measured: 844, against the source's own 694.

**A tick loop that could never tick.** `PlayerScreen` builds one interval that drives the whole engine. It closed over `players.video` from the first render, but `useVegaPlayers` returns a fresh object every render and fills its players in asynchronously. So the guard `if (!p || !v) return` saw `null` at mount and held it for the life of the screen. On device, no cue could ever have fired. It was caught by a React hooks lint rule I had been about to wave through as a nag, on a file that had been "working" in every test because every test called `tickAt` directly.

**A WAV header assumption that was mine, not the parser's.** I wrote a test asserting duration from the data chunk at offset 44 and it disagreed with the parser by ~85ms, a third of the entire safety margin. The parser was right. `afconvert` inserts an `FLLR` padding chunk, so offset 44 is not where the samples start. The naive thing was my test, and if I had "fixed" the parser to match it I would have broken the measurement everything rests on.

**Adjacent gaps could still collide.** Admission judges one cue at a time and never looks at its neighbours, so two back-to-back gaps can each admit a cue and the first can still be speaking when the second starts. No dialogue is harmed, so admission is satisfied, and the viewer hears two narrators at once. My first fix threw and failed the whole build, which is wrong for real films. It now demotes the later cue.

**No Fire TV hardware, and I will not pretend otherwise.** The Vega Virtual Device has no audio output and cannot decode video. Everything in this project was built and verified without a physical stick, which means the engineering is sound and the on-device demo carries a caveat nothing in our code caused. On the emulator the app shows preview stills advanced by the playhead and **says so on screen**, because a sequence of stills presented as playback would be a lie about what the device did. Every decision, measurement and refusal there is real. Only the picture is substituted, and the substitution is labelled.

**What is not in the build: Amazon Bedrock.** Claude writes every description, through the Anthropic API directly. The describer sits behind an interface, so Bedrock would be a swap at that seam with nothing above it changing, but it is not wired, and it is claimed nowhere as built.

## Accomplishments that we're proud of

**The guarantee is checked against the film, not against our own arithmetic.** `verify-track.ts` re-decides every cue against the engine, which only proves the code agrees with itself: a bug in how we find silences would also corrupt the thing measuring them. So `verify-no-overlap.ts` replays each cue as the interval it will occupy and intersects it with speech parsed straight out of Blender's own subtitle file. 512 seconds of narration placed around 77.2 seconds of dialogue, **zero collisions**, checked against a file we did not write and cannot influence.

**The refusals.** Two on Sintel, and one of them is four words over by 138 milliseconds. The library row and the overlay both report what was thrown away, not just what was produced. A system that never refused anything would either be lucky or lying.

**Turn the margin up and watch it go quiet.** At 3000ms it refuses 81 of 99 descriptions, live, with the arithmetic flipping from `≤` to `>` on screen. The trade-off is not described to the viewer; it is handed to them.

**It declines when there is nothing to say.** Six gaps on Sintel. Dark frames, static openings, nothing changed. A describer that always produces something is filling silence with noise, and the gaps where that is most tempting are exactly the ones where it is least useful.

**A whole film, ticked at the device rate.** 189 tests, including one that drives the real 99-cue manifest through the real `DescriptionPlayer` at the device's 50ms tick for the full 14.8 minutes, reconstructs what came out of the speaker from the player's own reports, and asserts the no-collision property against the captions.

**$0.14 to describe the film.** 8,690 characters of Polly neural, a measured $0.56 per described hour, against a human rate quoted per finished minute.

**Twelve friction entries, every one measured on this machine**, with exact error text and a suggested fix. Two external reviews offered me fabricated entries to pad the count for the scoring bonus. Submitting manufactured evidence of engineering work is dishonest and I would rather have twelve real ones.

## What we learned

**A measurement you did not take is a decision you did not make.** Every time I was tempted to estimate (speaking rate, MP3 duration, whether a gap "looked long enough"), the estimate was eventually wrong. The only reason none of it mattered is that nothing load-bearing was built on one. The constant was wrong by 20% for weeks and the guarantee was never at risk, because admission compares the rendered file rather than the assumption. That is the whole architectural argument in one sentence: put the model and the estimates where being wrong is survivable, and put arithmetic over measured values where it is not.

**Run the control first.** Three hypotheses, each plausible, each costing hours, all eliminated in five minutes by putting Amazon's own stream through the same code path. When something fails and you cannot tell whether it is you or the platform, the cheapest next move is almost always the test that distinguishes those two, not the next fix.

**Check the data before acting on it.** I had the correct diagnosis (the rate was a guess) and nearly the wrong conclusion (that fixing it would recover eight words per description). One query (how full is the budget actually?) turned a quality claim into a correctness-only one. 83%. The model was not constrained; it was finished.

**A skip is a failure you agreed not to look at.** The playthrough suite reads a built track, and when that track lived in `/tmp` a reboot turned the headline verification into four silent skips. It was designed to skip loudly rather than fail, and that worked, but only because somebody read the count. It now lives in the repo's own build directory.

## What's next for The Gap Track

**Voice activity detection for content with no captions.** The architecture already treats gap-finding as one interface with captions as the first implementation. This is the lane that takes it from "described content that has captions" to "described content", and the accuracy loss is real and worth measuring rather than assuming.

**Hardware.** Everything above is true and none of it has run on a Fire TV stick. The engine is device-independent and the media path is standard fMP4 HLS, so I expect it to work, but expecting is not the standard this project holds itself to anywhere else.

**`src/engine/` as a package.** The scheduler and admission control have no dependencies and no knowledge of Vega, React Native or AWS. Any player facing the same problem (a podcast app inserting ads, a language tutor speaking over video, any second audio stream that must not collide with a first) needs exactly this, and it lifts out nearly cleanly.

**Per-viewer verbosity.** The margin control already proves the trade is legible to a viewer. Verbosity is the same shape: how much description, at what density, in which gaps.

**And the honest one: describing a film nobody has described before.** Sintel has captions, a known duration and a clean source. The content this exists for is messier: archive transfers, drifting caption timing, material whose captions were auto-generated and are wrong. That is where the next real failures are, and they will not be in the arithmetic.
