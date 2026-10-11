/**
 * Gap detection decides where a description is allowed to exist, so the
 * failure that matters is inventing a gap inside continuous dialogue. Most of
 * these tests are about not doing that.
 */

import {
  parseCaptions,
  mergeSpeech,
  gapsFromSpeech,
  gapsFromCaptions,
  contextBefore,
  DEFAULT_GAP_OPTIONS,
  type SpeechInterval,
} from '../../src/engine/gaps';

const opts = (durationMs: number, over = {}) => ({
  ...DEFAULT_GAP_OPTIONS,
  durationMs,
  ...over,
});

const sp = (startMs: number, endMs: number, text = 'line'): SpeechInterval => ({
  startMs,
  endMs,
  text,
});

describe('parseCaptions', () => {
  it('reads WebVTT', () => {
    const vtt = `WEBVTT

1
00:00:02.000 --> 00:00:04.500
Hello there.

2
00:00:10.000 --> 00:00:12.000
General Kenobi.
`;
    expect(parseCaptions(vtt)).toEqual([
      { startMs: 2_000, endMs: 4_500, text: 'Hello there.' },
      { startMs: 10_000, endMs: 12_000, text: 'General Kenobi.' },
    ]);
  });

  it('reads SRT, which uses a comma for the fraction', () => {
    const srt = `1
00:00:01,250 --> 00:00:03,000
First line.
`;
    expect(parseCaptions(srt)).toEqual([
      { startMs: 1_250, endMs: 3_000, text: 'First line.' },
    ]);
  });

  it('joins multi-line cues and strips inline tags', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<v Alice>She turns away,
<i>quietly</i>.
`;
    expect(parseCaptions(vtt)[0].text).toBe('She turns away, quietly.');
  });

  it('survives CRLF, a BOM, and positioning cues', () => {
    const vtt = '﻿WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000 line:0 position:50%\r\nText.\r\n';
    expect(parseCaptions(vtt)).toHaveLength(1);
  });

  it('pads a short fraction rather than misreading it', () => {
    // "5" means 500ms, not 5ms.
    const srt = '1\n00:00:00,5 --> 00:00:01,0\nX\n';
    expect(parseCaptions(srt)[0].startMs).toBe(500);
  });

  it('treats sound-effect captions as non-speech so they stay inside gaps', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
[dramatic music]

00:00:05.000 --> 00:00:06.000
(door creaks)

00:00:07.000 --> 00:00:08.000
Actual dialogue.
`;
    const parsed = parseCaptions(vtt);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe('Actual dialogue.');
  });

  it('keeps a cue that is only partly bracketed, because someone is speaking', () => {
    // "[in Spanish] Vámonos." has dialogue after the bracket, so it is speech
    // even with bracketedIsNonSpeech on. Only wholly-bracketed cues are dropped.
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n[in Spanish] Vámonos.\n';
    expect(parseCaptions(vtt, { bracketedIsNonSpeech: true })).toHaveLength(1);
  });

  it('keeps wholly-bracketed cues when told they carry dialogue', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n[Vámonos]\n';
    expect(parseCaptions(vtt, { bracketedIsNonSpeech: false })).toHaveLength(1);
  });

  it('discards zero-length and inverted cues', () => {
    const vtt = `WEBVTT

00:00:05.000 --> 00:00:05.000
Zero.

00:00:09.000 --> 00:00:08.000
Backwards.
`;
    expect(parseCaptions(vtt)).toHaveLength(0);
  });
});

describe('mergeSpeech: never invent a gap inside dialogue', () => {
  it('merges overlapping lines from two speakers', () => {
    expect(mergeSpeech([sp(1_000, 3_000, 'a'), sp(2_000, 4_000, 'b')])).toEqual([
      { startMs: 1_000, endMs: 4_000, text: 'a b' },
    ]);
  });

  it('merges lines that touch exactly', () => {
    expect(mergeSpeech([sp(0, 1_000), sp(1_000, 2_000)])).toHaveLength(1);
  });

  it('keeps genuinely separate lines apart', () => {
    expect(mergeSpeech([sp(0, 1_000), sp(5_000, 6_000)])).toHaveLength(2);
  });

  it('swallows a line fully contained in another', () => {
    const merged = mergeSpeech([sp(0, 10_000, 'long'), sp(2_000, 3_000, 'short')]);
    expect(merged).toEqual([{ startMs: 0, endMs: 10_000, text: 'long short' }]);
  });

  it('handles unsorted input', () => {
    expect(mergeSpeech([sp(5_000, 6_000), sp(0, 1_000)])[0].startMs).toBe(0);
  });
});

describe('gapsFromSpeech', () => {
  it('finds the gap before, between, and after dialogue', () => {
    const gaps = gapsFromSpeech(
      [sp(5_000, 7_000), sp(15_000, 16_000)],
      opts(25_000, { padMs: 0 }),
    );
    expect(gaps).toEqual([
      { startMs: 0, durationMs: 5_000 },
      { startMs: 7_000, durationMs: 8_000 },
      { startMs: 16_000, durationMs: 9_000 },
    ]);
  });

  it('takes padding off both ends', () => {
    const gaps = gapsFromSpeech([sp(5_000, 7_000)], opts(12_000, { padMs: 200 }));
    // leading gap 0..5000 becomes 200..4800
    expect(gaps[0]).toEqual({ startMs: 200, durationMs: 4_600 });
  });

  it('discards gaps too short to be useful after padding', () => {
    // 1300ms raw, minus 2x150 padding = 1000ms, below the 1200ms floor
    const gaps = gapsFromSpeech(
      [sp(0, 1_000), sp(2_300, 3_000)],
      opts(3_000),
    );
    expect(gaps).toHaveLength(0);
  });

  it('reports the whole programme when nothing is spoken', () => {
    expect(gapsFromSpeech([], opts(60_000, { padMs: 0 }))).toEqual([
      { startMs: 0, durationMs: 60_000 },
    ]);
  });

  it('finds no gap in wall-to-wall dialogue', () => {
    expect(gapsFromSpeech([sp(0, 30_000)], opts(30_000))).toHaveLength(0);
  });

  it('never returns a gap that overlaps speech', () => {
    const speech = [sp(1_000, 4_000), sp(3_500, 9_000), sp(20_000, 21_000)];
    for (const g of gapsFromSpeech(speech, opts(30_000, { padMs: 0 }))) {
      const end = g.startMs + g.durationMs;
      for (const s of speech) {
        expect(end <= s.startMs || g.startMs >= s.endMs).toBe(true);
      }
    }
  });

  it('never returns a non-positive duration', () => {
    for (const g of gapsFromSpeech([sp(0, 100), sp(200, 300)], opts(400))) {
      expect(g.durationMs).toBeGreaterThan(0);
    }
  });
});

describe('gapsFromCaptions: end to end', () => {
  it('turns a caption file into describable silences', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
She opens the letter.

00:00:08.000 --> 00:00:09.000
[music swells]

00:00:14.000 --> 00:00:15.000
Goodbye.
`;
    // [music swells] is non-speech, so 2s..14s is one continuous gap.
    const gaps = gapsFromCaptions(vtt, opts(20_000, { padMs: 0 }));
    expect(gaps).toEqual([
      { startMs: 2_000, durationMs: 12_000 },
      { startMs: 15_000, durationMs: 5_000 },
    ]);
  });
});

describe('contextBefore: selection, not compression', () => {
  const speech = [sp(0, 1_000, 'Where is she?'), sp(2_000, 3_000, 'Gone.')];

  it('returns the dialogue leading into a gap', () => {
    expect(contextBefore({ startMs: 5_000, durationMs: 3_000 }, speech)).toBe(
      'Where is she? Gone.',
    );
  });

  it('ignores dialogue after the gap', () => {
    expect(contextBefore({ startMs: 1_500, durationMs: 500 }, speech)).toBe(
      'Where is she?',
    );
  });

  it('respects the window', () => {
    expect(contextBefore({ startMs: 60_000, durationMs: 1_000 }, speech, 5_000)).toBe('');
  });
});
