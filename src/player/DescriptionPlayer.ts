/**
 * Turning a cue manifest into audio on a television.
 *
 * The description track is timeline-aligned with the programme, so playing a
 * cue means seeking the description audio to the cue's offset, letting it
 * run for its measured duration, and stopping. The scheduler decides which
 * cues are allowed; this does what it says and reports what happened.
 *
 * Two modes, because the platform question is still open:
 *
 *   Adaptive       narration plays over the programme, in the gaps. Requires
 *                  the audio policy to permit two concurrent streams, which
 *                  cannot be verified on the virtual device (FRICTION.md 9).
 *
 *   PauseDescribe  the programme pauses, the description plays, the
 *                  programme resumes. Needs only one audio path at a time,
 *                  so it works whatever the mixing policy turns out to do,
 *                  and is the right choice for content with no usable gaps.
 *
 * Both run through the same scheduler and the same admission rule, so the
 * guarantee does not depend on which one the hardware allows.
 */

import { CueScheduler, type SchedulerEvent } from '../engine/scheduler';
import { explain } from '../engine/admission';
import { DEFAULT_CONFIG, type Cue, type SchedulerConfig } from '../engine/types';
import { toMs, toSeconds, type DecisionSink, type MediaPort } from './ports';

export type DescriptionMode = 'off' | 'adaptive' | 'pause-describe';

export interface CueManifest {
  titleId: string;
  durationMs: number;
  cues: Cue[];
}

export interface DescriptionPlayerOptions {
  config?: Partial<SchedulerConfig>;
  /** How far the programme ducks under narration, 0..1. Adaptive mode only. */
  duckTo?: number;
  onDecision?: DecisionSink;
}

export class DescriptionPlayer {
  private readonly scheduler: CueScheduler;
  private readonly config: SchedulerConfig;
  private readonly duckTo: number;
  private readonly sink: DecisionSink;

  private mode: DescriptionMode = 'off';
  private lastPlayheadMs = 0;
  /** Programme volume before ducking, restored afterwards. */
  private restoreVolume: number | null = null;
  private speaking: { cue: Cue; endsAtMs: number } | null = null;
  /** True while the programme is held for pause-and-describe. */
  private holding = false;
  /**
   * Decisions since the caller last asked.
   *
   * The sink carries a formatted line for logs; the overlay needs the
   * structured decision so it can lay out the operands itself. Buffered
   * rather than pushed, so a UI that renders at its own pace cannot drop
   * one or force a render per tick.
   */
  private pending: SchedulerEvent[] = [];

  constructor(
    private readonly video: MediaPort,
    private readonly description: MediaPort,
    opts: DescriptionPlayerOptions = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
    this.scheduler = new CueScheduler(this.config);
    this.duckTo = opts.duckTo ?? 0.3;
    this.sink = opts.onDecision ?? (() => {});
  }

  load(manifest: CueManifest): void {
    this.scheduler.load(manifest.cues);
    this.speaking = null;
    this.holding = false;
  }

  setMode(mode: DescriptionMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'off') this.stopSpeaking();
    else this.scheduler.play();
  }

  getMode(): DescriptionMode {
    return this.mode;
  }

  isSpeaking(): boolean {
    return this.speaking !== null;
  }

  /** The viewer moved. Everything queued is now a claim about the wrong scene. */
  seek(toSecondsValue: number): void {
    const ms = toMs(toSecondsValue);
    this.stopSpeaking();
    this.report(this.scheduler.seek(ms));
    this.lastPlayheadMs = ms;
  }

  pause(): void {
    this.stopSpeaking();
    this.report(this.scheduler.pause());
  }

  resume(): void {
    this.scheduler.play();
  }

  setRate(rate: number): void {
    this.report(this.scheduler.setRate(rate));
    if (rate !== 1) this.stopSpeaking();
  }

  /**
   * Drive one step. Call from the playback loop.
   *
   * Reads the playhead from the programme rather than taking it as an
   * argument, so the description can never be scheduled against a clock that
   * has drifted from what the viewer is watching.
   */
  tick(): void {
    if (this.mode === 'off') return;

    const playheadMs = toMs(this.video.currentTime);
    this.lastPlayheadMs = playheadMs;

    if (this.speaking) {
      // In pause-and-describe the programme is held, so its clock is frozen
      // and cannot time the cue out. The description track's own position is
      // the only honest measure of how far through we are.
      const doneMs = this.holding
        ? toMs(this.description.currentTime)
        : playheadMs;
      const finished = this.holding
        ? doneMs >= this.speaking.endsAtMs
        : playheadMs >= this.speaking.endsAtMs;
      if (finished) this.stopSpeaking();
      else return;
    }

    for (const ev of this.scheduler.tick(playheadMs)) {
      if (ev.decision.verdict === 'PLAY') this.speak(ev.decision.cue);
      this.report([ev]);
    }
  }

  /**
   * Offer a cue the gap could not hold, by stopping the programme for it.
   *
   * Only meaningful in pause-and-describe. The viewer has opted into losing
   * flow in exchange for hearing descriptions that would not otherwise fit,
   * which is the right trade for a lecture or a documentary and the wrong
   * one for a thriller.
   */
  describeByPausing(cue: Cue): void {
    if (this.mode !== 'pause-describe' || this.speaking) return;
    this.video.pause();
    this.holding = true;
    this.startDescriptionAt(cue);
    this.sink(`HOLD   programme paused for "${cue.text}"`);
  }

  private speak(cue: Cue): void {
    if (this.mode === 'pause-describe') {
      this.describeByPausing(cue);
      return;
    }

    // Adaptive: duck the programme and narrate over it.
    if (this.restoreVolume === null) {
      this.restoreVolume = this.video.volume;
      this.video.volume = this.duckTo;
    }
    this.startDescriptionAt(cue);
  }

  private startDescriptionAt(cue: Cue): void {
    // Timeline-aligned track: the cue lives at its own programme offset.
    this.description.currentTime = toSeconds(cue.trackOffsetMs);
    void this.description.play();
    this.speaking = {
      cue,
      endsAtMs: this.holding
        ? cue.trackOffsetMs + cue.audioDurationMs
        : this.lastPlayheadMs + cue.audioDurationMs,
    };
  }

  private stopSpeaking(): void {
    const wasSpeaking = this.speaking !== null;
    if (this.speaking) {
      this.scheduler.finished(this.speaking.cue.id);
      this.speaking = null;
    }

    // Only touch the description element if it was actually running. Pausing
    // an idle media pipeline is a pointless state transition on a device, and
    // this path is reached on every seek, pause and rate change.
    if (wasSpeaking) this.description.pause();

    if (this.restoreVolume !== null) {
      this.video.volume = this.restoreVolume;
      this.restoreVolume = null;
    }
    if (this.holding) {
      this.holding = false;
      void this.video.play();
    }
  }

  /**
   * Decisions since the last call, newest first. Draining rather than
   * peeking: each decision is a one-time event, and re-reporting it would
   * make the overlay's history lie about how often cues were judged.
   */
  currentDecisions(): SchedulerEvent[] {
    if (this.pending.length === 0) return [];
    const out = this.pending.reverse();
    this.pending = [];
    return out;
  }

  /** What is sounding right now, for display. */
  speakingText(): string | null {
    return this.speaking?.cue.text ?? null;
  }

  private report(events: SchedulerEvent[]): void {
    for (const ev of events) {
      this.pending.push(ev);
      this.sink(explain(ev.decision, this.config));
    }
  }
}
