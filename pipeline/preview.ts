/**
 * Preview frames.
 *
 * The Vega Virtual Device cannot decode video (FRICTION.md entry 10), so an
 * app running on it shows a black rectangle however correct the stream is.
 * This extracts a low-rate strip of stills that the app can display instead,
 * advanced by the playhead, so a constrained device still shows the viewer
 * something.
 *
 * It is a fallback, not a substitute. On hardware the real stream plays and
 * none of this is fetched. Wherever it IS used the app says so on screen,
 * because a sequence of stills presented as playback would be a lie about
 * what the device did.
 *
 * Reusing the frame extraction the describer already needs would be neater
 * but wrong: those are sampled at gap boundaries, which is exactly where the
 * picture is least representative of the scene as a whole.
 */

import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
const FFMPEG = ffmpegPath as unknown as string;

export interface PreviewOptions {
  /** Frames per second. Two is enough to read as motion on a 10-foot UI. */
  fps?: number;
  width?: number;
  /** JPEG quality, 2 (best) to 31. */
  quality?: number;
}

export interface PreviewStrip {
  dir: string;
  fps: number;
  width: number;
  count: number;
  /** Written beside the frames; the app fetches this to know what exists. */
  indexPath: string;
}

/**
 * Extract an evenly spaced strip of stills across the whole programme.
 */
export async function extractPreview(
  videoPath: string,
  outDir: string,
  opts: PreviewOptions = {},
): Promise<PreviewStrip> {
  const fps = opts.fps ?? 2;
  const width = opts.width ?? 640;
  const quality = opts.quality ?? 6;

  await mkdir(outDir, { recursive: true });

  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', videoPath,
    '-vf', `fps=${fps},scale=${width}:-2`,
    '-q:v', String(quality),
    join(outDir, 'f%05d.jpg'),
  ]);

  const frames = (await readdir(outDir)).filter((f) => f.endsWith('.jpg')).sort();
  if (frames.length === 0) throw new Error(`no preview frames produced in ${outDir}`);

  // An index rather than a naming convention the app has to re-derive. The
  // app should not have to know ffmpeg's numbering is 1-based.
  const indexPath = join(outDir, 'frames.json');
  await writeFile(
    indexPath,
    `${JSON.stringify({ fps, width, count: frames.length, frames }, null, 2)}\n`,
    'utf8',
  );

  return { dir: outDir, fps, width, count: frames.length, indexPath };
}

/** Milliseconds to the frame covering it, given the strip's rate. */
export const frameIndexFor = (playheadMs: number, fps: number, count: number): number =>
  Math.max(0, Math.min(count - 1, Math.floor((playheadMs / 1000) * fps)));
