/**
 * Mixing is how the project is demonstrated at all, because the Vega
 * simulator has no audio hardware. So the thing worth testing is that the
 * narration lands where the scheduler put it, and that silent material —
 * common in exactly the archive footage this serves — does not fail.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import ffmpegPath from 'ffmpeg-static';

import { duckExpression, hasAudioStream, mixDescribed } from '../../pipeline/mix';
import { makeWav, wavData } from '../../pipeline/synthesis/wav';
import type { Cue } from '../../src/engine/types';

const run = promisify(execFile);
const FFMPEG = ffmpegPath as unknown as string;
const SR = 24_000;

let dir: string;
let silentVideo: string;
let noisyVideo: string;

const cue = (startMs: number, audioMs: number, id = 'c1'): Cue => ({
  id,
  gap: { startMs, durationMs: audioMs + 2_000 },
  text: 'A door opens.',
  audioDurationMs: audioMs,
  trackOffsetMs: startMs,
});

/** A description track with a tone at the cue's offset. */
const trackFor = (cues: Cue[], totalMs: number): Buffer => {
  const buf = makeWav({ durationMs: totalMs, sampleRate: SR });
  const { data } = wavData(buf);
  for (const c of cues) {
    const start = Math.round((c.trackOffsetMs / 1000) * SR);
    const count = Math.round((c.audioDurationMs / 1000) * SR);
    for (let n = 0; n < count; n++) {
      data.writeInt16LE(
        Math.round(11_000 * Math.sin((2 * Math.PI * 440 * n) / SR)),
        (start + n) * 2,
      );
    }
  }
  return buf;
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gaptrack-mix-'));

  silentVideo = join(dir, 'silent.mp4');
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=10',
    '-pix_fmt', 'yuv420p', silentVideo,
  ]);

  noisyVideo = join(dir, 'noisy.mp4');
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=10',
    '-f', 'lavfi', '-i', 'sine=frequency=200:duration=10',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', noisyVideo,
  ]);
}, 180_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('duckExpression', () => {
  it('is a flat 1 when there is nothing to duck', () => {
    expect(duckExpression([], 0.25, 150)).toBe('1');
  });

  it('covers every cue in one expression', () => {
    // One filter per cue would make a feature film's graph unusable.
    const expr = duckExpression([cue(1_000, 500, 'a'), cue(5_000, 500, 'b')], 0.25, 150);
    expect((expr.match(/between/g) ?? []).length).toBe(2);
    expect(expr).toContain('0.25');
  });

  it('starts the duck before the cue and ends it after', () => {
    // Ducking exactly on the boundary clicks; the ramp needs room.
    const expr = duckExpression([cue(2_000, 1_000)], 0.25, 200);
    expect(expr).toContain('1.800'); // 2.0s minus the fade
    expect(expr).toContain('3.200'); // 3.0s plus the fade
  });

  it('does not ask for a negative time at the start of a programme', () => {
    expect(duckExpression([cue(50, 500)], 0.25, 300)).toContain('0.000');
  });
});

describe('hasAudioStream', () => {
  it('is false for silent material', async () => {
    expect(await hasAudioStream(silentVideo)).toBe(false);
  }, 60_000);

  it('is true when the programme has sound', async () => {
    expect(await hasAudioStream(noisyVideo)).toBe(true);
  }, 60_000);
});

describe('mixDescribed', () => {
  it('puts the narration where the scheduler scheduled it', async () => {
    const cues = [cue(4_000, 1_000)];
    const wav = join(dir, 'desc.wav');
    await writeFile(wav, trackFor(cues, 10_000));
    const out = join(dir, 'out1.mp4');

    await mixDescribed(noisyVideo, wav, cues, out);

    // Decode back and find the loudest second. The description is mixed
    // above a ducked programme, so it should dominate its own window.
    const back = join(dir, 'back1.wav');
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', out,
      '-c:a', 'pcm_s16le', '-ac', '1', '-ar', String(SR), back,
    ]);
    const { data } = wavData(await readFile(back));

    const energyAt = (sec: number): number => {
      let sum = 0;
      const from = sec * SR * 2;
      for (let i = from; i < from + SR * 2 && i + 1 < data.length; i += 2) {
        sum += Math.abs(data.readInt16LE(i));
      }
      return sum;
    };

    // Second 4 holds the description; second 7 is programme only, ducked
    // nowhere, so the description second must be louder.
    expect(energyAt(4)).toBeGreaterThan(energyAt(7));
  }, 180_000);

  it('uses the description as the only audio for a silent programme', async () => {
    // Archive footage often has no audio at all, and is exactly the material
    // least likely to have a description. Failing here would be the wrong
    // answer to the most likely input.
    const cues = [cue(3_000, 1_000)];
    const wav = join(dir, 'desc2.wav');
    await writeFile(wav, trackFor(cues, 10_000));
    const out = join(dir, 'out2.mp4');

    const result = await mixDescribed(silentVideo, wav, cues, out);
    expect(result.programmeHadAudio).toBe(false);
    expect(await hasAudioStream(out)).toBe(true);
  }, 180_000);

  it('keeps the video stream untouched', async () => {
    // -c:v copy, so the picture is bit-identical and the mix cannot be
    // blamed for any quality loss in the demo.
    const cues = [cue(2_000, 500)];
    const wav = join(dir, 'desc3.wav');
    await writeFile(wav, trackFor(cues, 10_000));
    const out = join(dir, 'out3.mp4');
    await mixDescribed(noisyVideo, wav, cues, out);

    let stderr = '';
    try {
      await run(FFMPEG, ['-hide_banner', '-i', out]);
    } catch (e) {
      stderr = (e as { stderr?: string }).stderr ?? '';
    }
    expect(stderr).toMatch(/Video: h264/);
  }, 180_000);
});
