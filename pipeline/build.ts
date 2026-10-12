/**
 * The whole pipeline, joined up.
 *
 *   captions ─→ gaps ─→ frames ─→ describer ─→ synthesiser ─→ measured duration
 *                                                          ↓
 *            packaged HLS ←─ timeline track ←─ admission ──┘
 *
 * Every stage is already tested in isolation. This is the part that turns a
 * film and a caption file into something a television can play, and the only
 * place that knows the order.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_CONFIG, type SchedulerConfig } from '../src/engine/types';
import { wordBudget } from '../src/engine/admission';
import {
  DEFAULT_GAP_OPTIONS,
  contextBefore,
  gapsFromSpeech,
  parseCaptions,
  type SpeechInterval,
} from '../src/engine/gaps';
import { assembleTrack, summarise, type Candidate, type CueTrack } from './assemble';
import { framesBefore, probeDurationMs } from './frames';
import { packageHls, type PackagedTrack } from './package';
import type { Describer } from './describe/types';
import type { Synthesizer } from './synthesis/types';

export interface BuildOptions {
  titleId: string;
  videoPath: string;
  captionsPath: string;
  outDir: string;
  describer: Describer;
  synth: Synthesizer;
  config?: Partial<SchedulerConfig>;
  minGapMs?: number;
  padMs?: number;
  /** Progress, so a feature film is not a silent twenty minutes. */
  log?: (line: string) => void;
}

export interface BuildResult {
  track: CueTrack;
  packaged: PackagedTrack;
  durationMs: number;
  gapCount: number;
  describedCount: number;
  declinedCount: number;
}

/**
 * Descriptions already written for this title, so a rerun does not pay for
 * them again.
 *
 * Keyed by gap start and word budget: the same silence with a different
 * budget is a different brief and must be rewritten. Worth having because a
 * feature film is hundreds of vision calls and the loop above this one gets
 * rerun whenever the synthesiser or the margin changes.
 */
type DescriptionCache = Record<string, string>;

const cacheKey = (gapStartMs: number, budget: number) => `${gapStartMs}:${budget}`;

export async function buildTrack(opts: BuildOptions): Promise<BuildResult> {
  const log = opts.log ?? (() => {});
  const config = { ...DEFAULT_CONFIG, ...opts.config };
  const workDir = join(opts.outDir, opts.titleId);
  await mkdir(workDir, { recursive: true });

  const durationMs = await probeDurationMs(opts.videoPath);
  log(`${opts.titleId}: ${(durationMs / 1000 / 60).toFixed(1)} min`);

  const speech: SpeechInterval[] = parseCaptions(await readFile(opts.captionsPath, 'utf8'));
  const gaps = gapsFromSpeech(speech, {
    ...DEFAULT_GAP_OPTIONS,
    minGapMs: opts.minGapMs ?? DEFAULT_GAP_OPTIONS.minGapMs,
    padMs: opts.padMs ?? DEFAULT_GAP_OPTIONS.padMs,
    durationMs,
  });
  log(`${speech.length} spoken runs, ${gaps.length} describable gaps`);

  const cachePath = join(workDir, 'descriptions.json');
  const cache: DescriptionCache = await readFile(cachePath, 'utf8')
    .then((s) => JSON.parse(s) as DescriptionCache)
    .catch(() => ({}));

  const candidates: Candidate[] = [];
  const recent: string[] = [];
  let declined = 0;
  let fromCache = 0;

  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i];
    const budget = wordBudget(gap, config);
    if (budget < 1) {
      declined++;
      continue;
    }

    const key = cacheKey(gap.startMs, budget);
    let text = cache[key];

    if (text === undefined) {
      const frames = await framesBefore(opts.videoPath, gap.startMs, join(workDir, 'frames'));
      const result = await opts.describer.describe({
        frames,
        wordBudget: budget,
        dialogueBefore: contextBefore(gap, speech),
        // Only the last few: the writer needs to avoid repeating itself, not
        // to carry the whole film in every prompt.
        recentDescriptions: recent.slice(-5),
      });
      text = result.declined ? '' : result.text;
      cache[key] = text;
      await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    } else {
      fromCache++;
    }

    if (!text) {
      declined++;
      log(`  ${fmt(gap.startMs)}  (${budget}w)  declined`);
      continue;
    }

    recent.push(text);
    candidates.push({ gap, text });
    log(`  ${fmt(gap.startMs)}  (${budget}w)  "${text}"`);
  }

  log(`${candidates.length} written, ${declined} declined${fromCache ? `, ${fromCache} from cache` : ''}`);

  const track = await assembleTrack(candidates, {
    titleId: opts.titleId,
    durationMs,
    synth: opts.synth,
    outDir: opts.outDir,
    config,
  });
  log(summarise(track));

  const packaged = await packageHls(track.audioPath, join(workDir, 'hls'));
  log(
    `packaged: ${packaged.segmentCount} segments`
    + (packaged.latencyMs ? `, ${packaged.latencyMs}ms latency` : ''),
  );

  // The device needs the cue list and the stream together, so write the one
  // file it will actually fetch.
  const deviceManifest = {
    titleId: opts.titleId,
    durationMs,
    descriptionTrackUrl: 'hls/index.m3u8',
    /** Packaging offset, so the device can correct rather than drift. */
    trackLatencyMs: packaged.latencyMs,
    config,
    cues: track.cues,
    rejected: track.rejected,
  };
  await writeFile(
    join(workDir, 'track.json'),
    `${JSON.stringify(deviceManifest, null, 2)}\n`,
    'utf8',
  );

  return {
    track,
    packaged,
    durationMs,
    gapCount: gaps.length,
    describedCount: track.cues.length,
    declinedCount: declined,
  };
}

const fmt = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
