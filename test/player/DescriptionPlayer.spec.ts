/**
 * Playback is where the engine meets a media element, so these tests use
 * fake ports and assert on what was done to them: did the programme duck,
 * did the description seek to the right offset, did the programme resume.
 *
 * The unit boundary matters. `currentTime` is seconds and the engine is
 * milliseconds, and a factor-of-1000 slip there would place every cue a
 * thousand times too early while looking, on screen, like the scheduler had
 * simply stopped working.
 */

import { DescriptionPlayer, type CueManifest } from '../../src/player/DescriptionPlayer';
import type { MediaPort } from '../../src/player/ports';
import type { Cue } from '../../src/engine/types';

class FakePort implements MediaPort {
  currentTime = 0;
  paused = true;
  volume = 1;
  readonly calls: string[] = [];

  play(): void {
    this.paused = false;
    this.calls.push('play');
  }
  pause(): void {
    this.paused = true;
    this.calls.push('pause');
  }
}

const cue = (id: string, startMs: number, gapMs: number, audioMs: number): Cue => ({
  id,
  gap: { startMs, durationMs: gapMs },
  text: `cue ${id}`,
  audioDurationMs: audioMs,
  trackOffsetMs: startMs,
});

const manifest = (cues: Cue[]): CueManifest => ({
  titleId: 't',
  durationMs: 600_000,
  cues,
});

let video: FakePort;
let desc: FakePort;
let lines: string[];

const make = (opts = {}) => {
  video = new FakePort();
  desc = new FakePort();
  lines = [];
  return new DescriptionPlayer(video, desc, { onDecision: (l) => lines.push(l), ...opts });
};

describe('DescriptionPlayer: adaptive mode', () => {
  it('speaks a cue when its gap arrives, from the right offset', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 1_000)]));
    p.setMode('adaptive');

    video.currentTime = 9; // seconds
    p.tick();
    expect(desc.calls).toEqual([]);

    video.currentTime = 10;
    p.tick();
    expect(desc.calls).toEqual(['play']);
    // Timeline-aligned track: seek to the cue's own programme offset,
    // expressed in SECONDS because that is what a media element takes.
    expect(desc.currentTime).toBe(10);
    expect(p.isSpeaking()).toBe(true);
  });

  it('ducks the programme while narrating and restores it after', () => {
    const p = make({ duckTo: 0.25 });
    p.load(manifest([cue('a', 10_000, 5_000, 1_000)]));
    p.setMode('adaptive');

    video.currentTime = 10;
    p.tick();
    expect(video.volume).toBe(0.25);

    video.currentTime = 11.2; // past the cue's end
    p.tick();
    expect(video.volume).toBe(1);
    expect(p.isSpeaking()).toBe(false);
  });

  it('does not pause the programme', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 1_000)]));
    p.setMode('adaptive');
    video.currentTime = 10;
    p.tick();
    expect(video.calls).not.toContain('pause');
  });

  it('reports the arithmetic for a refused cue', () => {
    const p = make();
    // 3s of audio plus a 250ms margin, into a 1s gap.
    p.load(manifest([cue('big', 10_000, 1_000, 3_000)]));
    p.setMode('adaptive');

    video.currentTime = 9;
    p.tick();
    expect(lines.join('\n')).toContain('would overrun by 2250ms');
    expect(desc.calls).toEqual([]);
  });

  it('speaks nothing while the mode is off', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 1_000)]));
    video.currentTime = 10;
    p.tick();
    expect(desc.calls).toEqual([]);
  });
});

describe('DescriptionPlayer: pause-and-describe', () => {
  it('holds the programme, narrates, then resumes', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 2_000)]));
    p.setMode('pause-describe');

    video.currentTime = 10;
    p.tick();
    expect(video.calls).toEqual(['pause']);
    expect(desc.calls).toEqual(['play']);
    expect(desc.currentTime).toBe(10);

    // The programme clock is frozen while held, so the description track's
    // own position is what times the cue out.
    desc.currentTime = 12;
    p.tick();
    expect(video.calls).toEqual(['pause', 'play']);
    expect(p.isSpeaking()).toBe(false);
  });

  it('does not duck, because nothing is competing', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 2_000)]));
    p.setMode('pause-describe');
    video.currentTime = 10;
    p.tick();
    expect(video.volume).toBe(1);
  });

  it('does not time out against a frozen programme clock', () => {
    // The bug this guards: using the paused programme's currentTime to decide
    // the cue has finished. It never advances, so the cue would either never
    // end or end instantly depending on the comparison.
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 2_000)]));
    p.setMode('pause-describe');
    video.currentTime = 10;
    p.tick();

    p.tick();
    p.tick();
    expect(p.isSpeaking()).toBe(true); // still going, programme still held
    expect(video.paused).toBe(true);
  });
});

describe('DescriptionPlayer: the viewer moves', () => {
  it('stops narrating on seek and restores the volume', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 2_000)]));
    p.setMode('adaptive');
    video.currentTime = 10;
    p.tick();
    expect(video.volume).toBeLessThan(1);

    p.seek(200);
    expect(p.isSpeaking()).toBe(false);
    expect(video.volume).toBe(1);
    expect(desc.calls).toContain('pause');
  });

  it('resumes the programme if a seek interrupts a hold', () => {
    // Otherwise the viewer is left on a paused film with no description.
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 2_000)]));
    p.setMode('pause-describe');
    video.currentTime = 10;
    p.tick();
    expect(video.paused).toBe(true);

    p.seek(200);
    expect(video.paused).toBe(false);
  });

  it('stops narrating when the programme pauses', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 2_000)]));
    p.setMode('adaptive');
    video.currentTime = 10;
    p.tick();

    p.pause();
    expect(p.isSpeaking()).toBe(false);
    expect(video.volume).toBe(1);
  });

  it('stops describing above 1x', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 1_000)]));
    p.setMode('adaptive');

    p.setRate(2);
    video.currentTime = 10;
    p.tick();
    expect(desc.calls).toEqual([]);
  });

  it('restores the volume when the rate changes mid-cue', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 3_000)]));
    p.setMode('adaptive');
    video.currentTime = 10;
    p.tick();

    p.setRate(2);
    expect(video.volume).toBe(1);
    expect(p.isSpeaking()).toBe(false);
  });
});

describe('DescriptionPlayer: units', () => {
  it('reads the playhead in seconds and schedules in milliseconds', () => {
    const p = make();
    p.load(manifest([cue('a', 90_000, 5_000, 1_000)]));
    p.setMode('adaptive');

    video.currentTime = 89.9; // 89_900ms, still early
    p.tick();
    expect(desc.calls).toEqual([]);

    video.currentTime = 90.0; // 90_000ms, due
    p.tick();
    expect(desc.calls).toEqual(['play']);
  });

  it('seeks the description track in seconds', () => {
    const p = make();
    p.load(manifest([cue('a', 123_400, 5_000, 1_000)]));
    p.setMode('adaptive');
    video.currentTime = 123.4;
    p.tick();
    expect(desc.currentTime).toBeCloseTo(123.4, 3);
  });
});

describe('DescriptionPlayer: turning it off mid-cue', () => {
  it('stops immediately and leaves the programme intact', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 3_000)]));
    p.setMode('adaptive');
    video.currentTime = 10;
    p.tick();

    p.setMode('off');
    expect(p.isSpeaking()).toBe(false);
    expect(video.volume).toBe(1);
    expect(desc.paused).toBe(true);
  });

  it('releases a held programme when switched off', () => {
    const p = make();
    p.load(manifest([cue('a', 10_000, 5_000, 3_000)]));
    p.setMode('pause-describe');
    video.currentTime = 10;
    p.tick();
    expect(video.paused).toBe(true);

    p.setMode('off');
    expect(video.paused).toBe(false);
  });
});
