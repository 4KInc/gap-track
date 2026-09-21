/**
 * Probe C — playhead clock resolution and drift.
 *
 * Admission control is only as trustworthy as `currentTime`. This measures
 * three things the safety margin has to absorb:
 *
 *   1. Granularity — the smallest non-zero step the clock actually reports.
 *      If it ticks in 250ms quanta, a 400ms margin is mostly spent on that.
 *   2. Update interval — how often a *new* value appears, not how often we ask.
 *   3. Drift — media time against wall time. Steady drift is survivable and
 *      correctable; jitter under load is what breaks cue placement.
 *
 * Run it on the Vega Virtual Device AND on a physical stick. They can disagree,
 * and the stick is the one that counts.
 */

export interface ClockSample {
  wallMs: number;
  mediaMs: number;
}

export interface ClockReport {
  label: string;
  durationMs: number;
  sampleCount: number;

  /** Smallest non-zero change observed in media time. The real quantum. */
  granularityMs: number;
  /** Distinct media-time values seen per second. */
  effectiveHz: number;

  /** Gaps between *changes* in media time, not between polls. */
  updateIntervalP50Ms: number;
  updateIntervalP95Ms: number;
  updateIntervalMaxMs: number;

  /** mediaElapsed - wallElapsed over the whole run. Sign matters. */
  totalDriftMs: number;
  /** Worst instantaneous divergence from the linear fit. This is the jitter. */
  maxJitterMs: number;

  /** Margin suggestion derived from what was measured, not from a guess. */
  suggestedSafetyMarginMs: number;

  /** Distinct values of currentTime seen. Fewer than 2 means nothing moved. */
  distinctValues: number;
  /** False when the clock never advanced — the report is then meaningless. */
  measured: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * Poll as fast as the runtime allows. Polling faster than the clock updates is
 * the point — it is how the true quantum becomes visible.
 */
export async function probeClock(
  media: { currentTime: number; paused: boolean },
  opts: { label: string; durationMs?: number; pollMs?: number } = { label: 'clock' },
): Promise<ClockReport> {
  const durationMs = opts.durationMs ?? 60_000;
  const pollMs = opts.pollMs ?? 4;

  const samples: ClockSample[] = [];
  const startWall = Date.now();

  await new Promise<void>((resolve) => {
    const id = setInterval(() => {
      samples.push({ wallMs: Date.now() - startWall, mediaMs: media.currentTime * 1000 });
      if (Date.now() - startWall >= durationMs) {
        clearInterval(id);
        resolve();
      }
    }, pollMs);
  });

  // Collapse to the moments where media time actually moved.
  const changes: ClockSample[] = [];
  let lastMedia = Number.NaN;
  for (const s of samples) {
    if (s.mediaMs !== lastMedia) {
      changes.push(s);
      lastMedia = s.mediaMs;
    }
  }

  const steps: number[] = [];
  const intervals: number[] = [];
  for (let i = 1; i < changes.length; i++) {
    const dMedia = changes[i].mediaMs - changes[i - 1].mediaMs;
    const dWall = changes[i].wallMs - changes[i - 1].wallMs;
    if (dMedia > 0) steps.push(dMedia);
    if (dWall > 0) intervals.push(dWall);
  }

  const granularityMs = steps.length ? Math.min(...steps) : 0;
  const sortedIntervals = [...intervals].sort((a, b) => a - b);

  const first = changes[0];
  const last = changes[changes.length - 1];
  const mediaElapsed = last && first ? last.mediaMs - first.mediaMs : 0;
  const wallElapsed = last && first ? last.wallMs - first.wallMs : 0;
  const totalDriftMs = mediaElapsed - wallElapsed;

  // Jitter: divergence from the best-fit line, which removes constant rate error
  // (a clock running 0.2% slow is fine) and leaves the part that hurts.
  const rate = wallElapsed > 0 ? mediaElapsed / wallElapsed : 1;
  let maxJitterMs = 0;
  for (const c of changes) {
    if (!first) break;
    const expected = first.mediaMs + (c.wallMs - first.wallMs) * rate;
    maxJitterMs = Math.max(maxJitterMs, Math.abs(c.mediaMs - expected));
  }

  const p95 = percentile(sortedIntervals, 95);

  const measured = changes.length >= 2 && steps.length > 0;

  return {
    label: opts.label,
    durationMs,
    sampleCount: samples.length,
    distinctValues: changes.length,
    measured,
    granularityMs,
    effectiveHz: wallElapsed > 0 ? (changes.length / wallElapsed) * 1000 : 0,
    updateIntervalP50Ms: percentile(sortedIntervals, 50),
    updateIntervalP95Ms: p95,
    updateIntervalMaxMs: sortedIntervals.length ? sortedIntervals[sortedIntervals.length - 1] : 0,
    totalDriftMs,
    maxJitterMs,
    // One full quantum (we can be a whole tick stale) plus observed jitter,
    // floored at 250ms so a suspiciously clean VVD result cannot talk us into
    // a margin the hardware will not honour.
    suggestedSafetyMarginMs: Math.max(250, Math.ceil(granularityMs + maxJitterMs)),
  };
}

export function formatClockReport(r: ClockReport): string {
  if (!r.measured) {
    return [
      `── PROBE C · ${r.label} ─────────────────────────`,
      `samples             ${r.sampleCount} over ${(r.durationMs / 1000).toFixed(0)}s`,
      `distinct values     ${r.distinctValues}`,
      ``,
      `VERDICT  NO MEASUREMENT. currentTime never advanced, so every number`,
      `         below would have been zero by construction rather than by`,
      `         precision. The clock was not measured; playback did not run.`,
      ``,
      `NEXT     Check the media diagnostics line: is duration a real number,`,
      `         is paused false, is there a media error? A play() that resolves`,
      `         is not proof that anything is decoding.`,
    ].join('\n');
  }

  return [
    `── PROBE C · ${r.label} ─────────────────────────`,
    `samples             ${r.sampleCount} over ${(r.durationMs / 1000).toFixed(0)}s`,
    `granularity         ${r.granularityMs.toFixed(1)} ms   <- the real quantum`,
    `effective rate      ${r.effectiveHz.toFixed(1)} Hz`,
    `update interval     p50 ${r.updateIntervalP50Ms.toFixed(0)} / p95 ${r.updateIntervalP95Ms.toFixed(0)} / max ${r.updateIntervalMaxMs.toFixed(0)} ms`,
    `total drift         ${r.totalDriftMs >= 0 ? '+' : ''}${r.totalDriftMs.toFixed(0)} ms`,
    `max jitter          ${r.maxJitterMs.toFixed(1)} ms   <- this is what breaks cues`,
    ``,
    `SUGGESTED MARGIN    ${r.suggestedSafetyMarginMs} ms`,
    ``,
    r.suggestedSafetyMarginMs > 700
      ? `VERDICT  POOR. A margin this wide eats most short gaps. Schedule cues on`
        + `\n         their own timebase seeded from currentTime, rather than polling it.`
      : `VERDICT  USABLE. Use ${r.suggestedSafetyMarginMs} ms as the margin and move on.`,
  ].join('\n');
}
