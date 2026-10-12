/**
 * The joined-up pipeline.
 *
 * Frame extraction and duration probing run against real ffmpeg, because
 * those are exactly the places a stub would agree with a wrong assumption.
 * The describer and synthesiser are fakes, so the suite costs nothing and
 * needs no key.
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import ffmpegPath from 'ffmpeg-static';

import { buildTrack } from '../../pipeline/build';
import { framesBefore, probeDurationMs } from '../../pipeline/frames';
import { makeWav, wavData } from '../../pipeline/synthesis/wav';
import type { DescribeRequest, DescribeResult, Describer } from '../../pipeline/describe/types';
import type { SynthesisResult, Synthesizer } from '../../pipeline/synthesis/types';

const run = promisify(execFile);
const FFMPEG = ffmpegPath as unknown as string;
const SR = 24_000;

let dir: string;
let video: string;
let captions: string;

/** A real 12-second clip, so ffmpeg has something true to measure. */
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gaptrack-build-'));
  video = join(dir, 'clip.mp4');
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=12',
    '-pix_fmt', 'yuv420p', video,
  ]);

  captions = join(dir, 'clip.vtt');
  await writeFile(
    captions,
    `WEBVTT

00:00:00.000 --> 00:00:01.000
First line.

00:00:04.000 --> 00:00:04.500
[music]

00:00:09.000 --> 00:00:10.000
Last line.
`,
    'utf8',
  );
}, 120_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

class FakeDescriber implements Describer {
  readonly name = 'fake';
  readonly seen: DescribeRequest[] = [];
  constructor(private readonly reply: (r: DescribeRequest) => string | null = () => 'A door opens') {}
  async describe(req: DescribeRequest): Promise<DescribeResult> {
    this.seen.push(req);
    const text = this.reply(req);
    return {
      text: text ?? '',
      engine: this.name,
      model: 'none',
      declined: text === null,
    };
  }
}

class FakeVoice implements Synthesizer {
  readonly name = 'fake';
  readonly sampleRate = SR;
  async synthesize(text: string, outPath: string): Promise<SynthesisResult> {
    const durationMs = text.trim().split(/\s+/).length * 300;
    const buf = makeWav({ durationMs, sampleRate: SR });
    wavData(buf).data.fill(0x20);
    await mkdir(join(outPath, '..'), { recursive: true });
    await writeFile(outPath, buf);
    return { text, audioPath: outPath, durationMs, engine: this.name, voice: 'f', sampleRate: SR };
  }
}

describe('probeDurationMs', () => {
  it('reads a real duration from a real file', async () => {
    expect(Math.abs((await probeDurationMs(video)) - 12_000)).toBeLessThan(200);
  }, 60_000);

  it('fails loudly on a file ffmpeg cannot read', async () => {
    await expect(probeDurationMs(join(dir, 'nope.mp4'))).rejects.toThrow(/duration/);
  }, 60_000);
});

describe('framesBefore', () => {
  it('samples from the run-up to the gap, not the gap itself', async () => {
    const frames = await framesBefore(video, 6_000, join(dir, 'f1'), { count: 2 });
    expect(frames).toHaveLength(2);
    for (const f of frames) {
      expect(f.mediaType).toBe('image/jpeg');
      expect(f.data.length).toBeGreaterThan(500);
      expect(f.data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG SOI
    }
  }, 60_000);

  it('returns what it can rather than failing the film', async () => {
    // Seeking far past the end. One missing frame must not abort a build.
    const frames = await framesBefore(video, 999_000, join(dir, 'f2'), { count: 2 });
    expect(Array.isArray(frames)).toBe(true);
  }, 60_000);
});

describe('buildTrack', () => {
  it('runs captions through to a packaged track', async () => {
    const out = join(dir, 'out1');
    const result = await buildTrack({
      titleId: 't',
      videoPath: video,
      captionsPath: captions,
      outDir: out,
      describer: new FakeDescriber(),
      synth: new FakeVoice(),
    });

    expect(result.gapCount).toBeGreaterThan(0);
    expect(result.describedCount).toBeGreaterThan(0);
    expect(result.packaged.segmentCount).toBeGreaterThan(0);

    const manifest = JSON.parse(await readFile(join(out, 't', 'track.json'), 'utf8'));
    expect(manifest.descriptionTrackUrl).toBe('hls/index.m3u8');
    expect(manifest.cues.length).toBe(result.describedCount);
    expect(manifest.config.safetyMarginMs).toBe(250);
  }, 180_000);

  it('treats a bracketed caption as non-speech, so the gap runs through it', async () => {
    // [music] sits at 4s, inside the silence between 1s and 9s. If it were
    // counted as speech that silence would be split into two ~2.5s gaps.
    // Instead the first gap runs the whole ~7.7s, which shows up as a word
    // budget far larger than either half could afford.
    const d = new FakeDescriber();
    await buildTrack({
      titleId: 't2',
      videoPath: video,
      captionsPath: captions,
      outDir: join(dir, 'out2'),
      describer: d,
      synth: new FakeVoice(),
    });

    expect(d.seen[0].wordBudget).toBeGreaterThan(15); // ~7.7s of silence
    // The trailing silence after the last line is a gap too, so there are two.
    expect(d.seen).toHaveLength(2);
    expect(d.seen[1].wordBudget).toBeLessThan(d.seen[0].wordBudget);
  }, 180_000);

  it('gives the describer the dialogue leading in', async () => {
    const d = new FakeDescriber();
    await buildTrack({
      titleId: 't3',
      videoPath: video,
      captionsPath: captions,
      outDir: join(dir, 'out3'),
      describer: d,
      synth: new FakeVoice(),
    });
    expect(d.seen[0].dialogueBefore).toContain('First line.');
  }, 180_000);

  it('records a decline without inventing a cue', async () => {
    const result = await buildTrack({
      titleId: 't4',
      videoPath: video,
      captionsPath: captions,
      outDir: join(dir, 'out4'),
      describer: new FakeDescriber(() => null),
      synth: new FakeVoice(),
    });
    expect(result.describedCount).toBe(0);
    expect(result.declinedCount).toBeGreaterThan(0);
    // Still produces a valid, silent track rather than failing.
    expect(result.packaged.segmentCount).toBeGreaterThan(0);
  }, 180_000);

  it('reuses a cached description on a rerun', async () => {
    const out = join(dir, 'out5');
    const first = new FakeDescriber();
    await buildTrack({
      titleId: 't5', videoPath: video, captionsPath: captions, outDir: out,
      describer: first, synth: new FakeVoice(),
    });
    expect(first.seen.length).toBeGreaterThan(0);

    const second = new FakeDescriber();
    await buildTrack({
      titleId: 't5', videoPath: video, captionsPath: captions, outDir: out,
      describer: second, synth: new FakeVoice(),
    });
    expect(second.seen).toHaveLength(0); // no second call
  }, 240_000);

  it('rewrites when the margin changes, because the brief changed', async () => {
    // The cache is keyed on gap AND budget. A different margin means a
    // different word budget, which is a different brief — reusing the old
    // text would silently describe to the wrong length.
    const out = join(dir, 'out6');
    const first = new FakeDescriber();
    await buildTrack({
      titleId: 't6', videoPath: video, captionsPath: captions, outDir: out,
      describer: first, synth: new FakeVoice(),
    });

    const second = new FakeDescriber();
    await buildTrack({
      titleId: 't6', videoPath: video, captionsPath: captions, outDir: out,
      describer: second, synth: new FakeVoice(),
      config: { safetyMarginMs: 2_000 },
    });
    expect(second.seen.length).toBeGreaterThan(0);
    expect(second.seen[0].wordBudget).toBeLessThan(first.seen[0].wordBudget);
  }, 240_000);
});
