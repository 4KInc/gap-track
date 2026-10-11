/**
 * Packaging must not move the audio.
 *
 * The device seeks to a cue's `trackOffsetMs` expecting to find that
 * description there. If AAC priming shifts the track, every cue lands late
 * by the same amount and the safety margin quietly absorbs it until a tight
 * gap collides. So these tests build a track with a tone at a known offset,
 * package it, decode it back, and check the tone is still where it was.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packageHls, decodeToWav } from '../../pipeline/package';
import { makeWav, wavData, wavInfo } from '../../pipeline/synthesis/wav';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gaptrack-pkg-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * A track of `totalMs` silence with an audible tone at `toneAtMs`.
 * A real tone, not a DC fill: AAC would discard a constant offset entirely.
 */
const trackWithTone = (totalMs: number, toneAtMs: number, toneMs = 500): Buffer => {
  const sampleRate = 24_000;
  const buf = makeWav({ durationMs: totalMs, sampleRate });
  const { data } = wavData(buf);
  const start = Math.round((toneAtMs / 1000) * sampleRate);
  const count = Math.round((toneMs / 1000) * sampleRate);
  for (let n = 0; n < count; n++) {
    const v = Math.round(12_000 * Math.sin((2 * Math.PI * 440 * n) / sampleRate));
    data.writeInt16LE(v, (start + n) * 2);
  }
  return buf;
};

/** Milliseconds to the first clearly audible sample. */
const firstSoundMs = (buf: Buffer, threshold = 2_000): number | null => {
  const { info, data } = wavData(buf);
  for (let i = 0; i + 1 < data.length; i += 2) {
    if (Math.abs(data.readInt16LE(i)) > threshold) {
      return Math.round((i / 2 / info.sampleRate) * 1000);
    }
  }
  return null;
};

describe('packageHls', () => {
  it('produces an fMP4 HLS playlist with an init segment', async () => {
    const src = join(dir, 'description.wav');
    await writeFile(src, trackWithTone(20_000, 5_000));

    const out = await packageHls(src, join(dir, 'hls'));
    const playlist = await readFile(out.playlistPath, 'utf8');

    expect(playlist).toContain('#EXTM3U');
    // fMP4, not TS: TS would be refused the way the progressive MP4 was.
    expect(playlist).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(playlist).toContain('.m4s');
    expect(out.segmentCount).toBeGreaterThan(0);
  }, 120_000);

  it('segments at roughly the requested length', async () => {
    const src = join(dir, 'description.wav');
    await writeFile(src, trackWithTone(30_000, 1_000));

    const out = await packageHls(src, join(dir, 'hls'), { segmentSeconds: 6 });
    // 30s at 6s per segment, give or take where keyframes land.
    expect(out.segmentCount).toBeGreaterThanOrEqual(4);
    expect(out.segmentCount).toBeLessThanOrEqual(7);
  }, 120_000);

  it('keeps a cue at its offset through the round trip', async () => {
    // The one that matters. A tone at 8s must still be at 8s afterwards.
    const src = join(dir, 'description.wav');
    await writeFile(src, trackWithTone(20_000, 8_000));

    const out = await packageHls(src, join(dir, 'hls'));
    const back = join(dir, 'back.wav');
    await decodeToWav(out.playlistPath, back);

    const got = firstSoundMs(await readFile(back));
    expect(got).not.toBeNull();
    // A lossy codec smears the attack slightly; tens of ms is the budget,
    // and anything larger would eat into the 250ms safety margin.
    expect(Math.abs((got as number) - 8_000)).toBeLessThan(50);
  }, 120_000);

  it('reports the latency packaging introduced', async () => {
    const src = join(dir, 'description.wav');
    await writeFile(src, trackWithTone(20_000, 6_000));

    const out = await packageHls(src, join(dir, 'hls'));
    // Recorded rather than assumed. If this ever grows, the manifest carries
    // it and the device compensates instead of drifting silently.
    expect(Math.abs(out.latencyMs)).toBeLessThan(50);
  }, 120_000);

  it('preserves the spacing between two cues', async () => {
    // A constant shift is correctable; a stretch is not. This checks the
    // gap between two tones survives, not just where the first one lands.
    const sampleRate = 24_000;
    const buf = makeWav({ durationMs: 20_000, sampleRate });
    const { data } = wavData(buf);
    for (const atMs of [4_000, 12_000]) {
      const start = Math.round((atMs / 1000) * sampleRate);
      for (let n = 0; n < sampleRate / 2; n++) {
        data.writeInt16LE(
          Math.round(12_000 * Math.sin((2 * Math.PI * 440 * n) / sampleRate)),
          (start + n) * 2,
        );
      }
    }
    const src = join(dir, 'two.wav');
    await writeFile(src, buf);

    const out = await packageHls(src, join(dir, 'hls'));
    const back = join(dir, 'back.wav');
    await decodeToWav(out.playlistPath, back);

    const { info, data: got } = wavData(await readFile(back));
    const loud: number[] = [];
    let quietFor = Infinity;
    for (let i = 0; i + 1 < got.length; i += 2) {
      if (Math.abs(got.readInt16LE(i)) > 2_000) {
        if (quietFor > info.sampleRate / 2) loud.push(Math.round((i / 2 / info.sampleRate) * 1000));
        quietFor = 0;
      } else {
        quietFor++;
      }
    }

    expect(loud).toHaveLength(2);
    expect(Math.abs(loud[1] - loud[0] - 8_000)).toBeLessThan(50);
  }, 120_000);

  it('handles an entirely silent track', async () => {
    // Common in practice: a title where nothing was admitted.
    const src = join(dir, 'silent.wav');
    await writeFile(src, makeWav({ durationMs: 10_000 }));

    const out = await packageHls(src, join(dir, 'hls'));
    expect(out.segmentCount).toBeGreaterThan(0);
    expect(out.latencyMs).toBe(0);
  }, 120_000);

  it('fails loudly on an unreadable input', async () => {
    await expect(
      packageHls(join(dir, 'does-not-exist.wav'), join(dir, 'hls')),
    ).rejects.toThrow();
  }, 60_000);
});

describe('decodeToWav', () => {
  it('round-trips a WAV at the requested rate', async () => {
    const src = join(dir, 'in.wav');
    await writeFile(src, trackWithTone(5_000, 1_000));
    const out = join(dir, 'out.wav');
    await decodeToWav(src, out, 16_000);

    const info = wavInfo(await readFile(out));
    expect(info.sampleRate).toBe(16_000);
    expect(info.channels).toBe(1);
    expect(Math.abs(info.durationMs - 5_000)).toBeLessThan(50);
  }, 60_000);
});
