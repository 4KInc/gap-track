/**
 * Play a real film all the way through.
 *
 * Every other test here uses a fixture of two or three cues, which proves
 * the arithmetic but not the behaviour over a programme: ordering across a
 * hundred cues, two adjacent gaps, a cue whose gap abuts the next, the
 * scheduler's lookahead window sliding for fourteen minutes.
 *
 * So this drives the real Sintel manifest — 99 cues built by the real
 * pipeline and measured from real Polly audio — through the real
 * DescriptionPlayer at the 50ms tick the device uses, and checks the one
 * thing the product claims: nothing was ever spoken over dialogue.
 *
 * Dialogue comes from the caption file, not from our own gap list, so a bug
 * that corrupted the gaps would not also corrupt the thing checking them.
 *
 * Skips if the built track is absent. It is a build artefact, not a fixture,
 * and a developer who has not run the pipeline should not see a red suite —
 * but see `it.skip` in the output rather than silence, so a skip cannot be
 * mistaken for a pass.
 */

import { existsSync, readFileSync } from 'node:fs';

import { DescriptionPlayer, type CueManifest } from '../../src/player/DescriptionPlayer';
import type { MediaPort } from '../../src/player/ports';
import { mergeSpeech, parseCaptions } from '../../src/engine/gaps';
import type { Cue } from '../../src/engine/types';

// In the repo's own build directory, not /tmp. These used to point at a
// scratch directory, so a reboot silently turned this suite into four skips
// — which is exactly the failure the skip was designed to be honest about.
// `npm run demo:assets` puts them here.
const TRACK = 'build/demo/sintel-track.json';
const CAPTIONS = 'build/demo/sintel_en.srt';
const TICK_MS = 50;

/** A media element that behaves like one, driven by the test's clock. */
class FakePort implements MediaPort {
  currentTime = 0;
  paused = true;
  volume = 1;
  playCount = 0;

  play(): void {
    this.paused = false;
    this.playCount++;
  }
  pause(): void {
    this.paused = true;
  }
}

const have = existsSync(TRACK) && existsSync(CAPTIONS);
const whenBuilt = have ? describe : describe.skip;

whenBuilt('a whole film, ticked at the device rate', () => {
  let manifest: CueManifest;
  let speech: { startMs: number; endMs: number; text: string }[];

  beforeAll(() => {
    const track = JSON.parse(readFileSync(TRACK, 'utf8')) as {
      durationMs: number;
      cues: Cue[];
    };
    manifest = { titleId: 'sintel', durationMs: track.durationMs, cues: track.cues };
    speech = mergeSpeech(parseCaptions(readFileSync(CAPTIONS, 'utf8')));
  });

  it('speaks every cue, in order, inside its own gap, and never over dialogue', () => {
    const video = new FakePort();
    const description = new FakePort();
    const player = new DescriptionPlayer(video, description);

    player.load(manifest);
    player.setMode('adaptive');
    video.play();

    // What actually came out of the speaker, reconstructed from the
    // player's own reports rather than from what we told it to do.
    const spoken: { cue: Cue; fromMs: number; toMs: number }[] = [];
    let current: { cue: Cue; fromMs: number } | null = null;

    for (let t = 0; t <= manifest.durationMs; t += TICK_MS) {
      video.currentTime = t / 1000;
      player.tickAt(t);
      player.currentDecisions(); // drain, as the UI does

      const saying = player.speakingText();
      if (saying && !current) {
        const cue = manifest.cues.find((c) => c.text === saying);
        if (cue) current = { cue, fromMs: t };
      } else if (!saying && current) {
        spoken.push({ ...current, toMs: t });
        current = null;
      }
    }
    if (current) spoken.push({ ...current, toMs: manifest.durationMs });

    // Every cue got spoken.
    expect(spoken).toHaveLength(manifest.cues.length);

    // In programme order, never two at once.
    for (let i = 1; i < spoken.length; i++) {
      expect(spoken[i].fromMs).toBeGreaterThanOrEqual(spoken[i - 1].toMs);
    }

    // Each inside the gap it was written for, allowing one tick of latency
    // for the loop to notice the gap had opened.
    for (const s of spoken) {
      expect(s.fromMs).toBeGreaterThanOrEqual(s.cue.gap.startMs - TICK_MS);
      expect(s.toMs).toBeLessThanOrEqual(s.cue.gap.startMs + s.cue.gap.durationMs + TICK_MS);
    }

    // The claim. Checked against the captions, not against our gaps.
    const collisions = spoken.flatMap((s) =>
      speech
        .filter((line) => Math.min(s.toMs, line.endMs) - Math.max(s.fromMs, line.startMs) > 0)
        .map((line) => `${s.fromMs}-${s.toMs} over "${line.text.slice(0, 40)}"`),
    );
    expect(collisions).toEqual([]);
  }, 120_000);

  it('refuses more as the viewer asks for more room, and silence at the extreme', () => {
    // The margin is a preference, so it is the viewer's to set — but the
    // price has to be real. At 3s of required clearance a 14-minute film
    // keeps 18 of its 99 descriptions: the engine goes quiet rather than
    // crowd the dialogue, which is the behaviour the whole project claims.
    const counts = [250, 750, 1_500, 3_000].map((marginMs) => {
      const video = new FakePort();
      const description = new FakePort();
      const player = new DescriptionPlayer(video, description, {
        config: { safetyMarginMs: marginMs },
      });
      player.load(manifest);
      player.setMode('adaptive');
      video.play();

      const heard = new Set<string>();
      for (let t = 0; t <= manifest.durationMs; t += TICK_MS) {
        video.currentTime = t / 1000;
        player.tickAt(t);
        player.currentDecisions();
        const saying = player.speakingText();
        if (saying) heard.add(saying);
      }
      return heard.size;
    });

    // Monotonically fewer: more required clearance can never admit more.
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
    expect(counts[0]).toBe(manifest.cues.length);
    expect(counts[counts.length - 1]).toBeLessThan(manifest.cues.length / 2);
  }, 120_000);

  it('takes a margin change mid-playback without cutting off a cue already sounding', () => {
    const video = new FakePort();
    const description = new FakePort();
    const player = new DescriptionPlayer(video, description);
    player.load(manifest);
    player.setMode('adaptive');
    video.play();

    const target = manifest.cues[10];
    player.tickAt(target.gap.startMs);
    expect(player.speakingText()).toBe(target.text);

    // A cue already cleared keeps the margin it was admitted under: the
    // dialogue it was checked against has not moved, so cutting it off
    // mid-word would cost the viewer a description and protect nothing.
    player.setSafetyMargin(3_000);
    expect(player.settings().safetyMarginMs).toBe(3_000);
    player.tickAt(target.gap.startMs + 100);
    expect(player.speakingText()).toBe(target.text);
  });

  it('abandons a cue when the viewer seeks away from its gap', () => {
    const video = new FakePort();
    const description = new FakePort();
    const player = new DescriptionPlayer(video, description);
    player.load(manifest);
    player.setMode('adaptive');
    video.play();

    const target = manifest.cues[10];

    // Start at the gap, not inside it. Entering a gap halfway through is
    // correctly refused as TOO_LATE — by then the cue can no longer finish
    // before the dialogue resumes — so arriving mid-gap would test the
    // refusal path rather than the abandonment one.
    player.tickAt(target.gap.startMs);
    expect(player.speakingText()).toBe(target.text);

    // Still mid-sentence a moment later.
    player.tickAt(target.gap.startMs + Math.floor(target.audioDurationMs / 2));
    expect(player.speakingText()).toBe(target.text);

    // Jump somewhere with no cue due. The narration must not continue
    // describing a moment the viewer has left.
    player.seek(0);
    player.tickAt(0);
    expect(player.speakingText()).toBeNull();
  });
});

describe('what the viewer is actually choosing', () => {
  it('yields less narration the more silence is demanded', () => {
    // The control is named for the requirement, not the result, because the
    // numbers read backwards otherwise: asking for MORE space around speech
    // produces LESS description. If that relationship ever inverted, the
    // label would be a lie.
    if (!have) return;
    const track = JSON.parse(readFileSync(TRACK, 'utf8')) as { cues: Cue[] };

    const kept = [250, 750, 1_500, 3_000].map(
      (safetyMarginMs) =>
        track.cues.filter(
          (c) => c.audioDurationMs + safetyMarginMs <= c.gap.durationMs,
        ).length,
    );

    for (let i = 1; i < kept.length; i++) {
      expect(kept[i]).toBeLessThanOrEqual(kept[i - 1]);
    }
    expect(kept[0]).toBeGreaterThan(kept[kept.length - 1]);
  });
});
