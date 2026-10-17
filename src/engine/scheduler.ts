/**
 * The cue scheduler.
 *
 * Admission control decides whether a single cue *may* be spoken. This decides
 * *when*, and — more importantly — when to abandon cues that were admitted but
 * have since become wrong.
 *
 * A queue of cues is a set of claims about the near future, and a viewer with
 * a remote invalidates those claims constantly. The failure that matters here
 * is not a collision: it is speaking a confident description of a moment that
 * is no longer on screen, because someone pressed fast-forward. That is worse
 * than silence and harder to notice in testing.
 *
 * Deliberately free of any platform dependency: no React, no Vega, no audio
 * API. It takes a playhead position and returns decisions. That makes it
 * exhaustively testable against a fake clock, and extractable as a standalone
 * package.
 */

import { decide } from './admission';
import type { Cue, Decision, SchedulerConfig } from './types';
import { DEFAULT_CONFIG } from './types';

export type PlaybackState = 'playing' | 'paused' | 'buffering-cues';

export interface SchedulerEvent {
  decision: Decision;
  /** Playhead at the moment of the decision. */
  atMs: number;
}

export class CueScheduler {
  private config: SchedulerConfig;
  private cues: Cue[] = [];
  private pending = new Set<string>();
  private played = new Map<string, number>(); // id -> playhead when played
  private state: PlaybackState = 'paused';
  private rate = 1;
  private lastPlayheadMs = 0;
  /** The cue currently sounding, if any. Cancelled on any invalidation. */
  private inFlight: { cue: Cue; startedAtMs: number } | null = null;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** The constants every decision is measured against. */
  settings(): SchedulerConfig {
    return { ...this.config };
  }

  /**
   * Change the safety margin mid-playback.
   *
   * The margin is a judgement about how close to dialogue is close enough,
   * and that is a viewer's call, not ours: someone who finds narration
   * crowding the dialogue should be able to buy more room, at the price of
   * hearing fewer descriptions. The trade is real and the arithmetic makes
   * it visible.
   *
   * Only cues not yet decided are affected. A cue already sounding keeps the
   * margin it was admitted under, because retroactively failing something
   * already halfway spoken would cut it off mid-word for no benefit — the
   * dialogue it was cleared against has not moved.
   */
  setSafetyMargin(ms: number): void {
    this.config = { ...this.config, safetyMarginMs: Math.max(0, Math.round(ms)) };
  }

  /**
   * Install the cue track for a title. Replaces anything already queued.
   * Cues are sorted so `tick` can stop scanning early.
   */
  load(cues: Cue[]): void {
    this.cues = [...cues].sort((a, b) => a.gap.startMs - b.gap.startMs);
    this.pending = new Set(this.cues.map((c) => c.id));
    this.played.clear();
    this.inFlight = null;
    this.state = 'paused';
  }

  getState(): PlaybackState {
    return this.state;
  }

  getInFlight(): Cue | null {
    return this.inFlight?.cue ?? null;
  }

  play(): void {
    if (this.state === 'paused') this.state = 'playing';
  }

  /**
   * Pause. Anything sounding is cancelled rather than left to finish: the
   * programme has stopped, so a description still talking is describing a
   * frozen frame.
   */
  pause(): SchedulerEvent[] {
    this.state = 'paused';
    return this.cancelInFlight('INVALIDATED', this.lastPlayheadMs);
  }

  /**
   * The viewer moved. Every queued claim about the near future is void.
   *
   * Cues are re-armed rather than discarded, because the viewer may be
   * seeking backwards into material that should be described again. The
   * exception is a short rewind, where replaying a line just heard is worse
   * than staying quiet.
   */
  seek(toMs: number): SchedulerEvent[] {
    const events = this.cancelInFlight('INVALIDATED', toMs);
    const wentBack = toMs < this.lastPlayheadMs;
    const distanceMs = Math.abs(toMs - this.lastPlayheadMs);

    for (const cue of this.cues) {
      if (cue.gap.startMs < toMs) continue; // behind the new position
      const playedAt = this.played.get(cue.id);
      // A short rewind should not replay what the viewer just heard.
      if (playedAt !== undefined && wentBack && distanceMs < this.config.replayThresholdMs) {
        continue;
      }
      this.pending.add(cue.id);
      this.played.delete(cue.id);
    }

    this.lastPlayheadMs = toMs;
    this.state = 'buffering-cues';
    return events;
  }

  /**
   * Playback rate changed. Gaps shrink in wall-clock time as speed rises, so
   * every admission decision taken at 1x is void.
   *
   * v1 simply stops describing above 1x. Re-solving against rate-adjusted
   * durations is possible but it is not worth the risk of a collision to
   * save a feature nobody asked for.
   */
  setRate(rate: number): SchedulerEvent[] {
    this.rate = rate;
    if (rate !== 1) {
      const events = this.cancelInFlight('INVALIDATED', this.lastPlayheadMs);
      this.state = 'buffering-cues';
      return events;
    }
    return [];
  }

  /**
   * Called when a cue's audio finishes naturally.
   */
  finished(cueId: string): void {
    if (this.inFlight?.cue.id === cueId) this.inFlight = null;
  }

  /**
   * Advance to `playheadMs` and return everything decided at this instant.
   *
   * Returns `PLAY` decisions the caller should act on, and `DROP` decisions
   * the caller should log. The scheduler never plays anything itself.
   */
  tick(playheadMs: number): SchedulerEvent[] {
    const events: SchedulerEvent[] = [];
    this.lastPlayheadMs = playheadMs;

    if (this.state === 'buffering-cues') this.state = 'playing';
    if (this.state !== 'playing' || this.rate !== 1) return events;

    // A cue that outlived its gap is cut off rather than allowed to run into
    // dialogue. Admission should have prevented this; this is the backstop.
    if (this.inFlight) {
      const { cue } = this.inFlight;
      const gapEnd = cue.gap.startMs + cue.gap.durationMs;
      if (playheadMs > gapEnd) {
        events.push(...this.cancelInFlight('WOULD_OVERRUN', playheadMs));
      } else {
        return events; // busy, and still safely inside the gap
      }
    }

    for (const cue of this.cues) {
      if (!this.pending.has(cue.id)) continue;
      if (cue.gap.startMs > playheadMs + this.config.lookaheadMs) break; // sorted

      const d = decide(cue, playheadMs, this.config);

      if (d.verdict === 'DROP') {
        // A cue that cannot fit is dead for good. One that is merely early
        // stays queued for a later tick.
        if (d.reason === 'WOULD_OVERRUN' || d.reason === 'NO_AUDIO' || d.reason === 'TOO_LATE') {
          this.pending.delete(cue.id);
          events.push({ decision: d, atMs: playheadMs });
        }
        continue;
      }

      // Admitted, but only start it once the gap has actually arrived.
      if (cue.gap.startMs > playheadMs) continue;

      this.pending.delete(cue.id);
      this.played.set(cue.id, playheadMs);
      this.inFlight = { cue, startedAtMs: playheadMs };
      events.push({ decision: d, atMs: playheadMs });
      break; // one voice at a time
    }

    return events;
  }

  private cancelInFlight(
    reason: 'INVALIDATED' | 'WOULD_OVERRUN',
    atMs: number,
  ): SchedulerEvent[] {
    if (!this.inFlight) return [];
    const { cue } = this.inFlight;
    this.inFlight = null;
    return [{ decision: { verdict: 'DROP', cue, reason, overrunMs: 0 }, atMs }];
  }
}
