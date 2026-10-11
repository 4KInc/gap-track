/**
 * Integration test against real synthesis.
 *
 * The unit tests prove the measurement maths. This proves the measurement
 * survives contact with an actual encoder, which is where the assumption
 * would break: a header written differently, a resample, a container quirk.
 *
 * macOS only, so it skips elsewhere rather than failing.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SayVoice, sayAvailable } from '../../pipeline/synthesis/say';
import { UnmeasurableAudioError } from '../../pipeline/synthesis/types';
import { wavInfo } from '../../pipeline/synthesis/wav';

let dir: string;

/**
 * Decided synchronously at module load, because `describe` bodies run during
 * collection and `beforeAll` runs after. A flag set in `beforeAll` is still
 * false when `it` vs `it.skip` is chosen, so every test silently skips and
 * the suite reports green. Platform is knowable without I/O, so use that.
 */
const onMac = process.platform === 'darwin';
const maybe = onMac ? it : it.skip;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gaptrack-say-'));
  if (onMac && !(await sayAvailable())) {
    throw new Error('on macOS but `say` is unavailable — this should not silently skip');
  }
}, 30_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('SayVoice', () => {
  maybe(
    'renders audio and measures what it actually produced',
    async () => {
      const v = new SayVoice();
      const r = await v.synthesize('She folds the letter.', join(dir, 'cue.wav'));

      expect(r.engine).toBe('macos-say');
      expect(r.durationMs).toBeGreaterThan(300);
      expect(r.durationMs).toBeLessThan(5_000);
      expect(r.sampleRate).toBe(24_000);
      expect((await stat(r.audioPath)).size).toBeGreaterThan(1_000);
    },
    60_000,
  );

  maybe(
    'measures longer text as longer audio',
    async () => {
      // The relationship that admission depends on: more words, more time.
      // If this ever inverts, the duration is not coming from the audio.
      const v = new SayVoice();
      const short = await v.synthesize('She sits.', join(dir, 'short.wav'));
      const long = await v.synthesize(
        'She folds the letter slowly, sets it down on the table, and turns away towards the window.',
        join(dir, 'long.wav'),
      );
      expect(long.durationMs).toBeGreaterThan(short.durationMs * 2);
    },
    60_000,
  );

  maybe(
    'skips the filler chunks a real encoder inserts',
    async () => {
      // afconvert does not emit a bare 44-byte header: it pads with a FLLR
      // chunk for alignment. Code that assumed the data began at offset 44
      // would read roughly 4KB of padding as audio and overstate the
      // duration by ~85ms, which is a third of the safety margin.
      //
      // This asserts the file really is untidy, so the chunk walker is being
      // exercised against reality rather than only against fixtures.
      const v = new SayVoice();
      const r = await v.synthesize('Testing one two three.', join(dir, 'crosscheck.wav'));

      const buf = await readFile(r.audioPath);
      const info = wavInfo(buf);

      const headerBytes = buf.length - info.dataBytes;
      expect(headerBytes).toBeGreaterThan(44); // extra chunks present

      const naiveMs = ((buf.length - 44) / 48_000) * 1_000;
      expect(naiveMs).toBeGreaterThan(r.durationMs); // the naive read overstates

      // And the measured duration agrees with the payload the parser found.
      expect(Math.abs((info.dataBytes / 48_000) * 1_000 - r.durationMs)).toBeLessThan(2);
    },
    60_000,
  );

  it('refuses empty text rather than producing an unmeasurable file', async () => {
    const v = new SayVoice();
    await expect(v.synthesize('   ', join(dir, 'empty.wav'))).rejects.toThrow(/empty/);
  });

  it('exports a distinct error for audio that exists but cannot be measured', () => {
    // Separate from a synthesis failure because the recovery differs: the
    // audio is fine, the measurement path is broken, and falling back to an
    // estimate is exactly the wrong move.
    const e = new UnmeasurableAudioError('/tmp/x.wav', 'no data chunk');
    expect(e.name).toBe('UnmeasurableAudioError');
    expect(e.message).toContain('could not be measured');
  });
});
