/**
 * Duration measurement underpins the whole safety guarantee, so it is tested
 * against hand-built headers where the right answer is known exactly, rather
 * than against a file some tool produced.
 */

import { wavInfo, makeWav, wrapPcm } from '../../pipeline/synthesis/wav';

describe('wavInfo: exact duration from the header', () => {
  it('measures a known-length file', () => {
    const info = wavInfo(makeWav({ durationMs: 1_420 }));
    expect(info.durationMs).toBe(1_420);
    expect(info.sampleRate).toBe(24_000);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
  });

  it('is correct across formats', () => {
    for (const sampleRate of [8_000, 16_000, 22_050, 44_100, 48_000]) {
      for (const channels of [1, 2]) {
        for (const bitsPerSample of [8, 16, 24]) {
          const ms = 2_500;
          const info = wavInfo(makeWav({ durationMs: ms, sampleRate, channels, bitsPerSample }));
          // Rounding to whole bytes costs sub-millisecond accuracy at worst.
          expect(Math.abs(info.durationMs - ms)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('reports zero for a header with no samples', () => {
    expect(wavInfo(makeWav({ durationMs: 0 })).durationMs).toBe(0);
  });
});

describe('wavInfo: real files are not tidy', () => {
  /**
   * Splice an extra chunk in between `fmt ` and `data`.
   *
   * RIFF chunks are word-aligned, so an odd payload is followed by a pad byte
   * that is not counted in the declared size. Emitting it here matters: a
   * fixture without the pad is not a valid WAV, and testing against one would
   * have us "fix" a parser that was right.
   */
  const withChunk = (base: Buffer, id: string, payload: Buffer): Buffer => {
    const dataAt = base.indexOf(Buffer.from('data', 'ascii'), 12);
    const pad = payload.length % 2;
    const chunk = Buffer.alloc(8 + payload.length + pad);
    chunk.write(id, 0, 'ascii');
    chunk.writeUInt32LE(payload.length, 4);
    payload.copy(chunk, 8);
    const out = Buffer.concat([base.subarray(0, dataAt), chunk, base.subarray(dataAt)]);
    out.writeUInt32LE(out.length - 8, 4); // fix RIFF size
    return out;
  };

  it('walks past a LIST chunk instead of assuming offset 44', () => {
    const base = makeWav({ durationMs: 1_000 });
    const withList = withChunk(base, 'LIST', Buffer.from('INFOISFT'.padEnd(26, ' '), 'ascii'));
    expect(wavInfo(withList).durationMs).toBe(1_000);
  });

  it('handles an odd-sized chunk and its pad byte', () => {
    const base = makeWav({ durationMs: 500 });
    // 7 bytes, so the parser must skip one pad byte to stay aligned.
    expect(wavInfo(withChunk(base, 'fact', Buffer.alloc(7))).durationMs).toBe(500);
  });

  it('falls back to what is present when the data size is a lie', () => {
    const buf = makeWav({ durationMs: 1_000 });
    const dataAt = buf.indexOf(Buffer.from('data', 'ascii'), 12);
    buf.writeUInt32LE(0xffffffff, dataAt + 4); // claims more than exists
    expect(wavInfo(buf).durationMs).toBe(1_000);
  });

  it('derives the byte rate when the header omits it', () => {
    const buf = makeWav({ durationMs: 800 });
    buf.writeUInt32LE(0, 28); // zero out byteRate
    expect(wavInfo(buf).durationMs).toBe(800);
  });
});

describe('wavInfo: refuses rather than guesses', () => {
  it('rejects a buffer that is not RIFF', () => {
    expect(() => wavInfo(Buffer.from('not audio at all', 'ascii'))).toThrow(/RIFF/);
  });

  it('rejects RIFF that is not WAVE', () => {
    const buf = makeWav({ durationMs: 100 });
    buf.write('AVI ', 8, 'ascii');
    expect(() => wavInfo(buf)).toThrow(/WAVE/);
  });

  it('rejects a truncated file', () => {
    expect(() => wavInfo(Buffer.alloc(4))).toThrow(/too short/);
  });

  it('rejects a file with no fmt chunk', () => {
    const buf = makeWav({ durationMs: 100 });
    buf.write('XXXX', 12, 'ascii');
    expect(() => wavInfo(buf)).toThrow(/no fmt chunk/);
  });

  it('rejects a file with no data chunk', () => {
    const buf = makeWav({ durationMs: 100 });
    buf.write('XXXX', buf.indexOf(Buffer.from('data', 'ascii'), 12), 'ascii');
    expect(() => wavInfo(buf)).toThrow(/no data chunk/);
  });
});

describe('wrapPcm: giving Polly output a measurable container', () => {
  it('reports the duration the sample count implies', () => {
    const sampleRate = 16_000;
    // Exactly one second of 16-bit mono silence.
    const pcm = Buffer.alloc(sampleRate * 2);
    expect(wavInfo(wrapPcm(pcm, { sampleRate })).durationMs).toBe(1_000);
  });

  it('keeps every PCM byte intact', () => {
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const wav = wrapPcm(pcm, { sampleRate: 16_000 });
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it('describes itself honestly in the header', () => {
    const wav = wrapPcm(Buffer.alloc(3_200), { sampleRate: 16_000 });
    const info = wavInfo(wav);
    expect(info.sampleRate).toBe(16_000);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
  });

  it('does not take the duration on trust from the caller', () => {
    // The signature has no durationMs, which is the whole point: a caller
    // that could assert a duration would have no reason to measure one.
    const odd = wrapPcm(Buffer.alloc(16_000 * 2 * 1.5), { sampleRate: 16_000 });
    expect(wavInfo(odd).durationMs).toBe(1_500);
  });
});
