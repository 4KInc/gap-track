/**
 * Probes A and B — concurrent audio, and per-element gain.
 *
 * A: can a second audio element sound while video audio is playing, or does
 *    the GStreamer sink go to one owner? This decides whether Adaptive
 *    Description is possible at all, or whether Pause-and-Describe becomes
 *    the primary mode.
 *
 * B: can the programme duck independently while the cue plays?
 *
 * HONESTY NOTE, and it matters:
 * No automated check can prove a sound was *audible*. An element will happily
 * report `paused === false` while routed to a sink producing nothing. So each
 * probe returns machine evidence (did media time advance? did volume read
 * back?) AND requires a human verdict. Record both. A machine PASS with a
 * human FAIL is the single most likely outcome here, and it is exactly the
 * result that would waste three weeks if it surfaced late.
 */

export type HumanVerdict = 'heard-both' | 'heard-video-only' | 'heard-cue-only' | 'heard-neither';

export interface MediaLike {
  currentTime: number;
  paused: boolean;
  volume: number;
  play(): Promise<void> | void;
  pause(): void;
}

export interface ConcurrencyReport {
  label: string;
  videoAdvancedMs: number;
  cueAdvancedMs: number;
  /** Both elements reported progress while overlapping. Necessary, not sufficient. */
  machinePass: boolean;
  humanVerdict: HumanVerdict | null;
  notes: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Did this element's clock actually move? Silence often shows up as a frozen clock. */
async function advanceOver(el: MediaLike, ms: number): Promise<number> {
  const t0 = el.currentTime;
  await sleep(ms);
  return (el.currentTime - t0) * 1000;
}

/**
 * PROBE A — start video, let it settle, then start the cue element over it.
 * Watch whether both clocks keep moving while they overlap.
 */
export async function probeConcurrentAudio(
  video: MediaLike,
  cue: MediaLike,
  opts: { label?: string; overlapMs?: number } = {},
): Promise<ConcurrencyReport> {
  const label = opts.label ?? 'concurrent-audio';
  const overlapMs = opts.overlapMs ?? 3000;
  const notes: string[] = [];

  await video.play();
  await sleep(800);
  if (video.paused) notes.push('video refused to start — probe invalid, fix playback first');

  const videoBefore = video.currentTime;

  await cue.play();
  await sleep(200);
  if (cue.paused) {
    notes.push('cue element reports paused immediately after play() — sink likely refused');
  }

  const [videoAdvancedMs, cueAdvancedMs] = await Promise.all([
    advanceOver(video, overlapMs),
    advanceOver(cue, overlapMs),
  ]);

  cue.pause();
  video.pause();

  // Allow generous slack: a stalled clock reads ~0, a healthy one tracks wall time.
  const threshold = overlapMs * 0.5;
  const machinePass = videoAdvancedMs > threshold && cueAdvancedMs > threshold;

  if (videoAdvancedMs <= threshold) notes.push('VIDEO clock stalled during overlap — the cue stole the sink');
  if (cueAdvancedMs <= threshold) notes.push('CUE clock stalled during overlap — video holds the sink exclusively');
  if (video.currentTime < videoBefore) notes.push('video time went backwards — seek or reload side effect');

  return { label, videoAdvancedMs, cueAdvancedMs, machinePass, humanVerdict: null, notes };
}

export interface DuckingReport {
  label: string;
  restingVolume: number;
  requestedDuckVolume: number;
  observedDuckVolume: number;
  /** The runtime accepted and reported back the reduced value. */
  volumeIsWritable: boolean;
  restoredCleanly: boolean;
  humanNoticedDuck: boolean | null;
  notes: string[];
}

/**
 * PROBE B — drop the programme volume while a cue plays, then restore.
 * `volume` is a documented standard property on the Vega media element; whether
 * it is honoured per-element during concurrent playback is the open question.
 */
export async function probeDucking(
  video: MediaLike,
  cue: MediaLike,
  opts: { label?: string; duckTo?: number; holdMs?: number } = {},
): Promise<DuckingReport> {
  const label = opts.label ?? 'ducking';
  const duckTo = opts.duckTo ?? 0.35;
  const holdMs = opts.holdMs ?? 2500;
  const notes: string[] = [];

  await video.play();
  await sleep(800);

  const restingVolume = video.volume;

  await cue.play();
  video.volume = duckTo;
  await sleep(120);
  const observedDuckVolume = video.volume;

  await sleep(holdMs);

  cue.pause();
  video.volume = restingVolume;
  await sleep(120);
  const restoredCleanly = Math.abs(video.volume - restingVolume) < 0.01;

  video.pause();

  const volumeIsWritable = Math.abs(observedDuckVolume - duckTo) < 0.01;
  if (!volumeIsWritable) {
    notes.push(
      `volume did not take: asked ${duckTo}, read back ${observedDuckVolume}. `
      + 'Fall back to synthesising cues louder and leaving the mix alone.',
    );
  }
  if (!restoredCleanly) notes.push('volume did not restore — viewers would be left quiet after a cue');

  return {
    label,
    restingVolume,
    requestedDuckVolume: duckTo,
    observedDuckVolume,
    volumeIsWritable,
    restoredCleanly,
    humanNoticedDuck: null,
    notes,
  };
}

export interface PlacementReport {
  label: string;
  runs: number;
  startOffsetsMs: number[];
  startP50Ms: number;
  startP95Ms: number;
  startMaxMs: number;
  recommendedMarginMs: number;
}

/**
 * PROBE A2 — placement accuracy across repeated runs. One good cue proves
 * nothing; the margin has to cover the worst of ten, not the median.
 */
export async function probeCuePlacement(
  video: MediaLike,
  cue: MediaLike,
  opts: { label?: string; runs?: number; targetOffsetMs?: number } = {},
): Promise<PlacementReport> {
  const label = opts.label ?? 'cue-placement';
  const runs = opts.runs ?? 10;
  const targetOffsetMs = opts.targetOffsetMs ?? 2000;
  const startOffsetsMs: number[] = [];

  for (let i = 0; i < runs; i++) {
    video.currentTime = 0;
    await video.play();
    const target = targetOffsetMs;

    // Spin until the playhead reaches the target, then fire immediately.
    while (video.currentTime * 1000 < target) await sleep(2);

    const firedAtMediaMs = video.currentTime * 1000;
    const wallAtFire = Date.now();
    await cue.play();
    const audibleLatencyMs = Date.now() - wallAtFire;

    startOffsetsMs.push(firedAtMediaMs - target + audibleLatencyMs);

    await sleep(1200);
    cue.pause();
    cue.currentTime = 0;
    video.pause();
  }

  const sorted = [...startOffsetsMs].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))];
  const max = sorted[sorted.length - 1];

  return {
    label,
    runs,
    startOffsetsMs,
    startP50Ms: p(50),
    startP95Ms: p(95),
    startMaxMs: max,
    recommendedMarginMs: Math.max(250, Math.ceil(max * 1.5)),
  };
}

export function formatAudioReports(
  a: ConcurrencyReport,
  b: DuckingReport,
  c?: PlacementReport,
): string {
  const lines = [
    `── PROBE A · ${a.label} ─────────────────────────`,
    `video advanced      ${a.videoAdvancedMs.toFixed(0)} ms`,
    `cue advanced        ${a.cueAdvancedMs.toFixed(0)} ms`,
    `machine             ${a.machinePass ? 'PASS' : 'FAIL'}`,
    `human               ${a.humanVerdict ?? 'NOT RECORDED — listen and set this'}`,
    ...a.notes.map((n) => `  ! ${n}`),
    ``,
    `── PROBE B · ${b.label} ─────────────────────────`,
    `volume writable     ${b.volumeIsWritable ? 'YES' : 'NO'} (asked ${b.requestedDuckVolume}, read ${b.observedDuckVolume})`,
    `restored cleanly    ${b.restoredCleanly ? 'YES' : 'NO'}`,
    `human heard duck    ${b.humanNoticedDuck === null ? 'NOT RECORDED' : b.humanNoticedDuck ? 'YES' : 'NO'}`,
    ...b.notes.map((n) => `  ! ${n}`),
  ];

  if (c) {
    lines.push(
      ``,
      `── PROBE A2 · ${c.label} ────────────────────────`,
      `runs                ${c.runs}`,
      `start offset        p50 ${c.startP50Ms.toFixed(0)} / p95 ${c.startP95Ms.toFixed(0)} / max ${c.startMaxMs.toFixed(0)} ms`,
      `margin from worst   ${c.recommendedMarginMs} ms`,
    );
  }

  lines.push(
    ``,
    `DECISION`,
    a.machinePass && a.humanVerdict === 'heard-both'
      ? `  Adaptive Description is viable. Margin = max(clock probe, placement probe).`
      : a.humanVerdict === null
        ? `  INCOMPLETE — the machine cannot hear. Play it, listen, record humanVerdict.`
        : `  Concurrent audio failed. Pause-and-Describe becomes the primary mode.`
        + `\n  This is a planned branch, not a setback. Write the friction log now.`,
  );

  return lines.join('\n');
}
