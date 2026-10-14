/**
 * Assembly is where a measured duration becomes a position in an audio file,
 * so the tests check placement in bytes rather than trusting the arithmetic
 * twice. A cue written to the wrong offset is a description that plays over
 * dialogue no matter how correct admission was.
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assembleTrack, summarise, type Candidate } from '../../pipeline/assemble';
import { makeWav, wavData } from '../../pipeline/synthesis/wav';
import type { SynthesisResult, Synthesizer } from '../../pipeline/synthesis/types';

const SR = 24_000;
const BYTES_PER_MS = (SR * 2) / 1000; // mono, 16-bit

/**
 * A synthesiser with no encoder behind it: it writes a known-length tone of
 * a known byte value, so the assembler's placement can be read straight out
 * of the finished track.
 */
class FakeVoice implements Synthesizer {
  readonly name = 'fake';
  readonly sampleRate = SR;
  /** ms per word, so longer text really is longer audio. */
  constructor(private readonly msPerWord = 400, private readonly fill = 0x11) {}

  async synthesize(text: string, outPath: string): Promise<SynthesisResult> {
    const words = text.trim().split(/\s+/).length;
    const durationMs = words * this.msPerWord;
    const buf = makeWav({ durationMs, sampleRate: SR });
    const { data } = wavData(buf);
    data.fill(this.fill);
    await mkdir(join(outPath, '..'), { recursive: true });
    await writeFile(outPath, buf);
    return {
      text, audioPath: outPath, durationMs,
      engine: this.name, voice: 'fake', sampleRate: SR,
    };
  }
}

/** A synthesiser that always fails, for the no-audio path. */
class BrokenVoice implements Synthesizer {
  readonly name = 'broken';
  readonly sampleRate = SR;
  async synthesize(): Promise<SynthesisResult> {
    throw new Error('encoder exploded');
  }
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gaptrack-asm-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const cand = (startMs: number, gapMs: number, text: string): Candidate => ({
  gap: { startMs, durationMs: gapMs },
  text,
});

/** Where does audio actually appear in the finished track? */
const nonSilentRanges = (data: Buffer): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < data.length; i++) {
    const loud = data[i] !== 0;
    if (loud && start < 0) start = i;
    if (!loud && start >= 0) {
      ranges.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, data.length]);
  return ranges;
};

describe('assembleTrack: placement', () => {
  it('writes each admitted cue at its timeline position', async () => {
    const track = await assembleTrack(
      [cand(10_000, 5_000, 'one two'), cand(30_000, 5_000, 'three four')],
      { titleId: 't', durationMs: 60_000, synth: new FakeVoice(), outDir: dir },
    );

    expect(track.cues).toHaveLength(2);
    const { info, data } = wavData(await readFile(track.audioPath));
    expect(info.durationMs).toBe(60_000);

    const ranges = nonSilentRanges(data);
    expect(ranges).toHaveLength(2);
    // 800ms of audio (two words) at 10s and at 30s.
    expect(ranges[0][0]).toBe(10_000 * BYTES_PER_MS);
    expect(ranges[0][1] - ranges[0][0]).toBe(800 * BYTES_PER_MS);
    expect(ranges[1][0]).toBe(30_000 * BYTES_PER_MS);
  });

  it('sets trackOffsetMs to the gap start, because the track is timeline-aligned', async () => {
    const track = await assembleTrack([cand(12_345, 5_000, 'a b')], {
      titleId: 't', durationMs: 60_000, synth: new FakeVoice(), outDir: dir,
    });
    expect(track.cues[0].trackOffsetMs).toBe(12_345);
  });

  it('produces a silent track of the right length when nothing is admitted', async () => {
    const track = await assembleTrack([], {
      titleId: 't', durationMs: 30_000, synth: new FakeVoice(), outDir: dir,
    });
    const { info, data } = wavData(await readFile(track.audioPath));
    expect(info.durationMs).toBe(30_000);
    expect(nonSilentRanges(data)).toHaveLength(0);
  });

  it('aligns to whole samples so a copy cannot land mid-frame', async () => {
    // An odd millisecond offset would otherwise give an odd byte offset and
    // swap the halves of one 16-bit sample, which clicks.
    const track = await assembleTrack([cand(10_001, 5_000, 'a')], {
      titleId: 't', durationMs: 30_000, synth: new FakeVoice(), outDir: dir,
    });
    const { data } = wavData(await readFile(track.audioPath));
    expect(nonSilentRanges(data)[0][0] % 2).toBe(0);
  });
});

describe('assembleTrack: admission is applied, and recorded', () => {
  it('refuses a cue too long for its gap and says why', async () => {
    // 5 words at 400ms = 2000ms, plus 250ms margin, into a 1500ms gap.
    const track = await assembleTrack([cand(10_000, 1_500, 'one two three four five')], {
      titleId: 't', durationMs: 30_000, synth: new FakeVoice(), outDir: dir,
    });

    expect(track.cues).toHaveLength(0);
    expect(track.rejected).toHaveLength(1);
    expect(track.rejected[0].reason).toBe('WOULD_OVERRUN');
    expect(track.rejected[0].overrunMs).toBe(750);
    expect(track.rejected[0].audioDurationMs).toBe(2_000);
  });

  it('leaves no audio in the track for a refused cue', async () => {
    const track = await assembleTrack([cand(10_000, 1_000, 'one two three four five')], {
      titleId: 't', durationMs: 30_000, synth: new FakeVoice(), outDir: dir,
    });
    const { data } = wavData(await readFile(track.audioPath));
    expect(nonSilentRanges(data)).toHaveLength(0);
  });

  it('records a synthesis failure as NO_AUDIO rather than guessing a duration', async () => {
    const track = await assembleTrack([cand(10_000, 5_000, 'anything')], {
      titleId: 't', durationMs: 30_000, synth: new BrokenVoice(), outDir: dir,
    });
    expect(track.cues).toHaveLength(0);
    expect(track.rejected[0].reason).toBe('NO_AUDIO');
    expect(track.rejected[0].audioDurationMs).toBe(0);
  });

  it('keeps the good cues when one fails', async () => {
    const track = await assembleTrack(
      [
        cand(10_000, 5_000, 'fits fine'),
        cand(20_000, 1_000, 'far too many words for this tiny gap'),
        cand(30_000, 5_000, 'also fine'),
      ],
      { titleId: 't', durationMs: 60_000, synth: new FakeVoice(), outDir: dir },
    );
    expect(track.cues.map((c) => c.gap.startMs)).toEqual([10_000, 30_000]);
    expect(track.rejected).toHaveLength(1);
  });
});

describe('assembleTrack: the manifest', () => {
  it('writes a manifest carrying both admitted and refused cues', async () => {
    const track = await assembleTrack(
      [cand(10_000, 5_000, 'fits'), cand(20_000, 800, 'does not fit at all here')],
      { titleId: 'sintel', durationMs: 60_000, synth: new FakeVoice(), outDir: dir },
    );

    const m = JSON.parse(await readFile(track.manifestPath, 'utf8'));
    expect(m.titleId).toBe('sintel');
    expect(m.cues).toHaveLength(1);
    expect(m.rejected).toHaveLength(1);
    // The refusal carries its arithmetic, which is the evidence on screen.
    expect(m.rejected[0]).toMatchObject({ reason: 'WOULD_OVERRUN' });
    expect(m.config.safetyMarginMs).toBe(250);
  });

  it('orders cues by timeline regardless of input order', async () => {
    const track = await assembleTrack(
      [cand(30_000, 5_000, 'third'), cand(10_000, 5_000, 'first'), cand(20_000, 5_000, 'second')],
      { titleId: 't', durationMs: 60_000, synth: new FakeVoice(), outDir: dir },
    );
    expect(track.cues.map((c) => c.text)).toEqual(['first', 'second', 'third']);
  });
});

describe('assembleTrack: refuses to produce a broken track', () => {
  it('refuses the later of two overlapping cues rather than the whole track', async () => {
    // A 20s gap admits a 2s cue at 10s; the next gap opens at 10.5s while it
    // is still sounding. Admission cannot catch this — it judges cues one at
    // a time — and adjacent gaps are common, so failing the build would make
    // the pipeline unusable on real films.
    const track = await assembleTrack(
      [cand(10_000, 20_000, 'one two three four five'), cand(10_500, 20_000, 'six seven')],
      { titleId: 't', durationMs: 60_000, synth: new FakeVoice(), outDir: dir },
    );

    expect(track.cues.map((c) => c.text)).toEqual(['one two three four five']);
    expect(track.rejected).toHaveLength(1);
    expect(track.rejected[0].reason).toBe('OVERLAPS_PREVIOUS');
    expect(track.rejected[0].overrunMs).toBe(1_500); // ends 12s, next due 10.5s
  });

  it('admits the second cue once the first has finished', async () => {
    const track = await assembleTrack(
      [cand(10_000, 20_000, 'one two'), cand(11_000, 20_000, 'three four')],
      { titleId: 't', durationMs: 60_000, synth: new FakeVoice(), outDir: dir },
    );
    // First ends at 10.8s, second is due at 11s. No collision.
    expect(track.cues).toHaveLength(2);
  });

  it('throws when a cue would run past the end of the programme', async () => {
    await expect(
      assembleTrack([cand(9_500, 5_000, 'one two')], {
        titleId: 't', durationMs: 10_000, synth: new FakeVoice(), outDir: dir,
      }),
    ).rejects.toThrow(/past the end/);
  });

  it('throws on a sample-rate mismatch instead of resampling silently', async () => {
    class WrongRate extends FakeVoice {
      async synthesize(text: string, outPath: string): Promise<SynthesisResult> {
        const buf = makeWav({ durationMs: 500, sampleRate: 16_000 });
        wavData(buf).data.fill(0x22);
        await mkdir(join(outPath, '..'), { recursive: true });
        await writeFile(outPath, buf);
        return {
          text, audioPath: outPath, durationMs: 500,
          engine: 'wrong', voice: 'x', sampleRate: 16_000,
        };
      }
    }
    await expect(
      assembleTrack([cand(1_000, 5_000, 'a')], {
        titleId: 't', durationMs: 30_000, synth: new WrongRate(), outDir: dir,
      }),
    ).rejects.toThrow(/resampling/);
  });
});

describe('summarise', () => {
  it('reports what was admitted and why the rest was not', async () => {
    const track = await assembleTrack(
      [cand(10_000, 5_000, 'fits'), cand(20_000, 500, 'much too long for this')],
      { titleId: 'sintel', durationMs: 60_000, synth: new FakeVoice(), outDir: dir },
    );
    expect(summarise(track)).toBe('sintel: 1/2 admitted  ·  dropped: WOULD_OVERRUN 1');
  });
});
