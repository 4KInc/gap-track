/**
 * The admission rule is the product's safety claim, so it gets pinned down
 * here rather than asserted in a README.
 *
 * The boundary cases matter most. A cue that exactly fills its gap must play;
 * a cue one millisecond over must not. Everything else is commentary.
 */

import { decide, explain, wordBudget } from '../../src/engine/admission';
import { DEFAULT_CONFIG, type Cue, type Gap, type SchedulerConfig } from '../../src/engine/types';

const config: SchedulerConfig = { ...DEFAULT_CONFIG, safetyMarginMs: 250 };

const gap = (startMs: number, durationMs: number): Gap => ({ startMs, durationMs });

const cue = (over: Partial<Cue> = {}): Cue => ({
  id: 'c1',
  gap: gap(10_000, 3_400),
  text: 'She folds the letter.',
  audioDurationMs: 1_420,
  trackOffsetMs: 0,
  ...over,
});

describe('admission: the arithmetic', () => {
  it('plays a cue that fits, and reports the spare time', () => {
    // 1420 + 250 = 1670, against a 3400ms gap
    const d = decide(cue(), 9_000, config);
    expect(d.verdict).toBe('PLAY');
    if (d.verdict === 'PLAY') expect(d.headroomMs).toBe(1_730);
  });

  it('drops a cue that would overrun, and says by how much', () => {
    // 3100 + 250 = 3350, against a 1600ms gap
    const d = decide(
      cue({ audioDurationMs: 3_100, gap: gap(10_000, 1_600) }),
      9_000,
      config,
    );
    expect(d.verdict).toBe('DROP');
    if (d.verdict === 'DROP') {
      expect(d.reason).toBe('WOULD_OVERRUN');
      expect(d.overrunMs).toBe(1_750);
    }
  });

  it('admits a cue that exactly fills its gap', () => {
    // 3150 + 250 = 3400 exactly. The rule is <=, so this plays.
    const d = decide(cue({ audioDurationMs: 3_150 }), 9_000, config);
    expect(d.verdict).toBe('PLAY');
    if (d.verdict === 'PLAY') expect(d.headroomMs).toBe(0);
  });

  it('rejects a cue one millisecond over', () => {
    const d = decide(cue({ audioDurationMs: 3_151 }), 9_000, config);
    expect(d.verdict).toBe('DROP');
    if (d.verdict === 'DROP') expect(d.overrunMs).toBe(1);
  });

  it('counts the safety margin as part of what must fit', () => {
    // Without the margin this would fit exactly; with it, it cannot.
    const tight = cue({ audioDurationMs: 3_400 });
    expect(decide(tight, 9_000, config).verdict).toBe('DROP');
    expect(decide(tight, 9_000, { ...config, safetyMarginMs: 0 }).verdict).toBe('PLAY');
  });
});

describe('admission: lateness', () => {
  it('plays a cue whose gap is still ahead', () => {
    expect(decide(cue(), 9_500, config).verdict).toBe('PLAY');
  });

  it('tolerates being inside the margin', () => {
    // Playhead 200ms past gap start, margin is 250ms.
    expect(decide(cue(), 10_200, config).verdict).toBe('PLAY');
  });

  it('starts a cue late in a long gap, because completion is what matters', () => {
    // 300ms into a 5s silence, needing 1.25s. Punctuality is irrelevant;
    // finishing inside the gap is the only question.
    const d = decide(
      cue({ audioDurationMs: 1_000, gap: gap(10_100, 5_000) }),
      10_400,
      config,
    );
    expect(d.verdict).toBe('PLAY');
    if (d.verdict === 'PLAY') expect(d.headroomMs).toBe(3_450);
  });

  it('drops a cue whose moment has passed', () => {
    const d = decide(cue(), 14_000, config);
    expect(d.verdict).toBe('DROP');
    if (d.verdict === 'DROP') expect(d.reason).toBe('TOO_LATE');
  });

  it('reports overrun rather than lateness when a cue is both', () => {
    // An honest reason beats a technically-true one: this could never fit.
    const d = decide(
      cue({ audioDurationMs: 9_000, gap: gap(10_000, 1_000) }),
      90_000,
      config,
    );
    expect(d.verdict).toBe('DROP');
    if (d.verdict === 'DROP') expect(d.reason).toBe('WOULD_OVERRUN');
  });
});

describe('admission: refusing to guess', () => {
  it('drops a cue with no audio rather than assuming a duration', () => {
    const d = decide(cue({ audioDurationMs: 0 }), 9_000, config);
    expect(d.verdict).toBe('DROP');
    if (d.verdict === 'DROP') expect(d.reason).toBe('NO_AUDIO');
  });

  it('drops on a negative duration instead of treating it as free', () => {
    const d = decide(cue({ audioDurationMs: -1 }), 9_000, config);
    expect(d.verdict).toBe('DROP');
    if (d.verdict === 'DROP') expect(d.reason).toBe('NO_AUDIO');
  });

  it('drops on NaN, which arithmetic alone would wave through', () => {
    // NaN > x is false, so a bare comparison would have admitted this.
    const d = decide(cue({ audioDurationMs: NaN }), 9_000, config);
    expect(d.verdict).toBe('DROP');
    if (d.verdict === 'DROP') expect(d.reason).toBe('NO_AUDIO');
  });
});

describe('explain: the numbers are shown, not the conclusion', () => {
  it('shows the sum for an admitted cue', () => {
    const d = decide(cue(), 9_000, config);
    expect(explain(d, config)).toContain('1420 + 250 <= 3400ms');
  });

  it('shows the overrun for a dropped cue', () => {
    const d = decide(cue({ audioDurationMs: 3_100, gap: gap(10_000, 1_600) }), 9_000, config);
    expect(explain(d, config)).toContain('would overrun by 1750ms');
  });
});

describe('wordBudget: writing to a brief', () => {
  it('derives a budget from the usable part of the gap', () => {
    // (3400 - 250) / 1000 * 2.5 = 7.875 -> 7
    expect(wordBudget(gap(0, 3_400), config)).toBe(7);
  });

  it('returns zero for a gap too small to hold anything', () => {
    expect(wordBudget(gap(0, 250), config)).toBe(0);
    expect(wordBudget(gap(0, 100), config)).toBe(0);
  });

  it('never returns a budget a cue could not physically fit', () => {
    // A budget spoken at the assumed rate must leave the margin intact.
    for (const ms of [500, 1_000, 2_000, 3_400, 8_000]) {
      const words = wordBudget(gap(0, ms), config);
      const spokenMs = (words / 2.5) * 1000;
      expect(spokenMs + config.safetyMarginMs).toBeLessThanOrEqual(ms);
    }
  });
});
