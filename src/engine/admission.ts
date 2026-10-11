/**
 * Admission control.
 *
 * This is the whole product in one function. A language model proposes a
 * description; this decides whether it is allowed to be spoken. The decision
 * is arithmetic on two measured numbers, so it can be stated, tested, and
 * shown on screen.
 *
 *     admit  ⟺  audioDurationMs + safetyMarginMs <= gap.durationMs
 *
 * Nothing here consults the model, the text, or anything probabilistic. A cue
 * that does not fit is discarded rather than shortened, faded, or played late,
 * because a description that collides with dialogue is worse than no
 * description at all: the viewer loses the line they could hear AND does not
 * get the picture.
 */

import type { Cue, Decision, Gap, SchedulerConfig } from './types';

/**
 * Decide a single cue against its gap.
 *
 * `playheadMs` is where the viewer actually is. A cue whose gap has already
 * started by more than the margin cannot begin cleanly and is dropped as late
 * rather than squeezed in.
 */
export function decide(
  cue: Cue,
  playheadMs: number,
  config: SchedulerConfig,
): Decision {
  if (!(cue.audioDurationMs > 0)) {
    return { verdict: 'DROP', cue, reason: 'NO_AUDIO', overrunMs: 0 };
  }

  const required = cue.audioDurationMs + config.safetyMarginMs;

  // Could it ever have fitted, starting from the top of its gap? A cue that
  // fails here is dropped for the honest reason even if it is also late.
  if (required > cue.gap.durationMs) {
    return {
      verdict: 'DROP',
      cue,
      reason: 'WOULD_OVERRUN',
      overrunMs: required - cue.gap.durationMs,
    };
  }

  // Can it still finish inside the gap from where the viewer actually is?
  // The question is completion, not punctuality: arriving 300ms into a
  // five-second silence is perfectly fine, and the earlier version of this
  // check wrongly discarded exactly that case.
  const gapEndMs = cue.gap.startMs + cue.gap.durationMs;
  const effectiveStartMs = Math.max(playheadMs, cue.gap.startMs);
  const remainingMs = gapEndMs - effectiveStartMs;

  if (required > remainingMs) {
    return { verdict: 'DROP', cue, reason: 'TOO_LATE', overrunMs: 0 };
  }

  return { verdict: 'PLAY', cue, headroomMs: remainingMs - required };
}

/**
 * Human-readable one-liner for the on-screen trust overlay and the logs.
 *
 * Deliberately shows the arithmetic rather than the conclusion. A judge
 * watching a cue get discarded should be able to see why from the numbers.
 */
export function explain(d: Decision, config: SchedulerConfig): string {
  const { cue } = d;
  const sum = `${cue.audioDurationMs} + ${config.safetyMarginMs}`;
  if (d.verdict === 'PLAY') {
    return `PLAY   ${sum} <= ${cue.gap.durationMs}ms  ·  ${d.headroomMs}ms spare  ·  "${cue.text}"`;
  }
  if (d.reason === 'WOULD_OVERRUN') {
    return `DROP   ${sum} > ${cue.gap.durationMs}ms  ·  would overrun by ${d.overrunMs}ms  ·  "${cue.text}"`;
  }
  return `DROP   ${d.reason}  ·  "${cue.text}"`;
}

/**
 * The word budget a gap can afford.
 *
 * Used when generating, so the model writes to a brief instead of being
 * truncated afterwards. ~2.5 words per second of speech is a conservative
 * rate for description narration, which is read a little slower than
 * conversation.
 *
 * Returns 0 when the gap cannot hold even one word, which is the correct
 * answer for a gap that should not be described at all.
 */
export function wordBudget(gap: Gap, config: SchedulerConfig): number {
  const usableMs = gap.durationMs - config.safetyMarginMs;
  if (usableMs <= 0) return 0;
  return Math.floor((usableMs / 1000) * 2.5);
}
