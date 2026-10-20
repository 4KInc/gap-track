#!/usr/bin/env node
/**
 * Prove the claim against the source captions.
 *
 *   npx tsx scripts/verify-no-overlap.ts <track.json> <captions.srt>
 *
 * verify-track.ts checks a track against the engine's own arithmetic, which
 * is a check that the code agrees with itself. This checks it against the
 * thing the claim is actually about: the dialogue in the film.
 *
 * Every cue is replayed as the interval it will occupy —
 *
 *     [trackOffsetMs, trackOffsetMs + audioDurationMs)
 *
 * — and intersected with every speech interval parsed straight out of the
 * caption file. Any intersection at all is a failure, because "never talks
 * over dialogue" does not have a tolerance.
 *
 * Bracketed captions are treated as non-speech here for the same reason the
 * gap finder does: `[MUSIC]` and `(door creaks)` describe sound rather than
 * transcribe it, so nobody is talking and a description may play across them.
 */

import { existsSync, readFileSync } from 'node:fs';

import { parseCaptions, mergeSpeech } from '../src/engine/gaps';
import type { Cue } from '../src/engine/types';

// Defaults to the demo assets, which live in the repo rather than in /tmp:
// this command is in the demo script, and a scratch directory that a reboot
// clears is not something to find out about while recording.
const trackPath = process.argv[2] ?? 'build/demo/sintel-track.json';
const captionsPath = process.argv[3] ?? 'build/demo/sintel_en.srt';

for (const [what, where] of [
  ['track', trackPath],
  ['captions', captionsPath],
]) {
  if (!existsSync(where)) {
    process.stderr.write(
      `no ${what} at ${where}\n` +
        'usage: verify-no-overlap.ts [track.json] [captions.srt]\n' +
        'build the demo assets with: npm run demo:assets\n',
    );
    process.exit(2);
  }
}

const { cues } = JSON.parse(readFileSync(trackPath, 'utf8')) as { cues: Cue[] };
const speech = mergeSpeech(parseCaptions(readFileSync(captionsPath, 'utf8')));

const clashes: string[] = [];
let narratingMs = 0;

for (const cue of cues) {
  const start = cue.trackOffsetMs;
  const end = start + cue.audioDurationMs;
  narratingMs += cue.audioDurationMs;

  for (const line of speech) {
    const overlap = Math.min(end, line.endMs) - Math.max(start, line.startMs);
    if (overlap > 0) {
      clashes.push(
        `  ${fmt(start)}–${fmt(end)} over speech ${fmt(line.startMs)}–${fmt(line.endMs)} ` +
          `(${overlap}ms): "${line.text.slice(0, 50)}"`,
      );
    }
  }
}

const speechMs = speech.reduce((n, s) => n + (s.endMs - s.startMs), 0);

process.stdout.write(
  [
    `${cues.length} cues against ${speech.length} speech runs`,
    `  narration      ${(narratingMs / 1000).toFixed(1)}s`,
    `  dialogue       ${(speechMs / 1000).toFixed(1)}s`,
    `  collisions     ${clashes.length}`,
    '',
  ].join('\n'),
);
for (const c of clashes.slice(0, 20)) process.stdout.write(`${c}\n`);

if (clashes.length) process.exit(1);
process.stdout.write('  no description overlaps any line of dialogue\n');

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
