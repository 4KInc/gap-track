#!/usr/bin/env node
/**
 * What each safety margin costs, on a real film.
 *
 *   npx tsx scripts/margin-sweep.ts build/tracks/sintel/track.json
 *
 * The margin is the one constant in the admission rule that is a preference
 * rather than a measurement, so it is offered to the viewer. This prints the
 * price of each setting in descriptions lost, which is the only honest way
 * to present that choice.
 */

import { readFileSync } from 'node:fs';

import { decide } from '../src/engine/admission';
import { DEFAULT_CONFIG } from '../src/engine/types';
import type { Cue } from '../src/engine/types';

const path = process.argv[2] ?? '/tmp/gt/polly/sintel/track.json';
const { cues } = JSON.parse(readFileSync(path, 'utf8')) as { cues: Cue[] };

process.stdout.write(`${cues.length} cues\n\n`);
process.stdout.write('  margin   plays  refused  narration\n');

for (const safetyMarginMs of [250, 750, 1_500, 3_000]) {
  const config = { ...DEFAULT_CONFIG, safetyMarginMs };
  const kept = cues.filter((c) => decide(c, c.gap.startMs, config).verdict === 'PLAY');
  const secs = kept.reduce((n, c) => n + c.audioDurationMs, 0) / 1000;
  process.stdout.write(
    `  ${String(safetyMarginMs).padStart(5)}ms  ${String(kept.length).padStart(5)}` +
      `  ${String(cues.length - kept.length).padStart(7)}  ${secs.toFixed(0).padStart(6)}s\n`,
  );
}
