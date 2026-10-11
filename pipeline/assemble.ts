/**
 * Cue-track assembly.
 *
 * Every description for a title is laid into ONE audio track at its position
 * on the programme timeline, with silence in between. The alternative — a
 * file per cue — would mean hundreds of packaging runs per film and hundreds
 * of fetches at playback, when the device already knows how to play exactly
 * one synchronised audio stream.
 *
 * Because the track is timeline-aligned, `trackOffsetMs` equals the gap's
 * start. The device plays the description track in step with the video and
 * the scheduler decides what is allowed to be heard.
 *
 * Admission runs here too, on the same arithmetic the device uses. A cue that
 * cannot fit contributes no audio, but it is still reported in the manifest
 * with its measured numbers and the reason it was refused, because that
 * record is the evidence the guarantee is real.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decide } from '../src/engine/admission';
import { DEFAULT_CONFIG, type Cue, type Gap, type SchedulerConfig } from '../src/engine/types';
import { makeWav, wavData } from './synthesis/wav';
import type { Synthesizer } from './synthesis/types';

/** A description written for a gap, before it has been rendered or judged. */
export interface Candidate {
  gap: Gap;
  text: string;
}

export interface RejectedCue {
  gap: Gap;
  text: string;
  audioDurationMs: number;
  reason: string;
  overrunMs: number;
}

export interface CueTrack {
  titleId: string;
  /** Programme duration, and therefore the track's. */
  durationMs: number;
  sampleRate: number;
  /** The single assembled WAV, timeline-aligned with the programme. */
  audioPath: string;
  manifestPath: string;
  cues: Cue[];
  rejected: RejectedCue[];
  config: SchedulerConfig;
}

export interface AssembleOptions {
  titleId: string;
  /** Programme duration. The track is built to match. */
  durationMs: number;
  synth: Synthesizer;
  outDir: string;
  config?: Partial<SchedulerConfig>;
}

const bytesPerMs = (sampleRate: number) => (sampleRate * 2) / 1000; // mono, 16-bit

/**
 * Render, judge, and lay out a title's descriptions.
 *
 * Candidates are processed in timeline order so the manifest reads like the
 * film. Synthesis happens before admission because admission needs the
 * measured duration, which only exists once the audio does.
 */
export async function assembleTrack(
  candidates: Candidate[],
  opts: AssembleOptions,
): Promise<CueTrack> {
  const config = { ...DEFAULT_CONFIG, ...opts.config };
  const sampleRate = opts.synth.sampleRate;
  const workDir = join(opts.outDir, opts.titleId);
  await mkdir(workDir, { recursive: true });

  const ordered = [...candidates].sort((a, b) => a.gap.startMs - b.gap.startMs);
  const cues: Cue[] = [];
  const rejected: RejectedCue[] = [];
  const renderedPaths = new Map<string, string>();

  for (let i = 0; i < ordered.length; i++) {
    const { gap, text } = ordered[i];
    const id = `${opts.titleId}-${String(i).padStart(4, '0')}`;
    const partPath = join(workDir, `${id}.wav`);

    let audioDurationMs: number;
    try {
      const r = await opts.synth.synthesize(text, partPath);
      audioDurationMs = r.durationMs;
      renderedPaths.set(id, r.audioPath);
    } catch (err) {
      // Could not render or could not measure. Either way there is no
      // trustworthy duration, so it is refused rather than guessed at.
      rejected.push({
        gap,
        text,
        audioDurationMs: 0,
        reason: 'NO_AUDIO',
        overrunMs: 0,
      });
      continue;
    }

    const cue: Cue = { id, gap, text, audioDurationMs, trackOffsetMs: gap.startMs };

    // Judged from the top of its own gap: at build time there is no playhead,
    // and the question is whether this cue can ever be spoken safely.
    const d = decide(cue, gap.startMs, config);
    if (d.verdict === 'PLAY') {
      // Admission judges one cue at a time, so it cannot see that the
      // previous description is still sounding. Adjacent gaps are common in
      // real films, so the later cue is refused rather than the whole track
      // being abandoned.
      const prev = cues[cues.length - 1];
      const prevEndMs = prev ? prev.trackOffsetMs + prev.audioDurationMs : -1;
      if (cue.trackOffsetMs < prevEndMs) {
        renderedPaths.delete(id);
        rejected.push({
          gap,
          text,
          audioDurationMs,
          reason: 'OVERLAPS_PREVIOUS',
          overrunMs: prevEndMs - cue.trackOffsetMs,
        });
      } else {
        cues.push(cue);
      }
    } else {
      renderedPaths.delete(id);
      rejected.push({
        gap,
        text,
        audioDurationMs,
        reason: d.reason,
        overrunMs: d.overrunMs,
      });
    }
  }

  const audioPath = join(workDir, 'description.wav');
  await writeTimelineTrack(cues, renderedPaths, {
    audioPath,
    durationMs: opts.durationMs,
    sampleRate,
  });

  const manifestPath = join(workDir, 'cues.json');
  const track: CueTrack = {
    titleId: opts.titleId,
    durationMs: opts.durationMs,
    sampleRate,
    audioPath,
    manifestPath,
    cues,
    rejected,
    config,
  };
  await writeFile(manifestPath, `${JSON.stringify(track, null, 2)}\n`, 'utf8');

  return track;
}

/**
 * Lay rendered cues into one silent track at their timeline positions.
 *
 * Overlap is treated as a bug rather than mixed, because two descriptions
 * sounding at once is exactly the incoherence this project exists to avoid.
 * Admission should already have made it impossible; this asserts it.
 */
async function writeTimelineTrack(
  cues: Cue[],
  renderedPaths: Map<string, string>,
  out: { audioPath: string; durationMs: number; sampleRate: number },
): Promise<void> {
  const bpms = bytesPerMs(out.sampleRate);
  const header = makeWav({ durationMs: out.durationMs, sampleRate: out.sampleRate });
  const { data: silence } = wavData(header);

  let lastEndMs = -1;
  for (const cue of cues) {
    const path = renderedPaths.get(cue.id);
    if (!path) continue;

    // Should be unreachable: overlapping cues are refused during admission.
    // Kept as an assertion because two descriptions sounding at once is the
    // precise incoherence this project exists to prevent.
    if (cue.trackOffsetMs < lastEndMs) {
      throw new Error(
        `cue ${cue.id} starts at ${cue.trackOffsetMs}ms, overlapping the previous cue `
        + `which ends at ${lastEndMs}ms — two descriptions cannot sound at once`,
      );
    }

    const { info, data } = wavData(await readFile(path));
    if (info.sampleRate !== out.sampleRate) {
      throw new Error(
        `cue ${cue.id} is ${info.sampleRate}Hz but the track is ${out.sampleRate}Hz; `
        + 'resampling is the synthesiser\'s job, not the assembler\'s',
      );
    }

    // Align to a whole sample so the copy cannot land mid-frame, which would
    // swap the bytes of one sample and click.
    const byteOffset = Math.round((cue.trackOffsetMs * bpms) / 2) * 2;
    if (byteOffset + data.length > silence.length) {
      throw new Error(
        `cue ${cue.id} at ${cue.trackOffsetMs}ms runs past the end of the programme`,
      );
    }

    data.copy(silence, byteOffset);
    lastEndMs = cue.trackOffsetMs + cue.audioDurationMs;
  }

  await writeFile(out.audioPath, header);
}

/** Summary line for the build log. */
export function summarise(track: CueTrack): string {
  const total = track.cues.length + track.rejected.length;
  const byReason = track.rejected.reduce<Record<string, number>>((acc, r) => {
    acc[r.reason] = (acc[r.reason] ?? 0) + 1;
    return acc;
  }, {});
  const reasons = Object.entries(byReason)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  return (
    `${track.titleId}: ${track.cues.length}/${total} admitted`
    + (reasons ? `  ·  dropped: ${reasons}` : '')
  );
}
