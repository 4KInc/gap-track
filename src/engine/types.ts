/**
 * The vocabulary the engine is built from.
 *
 * One rule governs everything here: a description may only be spoken if it
 * provably fits inside a measured silence. Every type below exists to make
 * that rule checkable rather than hoped for.
 */

/** A measured stretch of the programme with no speech in it. */
export interface Gap {
  /** Milliseconds from the start of the title. */
  startMs: number;
  /** Measured, not estimated. */
  durationMs: number;
}

/**
 * A candidate description, generated for one gap.
 *
 * `audioDurationMs` is the duration of the *rendered audio asset*, measured
 * after synthesis. It is deliberately not a words-per-minute estimate, not a
 * token count, and not the model's own guess at how long it takes to say.
 * The whole guarantee rests on this number being real.
 */
export interface Cue {
  id: string;
  /** The gap this was written for. */
  gap: Gap;
  text: string;
  audioDurationMs: number;
  /** Offset into the title's single description track. */
  trackOffsetMs: number;
}

export type DropReason =
  /** Audio plus margin exceeds the gap. The common case, and the point. */
  | 'WOULD_OVERRUN'
  /** Arrived after its gap had already passed. */
  | 'TOO_LATE'
  /** The viewer seeked, paused, or changed rate; the queue is stale. */
  | 'INVALIDATED'
  /** No audio was produced for this cue. */
  | 'NO_AUDIO';

export type Decision =
  | {
      verdict: 'PLAY';
      cue: Cue;
      /** Spare time left in the gap. Useful on screen; proves the margin held. */
      headroomMs: number;
    }
  | {
      verdict: 'DROP';
      cue: Cue;
      reason: DropReason;
      /** How far over it would have run. Zero for non-timing drops. */
      overrunMs: number;
    };

export interface SchedulerConfig {
  /**
   * Safety margin in milliseconds.
   *
   * Measured on a Vega Virtual Device 2026-10-09: `currentTime` advances in
   * 100ms quanta with no jitter over the sampling window, so a cue can be up
   * to one full tick stale before we even look at it. 250ms is the floor,
   * giving 100ms of quantisation plus headroom. Re-measure on hardware; a
   * flat zero for jitter is the kind of flattery an emulator produces.
   */
  safetyMarginMs: number;

  /**
   * How far ahead of the playhead a cue is considered for admission. Below
   * this it is too late to start cleanly.
   */
  lookaheadMs: number;

  /**
   * After a short rewind, do not replay a cue the viewer just heard unless
   * they moved back further than this.
   */
  replayThresholdMs: number;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  safetyMarginMs: 250,
  lookaheadMs: 20_000,
  replayThresholdMs: 5_000,
};
