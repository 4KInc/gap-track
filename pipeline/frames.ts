/**
 * Pulling stills out of a programme, and asking how long it is.
 *
 * Frames are sampled from just BEFORE a gap, not during it. What needs
 * describing is usually what the scene has just become — a door now open, a
 * face now turned away — and by the time the silence arrives the camera has
 * often already moved on.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
const FFMPEG = ffmpegPath as unknown as string;

/**
 * Programme duration in milliseconds.
 *
 * Parsed from ffmpeg's own report rather than ffprobe, which ffmpeg-static
 * does not ship. ffmpeg writes this to stderr and exits non-zero when given
 * no output file, so both are expected rather than errors.
 */
export async function probeDurationMs(input: string): Promise<number> {
  let stderr = '';
  try {
    await run(FFMPEG, ['-hide_banner', '-i', input]);
  } catch (err) {
    stderr = (err as { stderr?: string }).stderr ?? '';
  }

  const m = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d{1,3})/.exec(stderr);
  if (!m) throw new Error(`could not read a duration from ${input}`);

  const [, h, min, s, frac] = m;
  return (
    ((Number(h) * 60 + Number(min)) * 60 + Number(s)) * 1000
    + Number(frac.padEnd(3, '0'))
  );
}

export interface FrameOptions {
  /** How many stills to take from the run-up to the gap. */
  count?: number;
  /** How far back from the gap to start sampling. */
  lookbackMs?: number;
  /** Longest edge. Smaller costs less per call and loses little. */
  width?: number;
}

/**
 * Sample frames leading into a gap.
 *
 * Seeking before `-i` is the fast path: ffmpeg jumps to the keyframe rather
 * than decoding from the start, which matters when a feature film has
 * hundreds of gaps.
 */
export async function framesBefore(
  video: string,
  gapStartMs: number,
  workDir: string,
  opts: FrameOptions = {},
): Promise<Array<{ data: Buffer; mediaType: 'image/jpeg' }>> {
  const count = opts.count ?? 2;
  const lookbackMs = opts.lookbackMs ?? 2_000;
  const width = opts.width ?? 768;

  await mkdir(workDir, { recursive: true });
  const out: Array<{ data: Buffer; mediaType: 'image/jpeg' }> = [];

  for (let i = 0; i < count; i++) {
    // Spread the samples across the run-up, ending at the gap itself.
    const offset = count === 1 ? 0 : lookbackMs - (lookbackMs * i) / (count - 1);
    const atMs = Math.max(0, gapStartMs - offset);
    const path = join(workDir, `f-${gapStartMs}-${i}.jpg`);

    try {
      await run(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', (atMs / 1000).toFixed(3),
        '-i', video,
        '-frames:v', '1',
        '-vf', `scale=${width}:-2`,
        '-q:v', '4',
        path,
      ]);
      out.push({ data: await readFile(path), mediaType: 'image/jpeg' });
    } catch {
      // A seek past the end, or a corrupt region. One missing frame is not
      // worth failing a film over — the describer works with what it has,
      // and declines if that is nothing.
    } finally {
      await rm(path, { force: true });
    }
  }

  return out;
}
