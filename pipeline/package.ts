/**
 * Packaging the description track for the device.
 *
 * Vega will not play a WAV, a local file, or a plain progressive MP4 — only
 * MSE-fed fragmented content (FRICTION.md entry 5). So the assembled track
 * becomes audio-only HLS in fMP4, which is the one combination measured to
 * work.
 *
 * The part that needs care is timing. Every cue's position in this track is
 * load-bearing: the device seeks to `trackOffsetMs` expecting to find that
 * description there. AAC is a lapped transform and encoders emit priming
 * samples before the real audio starts, so a naive encode can shift the
 * whole track by tens of milliseconds. Against a 250ms safety margin that is
 * not negligible.
 *
 * Rather than assume ffmpeg's edit lists handle it, this measures the shift
 * by decoding the packaged result back and comparing. If packaging moved the
 * audio, the manifest says by how much and the device compensates.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import ffmpegPath from 'ffmpeg-static';
import { wavData } from './synthesis/wav';

const run = promisify(execFile);
const FFMPEG = ffmpegPath as unknown as string;

export interface PackageOptions {
  /** Target segment length. Shorter means faster seeks, more requests. */
  segmentSeconds?: number;
  bitrate?: string;
  sampleRate?: number;
}

export interface PackagedTrack {
  playlistPath: string;
  initPath: string;
  segmentCount: number;
  /** How far packaging moved the audio. Should be ~0; recorded either way. */
  latencyMs: number;
}

/**
 * WAV to audio-only HLS in fragmented MP4.
 *
 * `-hls_segment_type fmp4` is the requirement, not a preference: TS segments
 * would be rejected the same way the progressive MP4 was.
 */
export async function packageHls(
  wavPath: string,
  outDir: string,
  opts: PackageOptions = {},
): Promise<PackagedTrack> {
  const segmentSeconds = opts.segmentSeconds ?? 6;
  const bitrate = opts.bitrate ?? '96k';
  const sampleRate = opts.sampleRate ?? 48_000;

  await mkdir(outDir, { recursive: true });
  const playlistPath = join(outDir, 'index.m3u8');

  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', wavPath,
    '-vn',
    '-c:a', 'aac',
    '-b:a', bitrate,
    '-ar', String(sampleRate),
    '-ac', '1',
    '-f', 'hls',
    '-hls_time', String(segmentSeconds),
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', join(outDir, 'seg_%04d.m4s'),
    '-hls_list_size', '0',
    playlistPath,
  ]);

  const files = await readdir(outDir);
  const segmentCount = files.filter((f) => f.endsWith('.m4s')).length;
  if (segmentCount === 0) throw new Error(`packaging produced no segments in ${outDir}`);

  const latencyMs = await measureLatency(wavPath, playlistPath);

  return {
    playlistPath,
    initPath: join(outDir, 'init.mp4'),
    segmentCount,
    latencyMs,
  };
}

/**
 * Decode the packaged stream back to PCM and find where its audio starts,
 * compared with the source.
 *
 * Round-tripping is the only honest check. Reading a duration from a
 * container header would tell us what the encoder claims, not where the
 * samples actually ended up, and the claim is exactly what AAC priming makes
 * unreliable.
 */
async function measureLatency(wavPath: string, playlistPath: string): Promise<number> {
  const sourceStart = firstSoundMs(await readFile(wavPath));
  if (sourceStart === null) return 0; // silent track: nothing to align

  const decoded = `${playlistPath}.decoded.wav`;
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...hlsInputFlags(playlistPath),
    '-i', playlistPath,
    '-c:a', 'pcm_s16le', '-ac', '1',
    decoded,
  ]);

  const packagedStart = firstSoundMs(await readFile(decoded));
  if (packagedStart === null) return 0;
  return packagedStart - sourceStart;
}

/**
 * Milliseconds to the first audible sample, or null if the file is silent.
 *
 * A threshold rather than strict non-zero, because a lossy round trip turns
 * digital silence into very quiet noise. Anything under this is inaudible
 * and must not be mistaken for the start of a description.
 */
function firstSoundMs(buf: Buffer, threshold = 512): number | null {
  const { info, data } = wavData(buf);
  const bytesPerSample = info.bitsPerSample / 8;
  const frameBytes = bytesPerSample * info.channels;

  for (let i = 0; i + 1 < data.length; i += frameBytes) {
    if (Math.abs(data.readInt16LE(i)) > threshold) {
      return Math.round((i / frameBytes / info.sampleRate) * 1000);
    }
  }
  return null;
}

/**
 * Decode any ffmpeg-readable input to mono PCM WAV.
 *
 * `-allowed_extensions` belongs to the HLS demuxer and is rejected outright
 * for other inputs, so it is only passed for a playlist.
 */
export async function decodeToWav(
  input: string,
  outPath: string,
  sampleRate = 24_000,
): Promise<void> {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...hlsInputFlags(input),
    '-i', input,
    '-c:a', 'pcm_s16le', '-ar', String(sampleRate), '-ac', '1',
    outPath,
  ]);
}

/** Segments sit beside the playlist with a .m4s extension ffmpeg distrusts. */
function hlsInputFlags(input: string): string[] {
  return input.endsWith('.m3u8') ? ['-allowed_extensions', 'ALL'] : [];
}


/**
 * Package the programme itself as fragmented HLS.
 *
 * A described title needs both streams reachable over https, or the cue
 * offsets refer to a video the device cannot play. Video is copied rather
 * than re-encoded: the picture is untouched, so nothing in the demo can be
 * blamed on this step, and packaging a feature film takes seconds instead of
 * an hour.
 */
export async function packageVideoHls(
  videoPath: string,
  outDir: string,
  opts: { segmentSeconds?: number } = {},
): Promise<{ playlistPath: string; segmentCount: number }> {
  const segmentSeconds = opts.segmentSeconds ?? 6;
  await mkdir(outDir, { recursive: true });
  const playlistPath = join(outDir, 'index.m3u8');

  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', videoPath,
    '-c:v', 'copy',
  ];

  // Silent material has no audio stream to encode, and asking for one fails
  // the mux rather than producing a video-only playlist.
  if (await hasAudio(videoPath)) {
    args.push('-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-an');
  }

  args.push(
    '-f', 'hls',
    '-hls_time', String(segmentSeconds),
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', join(outDir, 'seg_%04d.m4s'),
    '-hls_list_size', '0',
    playlistPath,
  );

  await run(FFMPEG, args);

  const segmentCount = (await readdir(outDir)).filter((f) => f.endsWith('.m4s')).length;
  if (segmentCount === 0) throw new Error(`packaging produced no video segments in ${outDir}`);
  return { playlistPath, segmentCount };
}

async function hasAudio(path: string): Promise<boolean> {
  let stderr = '';
  try {
    await run(FFMPEG, ['-hide_banner', '-i', path]);
  } catch (err) {
    stderr = (err as { stderr?: string }).stderr ?? '';
  }
  return /Stream #\d+:\d+.*: Audio:/.test(stderr);
}
