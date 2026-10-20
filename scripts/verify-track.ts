#!/usr/bin/env node
/**
 * Re-check a built track against the engine that will play it.
 *
 *   npx tsx scripts/verify-track.ts build/tracks/sintel/track.json
 *
 * The pipeline already applies admission before writing a cue, so this
 * should always pass. That is the point: it is an independent check that the
 * artefact on disk honours the guarantee, run against the published file
 * rather than against the in-memory values the builder happened to hold.
 *
 * Three properties, all of which must hold for the claim to be true:
 *   - every cue is admitted at the instant its gap opens
 *   - no two cues can sound at once
 *   - every cue sits inside its own gap, margin included
 *
 * Exits non-zero on any violation, so it can gate a release.
 */

import { existsSync, readFileSync } from 'node:fs';

import { decide } from '../src/engine/admission';
import { DEFAULT_CONFIG } from '../src/engine/types';
import type { Cue } from '../src/engine/types';

const path = process.argv[2] ?? 'build/demo/sintel-track.json';
if (!existsSync(path)) {
  process.stderr.write(
    `no track at ${path}\n` +
      'usage: verify-track.ts [track.json]\n' +
      'build the demo assets with: npm run demo:assets\n',
  );
  process.exit(2);
}

const track = JSON.parse(readFileSync(path, 'utf8')) as {
  durationMs: number;
  cues: Cue[];
};
const { cues } = track;
const margin = DEFAULT_CONFIG.safetyMarginMs;

const refused = cues
  .map((c) => ({ c, d: decide(c, c.gap.startMs, DEFAULT_CONFIG) }))
  .filter(({ d }) => d.verdict !== 'PLAY');

const byOffset = [...cues].sort((a, b) => a.trackOffsetMs - b.trackOffsetMs);
const overlapping = byOffset.filter((cue, i) => {
  if (i === 0) return false;
  const prev = byOffset[i - 1];
  return cue.trackOffsetMs < prev.trackOffsetMs + prev.audioDurationMs;
});

const outside = cues.filter(
  (c) =>
    c.trackOffsetMs !== c.gap.startMs ||
    c.audioDurationMs + margin > c.gap.durationMs,
);

process.stdout.write(
  [
    `${path}`,
    `  ${cues.length} cues across ${(track.durationMs / 60_000).toFixed(1)} min`,
    `  admitted        ${cues.length - refused.length}/${cues.length}`,
    `  overlapping     ${overlapping.length}`,
    `  outside its gap ${outside.length}`,
    '',
  ].join('\n'),
);

for (const { c, d } of refused.slice(0, 10)) {
  process.stdout.write(`  REFUSED ${c.gap.startMs}ms  ${'reason' in d ? d.reason : ''}\n`);
}
for (const c of overlapping.slice(0, 10)) {
  process.stdout.write(`  OVERLAP ${c.trackOffsetMs}ms\n`);
}
for (const c of outside.slice(0, 10)) {
  process.stdout.write(`  OUTSIDE ${c.gap.startMs}ms\n`);
}

if (refused.length || overlapping.length || outside.length) process.exit(1);
