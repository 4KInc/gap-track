/**
 * The scheduler's job is abandoning claims that have gone stale. A fake clock
 * makes that exhaustively testable, which matters because the failure mode —
 * confidently describing a scene the viewer has already left — is invisible
 * in casual testing and obvious to anyone relying on it.
 */

import { CueScheduler, type SchedulerEvent } from '../../src/engine/scheduler';
import type { Cue } from '../../src/engine/types';

const cue = (id: string, startMs: number, gapMs: number, audioMs: number): Cue => ({
  id,
  gap: { startMs, durationMs: gapMs },
  text: `cue ${id}`,
  audioDurationMs: audioMs,
  trackOffsetMs: 0,
});

const played = (events: SchedulerEvent[]) =>
  events.filter((e) => e.decision.verdict === 'PLAY').map((e) => e.decision.cue.id);

const dropped = (events: SchedulerEvent[]) =>
  events
    .filter((e) => e.decision.verdict === 'DROP')
    .map((e) => [e.decision.cue.id, (e.decision as { reason: string }).reason]);

describe('scheduler: ordinary playback', () => {
  it('plays a cue when its gap arrives, not before', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 3_000, 1_000)]);
    s.play();

    expect(played(s.tick(5_000))).toEqual([]); // admitted but early
    expect(played(s.tick(9_999))).toEqual([]);
    expect(played(s.tick(10_000))).toEqual(['a']);
  });

  it('speaks one cue at a time', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 1_000), cue('b', 10_100, 5_000, 1_000)]);
    s.play();

    expect(played(s.tick(10_200))).toEqual(['a']);
    expect(played(s.tick(10_300))).toEqual([]); // b waits, a is sounding
    s.finished('a');
    expect(played(s.tick(10_400))).toEqual(['b']);
  });

  it('never replays a cue already heard', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 1_000)]);
    s.play();

    expect(played(s.tick(10_000))).toEqual(['a']);
    s.finished('a');
    expect(played(s.tick(10_500))).toEqual([]);
    expect(played(s.tick(11_000))).toEqual([]);
  });

  it('drops an oversized cue once, with a reason', () => {
    const s = new CueScheduler();
    s.load([cue('big', 10_000, 1_000, 5_000)]);
    s.play();

    expect(dropped(s.tick(9_000))).toEqual([['big', 'WOULD_OVERRUN']]);
    expect(s.tick(9_500)).toEqual([]); // dead for good, not re-reported
  });

  it('ignores cues beyond the lookahead window', () => {
    const s = new CueScheduler({ lookaheadMs: 5_000 });
    s.load([cue('far', 100_000, 5_000, 9_000)]);
    s.play();
    expect(s.tick(0)).toEqual([]); // not even evaluated yet
  });
});

describe('scheduler: the viewer moves', () => {
  it('cancels a sounding cue on pause', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 3_000)]);
    s.play();
    s.tick(10_000);
    expect(s.getInFlight()?.id).toBe('a');

    expect(dropped(s.pause())).toEqual([['a', 'INVALIDATED']]);
    expect(s.getInFlight()).toBeNull();
  });

  it('cancels a sounding cue on seek', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 3_000)]);
    s.play();
    s.tick(10_000);

    expect(dropped(s.seek(60_000))).toEqual([['a', 'INVALIDATED']]);
  });

  it('stays quiet immediately after a seek, then resumes', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 1_000), cue('b', 60_000, 5_000, 1_000)]);
    s.play();
    s.tick(10_000);
    s.finished('a');

    s.seek(59_000);
    expect(s.getState()).toBe('buffering-cues');
    expect(played(s.tick(59_000))).toEqual([]); // the tick that rebuilds
    expect(played(s.tick(60_000))).toEqual(['b']);
  });

  it('re-arms cues ahead of a backward seek', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 1_000)]);
    s.play();
    expect(played(s.tick(10_000))).toEqual(['a']);
    s.finished('a');

    s.seek(0); // well past the replay threshold
    s.tick(0);
    expect(played(s.tick(10_000))).toEqual(['a']); // described again
  });

  it('does not repeat a line the viewer just heard on a short rewind', () => {
    const s = new CueScheduler({ replayThresholdMs: 5_000 });
    s.load([cue('a', 10_000, 5_000, 1_000)]);
    s.play();
    s.tick(10_000);
    s.finished('a');
    s.tick(12_000);

    s.seek(9_000); // only 3s back, inside the threshold
    s.tick(9_000);
    expect(played(s.tick(10_000))).toEqual([]);
  });

  it('does repeat it on a long rewind', () => {
    const s = new CueScheduler({ replayThresholdMs: 5_000 });
    s.load([cue('a', 10_000, 5_000, 1_000)]);
    s.play();
    s.tick(10_000);
    s.finished('a');
    s.tick(30_000);

    s.seek(9_000); // 21s back, well beyond the threshold
    s.tick(9_000);
    expect(played(s.tick(10_000))).toEqual(['a']);
  });
});

describe('scheduler: playback rate', () => {
  it('stops describing above 1x, because every gap just shrank', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 1_000)]);
    s.play();

    s.setRate(1.5);
    expect(played(s.tick(10_000))).toEqual([]);
  });

  it('cancels anything sounding when the rate changes', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 3_000)]);
    s.play();
    s.tick(10_000);

    expect(dropped(s.setRate(2))).toEqual([['a', 'INVALIDATED']]);
  });

  it('resumes describing back at 1x', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 1_000)]);
    s.play();
    s.setRate(2);
    s.tick(9_000);

    s.setRate(1);
    s.tick(9_500);
    expect(played(s.tick(10_000))).toEqual(['a']);
  });
});

describe('scheduler: the backstop', () => {
  it('cuts off a cue that outlives its gap', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 2_000, 1_000)]);
    s.play();
    s.tick(10_000);
    expect(s.getInFlight()?.id).toBe('a');

    // Gap ended at 12_000 and nothing reported it finished.
    expect(dropped(s.tick(12_500))).toEqual([['a', 'WOULD_OVERRUN']]);
    expect(s.getInFlight()).toBeNull();
  });

  it('leaves a cue alone while it is still inside its gap', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 3_000)]);
    s.play();
    s.tick(10_000);
    expect(s.tick(11_000)).toEqual([]);
    expect(s.getInFlight()?.id).toBe('a');
  });
});

describe('scheduler: nothing happens while paused', () => {
  it('does not start cues before play', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 1_000)]);
    expect(played(s.tick(10_000))).toEqual([]);
  });

  it('does not start cues after pause', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 1_000), cue('b', 20_000, 5_000, 1_000)]);
    s.play();
    s.tick(10_000);
    s.finished('a');
    s.pause();
    expect(played(s.tick(20_000))).toEqual([]);
  });
});

describe('scheduler: load resets everything', () => {
  it('clears played history and in-flight state', () => {
    const s = new CueScheduler();
    s.load([cue('a', 10_000, 5_000, 3_000)]);
    s.play();
    s.tick(10_000);

    s.load([cue('a', 10_000, 5_000, 3_000)]);
    expect(s.getInFlight()).toBeNull();
    expect(s.getState()).toBe('paused');

    s.play();
    expect(played(s.tick(10_000))).toEqual(['a']);
  });
});
