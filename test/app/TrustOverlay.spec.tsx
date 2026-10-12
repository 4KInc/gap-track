/**
 * The overlay is the evidence the guarantee is real, so what it renders is
 * worth pinning down. The specific thing being protected: a DROP must show
 * the arithmetic that caused it. A verdict without its operands is just the
 * app asserting it was careful, which is what the overlay exists to replace.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { TrustOverlay } from '../../src/app/TrustOverlay';
import { DEFAULT_CONFIG, type Cue, type Decision } from '../../src/engine/types';

const cue = (over: Partial<Cue> = {}): Cue => ({
  id: 'c1',
  gap: { startMs: 10_000, durationMs: 3_400 },
  text: 'She folds the letter.',
  audioDurationMs: 1_420,
  trackOffsetMs: 10_000,
  ...over,
});

const play = (): Decision => ({ verdict: 'PLAY', cue: cue(), headroomMs: 1_730 });

const drop = (): Decision => ({
  verdict: 'DROP',
  cue: cue({ audioDurationMs: 3_100, gap: { startMs: 20_000, durationMs: 1_600 } }),
  reason: 'WOULD_OVERRUN',
  overrunMs: 1_750,
});

const flat = (node: ReturnType<typeof render>): string =>
  JSON.stringify(node.toJSON());

describe('TrustOverlay', () => {
  it('shows both measured operands and the margin for an admitted cue', () => {
    const s = flat(render(
      <TrustOverlay
        playheadMs={9_000}
        config={DEFAULT_CONFIG}
        events={[{ decision: play(), atMs: 9_000 }]}
        speakingText={null}
      />,
    ));

    expect(s).toContain('1420ms');  // speech, measured
    expect(s).toContain('250ms');   // margin, configured
    expect(s).toContain('3400ms');  // silence, measured
    expect(s).toContain('1730ms to spare');
  });

  it('shows the overrun on a drop, not just the word DROP', () => {
    // The whole point: a refusal has to be inspectable.
    const s = flat(render(
      <TrustOverlay
        playheadMs={19_000}
        config={DEFAULT_CONFIG}
        events={[{ decision: drop(), atMs: 19_000 }]}
        speakingText={null}
      />,
    ));

    expect(s).toContain('3100ms');
    expect(s).toContain('1600ms');
    expect(s).toContain('would run 1750ms into the dialogue');
  });

  it('shows the comparison direction that produced the verdict', () => {
    expect(flat(render(
      <TrustOverlay playheadMs={0} config={DEFAULT_CONFIG}
        events={[{ decision: play(), atMs: 0 }]} speakingText={null} />,
    ))).toContain('≤');

    expect(flat(render(
      <TrustOverlay playheadMs={0} config={DEFAULT_CONFIG}
        events={[{ decision: drop(), atMs: 0 }]} speakingText={null} />,
    ))).toContain('>');
  });

  it('labels which numbers were measured and which were chosen', () => {
    // A judge should be able to see the margin is a setting and the other
    // two are observations, without being told.
    const s = flat(render(
      <TrustOverlay playheadMs={0} config={DEFAULT_CONFIG}
        events={[{ decision: play(), atMs: 0 }]} speakingText={null} />,
    ));
    expect(s).toContain('measured');
    expect(s).toContain('configured');
  });

  it('names a non-timing refusal in plain words', () => {
    const s = flat(render(
      <TrustOverlay playheadMs={0} config={DEFAULT_CONFIG}
        events={[{
          decision: { verdict: 'DROP', cue: cue(), reason: 'OVERLAPS_PREVIOUS', overrunMs: 0 },
          atMs: 0,
        }]}
        speakingText={null} />,
    ));
    expect(s).toContain('overlaps previous');
  });

  it('shows what is sounding right now', () => {
    const s = flat(render(
      <TrustOverlay playheadMs={0} config={DEFAULT_CONFIG} events={[]}
        speakingText="A door opens." />,
    ));
    expect(s).toContain('SPEAKING');
    expect(s).toContain('A door opens.');
  });

  it('says it is waiting rather than rendering an empty frame', () => {
    const s = flat(render(
      <TrustOverlay playheadMs={0} config={DEFAULT_CONFIG} events={[]} speakingText={null} />,
    ));
    expect(s).toContain('Waiting for the first gap');
  });

  it('formats the playhead as a readable clock', () => {
    const s = flat(render(
      <TrustOverlay playheadMs={83_400} config={DEFAULT_CONFIG} events={[]} speakingText={null} />,
    ));
    expect(s).toContain('01:23.4');
  });

  it('keeps history newest-first and bounded', () => {
    const events = Array.from({ length: 30 }, (_, i) => ({
      decision: { ...play(), cue: cue({ id: `c${i}`, text: `line ${i}` }) },
      atMs: i * 1_000,
    }));
    const s = flat(render(
      <TrustOverlay playheadMs={30_000} config={DEFAULT_CONFIG} events={events} speakingText={null} />,
    ));
    expect(s).toContain('line 0');
    expect(s).not.toContain('line 29'); // trimmed, not scrolled off a huge list
  });
});
