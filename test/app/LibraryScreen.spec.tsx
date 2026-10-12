/**
 * The library's job is to state, per title, whether a blind viewer can
 * follow it. Most rows saying no is the argument, not a gap in the demo, so
 * the tests protect that rather than treating it as a placeholder.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { LibraryScreen } from '../../src/app/LibraryScreen';
import { describedCount, type Title } from '../../src/app/catalogue';

const plain = (id: string, name: string): Title => ({
  id,
  name,
  attribution: 'Public domain',
  videoUrl: 'https://example.test/v.m3u8',
});

const described = (id: string, name: string): Title => ({
  ...plain(id, name),
  description: {
    trackUrl: 'https://example.test/d.m3u8',
    manifest: { titleId: id, durationMs: 60_000, cues: [] },
    provenance: 'Generated 12 Oct 2026 · 41 descriptions',
  },
});

const flat = (node: ReturnType<typeof render>) => JSON.stringify(node.toJSON());

/**
 * Text with interpolation renders as separate children — `{n} of {m} …`
 * becomes ["1", " of ", "3", " titles …"] — so a flattened substring match
 * cannot see the joined sentence. Collect the leaf strings and join them.
 */
const visibleText = (node: ReturnType<typeof render>): string => {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object' && 'children' in n) {
      walk((n as { children: unknown }).children);
    }
  };
  walk(node.toJSON());
  return out.join('');
};

describe('LibraryScreen', () => {
  it('says how many titles a blind viewer can follow', () => {
    const s = visibleText(render(
      <LibraryScreen
        titles={[described('a', 'A'), plain('b', 'B'), plain('c', 'C')]}
        onOpen={() => {}}
      />,
    ));
    expect(s).toContain('1 of 3 titles can be followed without sight');
  });

  it('marks an undescribed title as such, rather than omitting it', () => {
    // Hiding them would show a solved problem.
    const s = flat(render(<LibraryScreen titles={[plain('b', 'Archive Reel')]} onOpen={() => {}} />));
    expect(s).toContain('Archive Reel');
    expect(s).toContain('NO AUDIO DESCRIPTION');
  });

  it('names the reason a title has none', () => {
    // Not an oversight by the channel — it is what a describer costs.
    const s = flat(render(<LibraryScreen titles={[plain('b', 'B')]} onOpen={() => {}} />));
    expect(s).toContain('$15–30 per finished minute');
  });

  it('shows where a description came from', () => {
    const s = flat(render(<LibraryScreen titles={[described('a', 'A')]} onOpen={() => {}} />));
    expect(s).toContain('AUDIO DESCRIPTION');
    expect(s).toContain('41 descriptions');
  });

  it('still offers to play an undescribed title', () => {
    // Refusing would make the app less useful than the channel it sits on.
    const s = flat(render(<LibraryScreen titles={[plain('b', 'B')]} onOpen={() => {}} />));
    expect(s).toContain('Watch without description');
  });

  it('carries the rights line, which CC-BY material requires', () => {
    const s = flat(render(<LibraryScreen titles={[plain('b', 'B')]} onOpen={() => {}} />));
    expect(s).toContain('Public domain');
  });
});

describe('describedCount', () => {
  it('counts only titles with a track', () => {
    expect(describedCount([described('a', 'A'), plain('b', 'B')])).toBe(1);
  });

  it('is zero for a catalogue with none', () => {
    expect(describedCount([plain('a', 'A'), plain('b', 'B')])).toBe(0);
  });
});
