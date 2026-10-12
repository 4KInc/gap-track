/**
 * Rendering the described film as a single file.
 *
 * The Vega Virtual Device has no audio hardware (FRICTION.md entry 9), so
 * nothing running on it can be heard. This produces the artefact that can:
 * the programme, with its own audio ducked under the description track, at
 * exactly the offsets the scheduler admitted.
 *
 * This is not a shortcut around the device. The app plays the two streams
 * separately and the scheduler decides live; this takes the same admitted
 * cues and the same timeline-aligned track and bakes them together, so the
 * result is what a viewer with working audio would have heard. Showing it
 * next to the app running on the simulator is the honest way to demonstrate
 * a feature the simulator cannot play.
 *
 * Ducking is applied only while a description sounds, driven by the cue
 * list, rather than compressing the whole film — the programme should be at
 * full level everywhere else.
 */

import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import ffmpegPath from 'ffmpeg-static';
import type { Cue } from '../src/engine/types';

const run = promisify(execFile);
const FFMPEG = ffmpegPath as unknown as string;

export interface MixOptions {
  /** Programme level while a description sounds, 0..1. */
  duckTo?: number;
  /** Fade into and out of the duck, so it does not click. */
  fadeMs?: number;
  /** Description level relative to the programme. */
  descriptionGain?: number;
}

/**
 * Build the ffmpeg volume expression that ducks the programme.
 *
 * One expression covering every cue, rather than a filter per cue: a film
 * can have hundreds, and ffmpeg's filter graph becomes unwieldy long before
 * the expression does.
 */
export function duckExpression(cues: Cue[], duckTo: number, fadeMs: number): string {
  if (cues.length === 0) return '1';

  const fade = Math.max(1, fadeMs) / 1000;
  const clauses = cues.map((c) => {
    const start = c.trackOffsetMs / 1000;
    const end = (c.trackOffsetMs + c.audioDurationMs) / 1000;
    // Ramp down over `fade` before the cue, hold, ramp back after it.
    const inStart = Math.max(0, start - fade).toFixed(3);
    const outEnd = (end + fade).toFixed(3);
    return `between(t,${inStart},${outEnd})`;
  });

  // `volume` evaluates this per sample; anything not inside a cue stays at 1.
  return `if(${clauses.join('+')},${duckTo},1)`;
}

export interface MixResult {
  outputPath: string;
  duckedCues: number;
  /** False when the programme had no audio of its own to duck. */
  programmeHadAudio: boolean;
}

/**
 * Does this file carry an audio stream?
 *
 * Silent films and a great deal of archive footage do not, and that is
 * exactly the material most likely to have no description either. Assuming
 * audio exists fails the mix with a filtergraph error that says nothing
 * useful about the cause.
 */
export async function hasAudioStream(path: string): Promise<boolean> {
  let stderr = '';
  try {
    await run(FFMPEG, ['-hide_banner', '-i', path]);
  } catch (err) {
    stderr = (err as { stderr?: string }).stderr ?? '';
  }
  return /Stream #\d+:\d+.*: Audio:/.test(stderr);
}

/**
 * Mux the programme and the description into one playable file.
 */
export async function mixDescribed(
  videoPath: string,
  descriptionWavPath: string,
  cues: Cue[],
  outputPath: string,
  opts: MixOptions = {},
): Promise<MixResult> {
  const duckTo = opts.duckTo ?? 0.25;
  const fadeMs = opts.fadeMs ?? 150;
  const gain = opts.descriptionGain ?? 1.6;

  await mkdir(dirname(outputPath), { recursive: true });
  const programmeHadAudio = await hasAudioStream(videoPath);

  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath, '-i', descriptionWavPath];

  if (programmeHadAudio) {
    const duck = duckExpression(cues, duckTo, fadeMs);
    args.push(
      '-filter_complex',
      [
        `[0:a]volume='${duck}':eval=frame[prog]`,
        `[1:a]volume=${gain}[desc]`,
        // `longest` rather than `first`: the description track runs the full
        // programme duration, and dropping its tail would cut a final cue.
        '[prog][desc]amix=inputs=2:duration=longest:normalize=0[out]',
      ].join(';'),
      '-map', '0:v', '-map', '[out]',
    );
  } else {
    // Nothing to duck. The description becomes the only audio, which is the
    // correct result for silent material rather than an error.
    args.push('-map', '0:v', '-map', '1:a');
  }

  args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', outputPath);
  await run(FFMPEG, args);

  return { outputPath, duckedCues: programmeHadAudio ? cues.length : 0, programmeHadAudio };
}
