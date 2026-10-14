/**
 * Finding the silences a description is allowed to live in.
 *
 * The question is not "where is the audio quiet" but "where is nobody
 * speaking", and those are different. A scene carried by music with no
 * dialogue is the single best place to describe something, and energy-based
 * silence detection would refuse it for being loud.
 *
 * Captions mark dialogue directly, to the millisecond, and far more content
 * carries captions than carries audio description. So the precise path is to
 * invert the caption track: speech is what the captions cover, and a gap is
 * everything else.
 *
 * VAD remains the fallback for content with no captions. It is less accurate
 * for exactly the reason above, so it is the second choice rather than the
 * first.
 */

import type { Gap } from './types';

export interface SpeechInterval {
  startMs: number;
  endMs: number;
  text: string;
}

export interface GapOptions {
  /**
   * Shortest gap worth describing. Below this there is no room for anything
   * useful once the safety margin is taken out.
   */
  minGapMs: number;

  /**
   * Breathing room left after a line ends and before the next begins.
   * Butting a description directly against dialogue is technically within
   * the gap and sounds wrong, so real description practice leaves a beat.
   */
  padMs: number;

  /**
   * Total programme duration, so the trailing gap after the last line can be
   * found. Without it the final silence is invisible.
   */
  durationMs: number;

  /**
   * Longest single describable slot.
   *
   * A silence of two minutes is not one description, it is several. Left
   * whole it buys a word budget of a few hundred, which produces one
   * rambling paragraph spoken over a scene that has moved on three times
   * since it began. Real description practice places short remarks as
   * things happen, so long gaps are divided into slots of at most this.
   */
  maxGapMs: number;

  /**
   * Treat captions that are entirely bracketed — `[MUSIC]`, `(door creaks)` —
   * as non-speech, leaving them inside gaps.
   *
   * These describe sound rather than transcribe it, so nobody is talking and
   * a description can play over them. Defaults true; set false for content
   * where bracketed cues carry dialogue, such as `[in Spanish]`.
   */
  bracketedIsNonSpeech: boolean;
}

export const DEFAULT_GAP_OPTIONS: Omit<GapOptions, 'durationMs'> = {
  minGapMs: 1_200,
  // Eight seconds is about twenty words: a long sentence, not a paragraph.
  maxGapMs: 8_000,
  padMs: 150,
  bracketedIsNonSpeech: true,
};

const TIMESTAMP =
  /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;

function toMs(h: string, m: string, s: string, frac: string): number {
  // WebVTT uses milliseconds, SRT uses the same field; pad so "5" reads as 500.
  const ms = Number(frac.padEnd(3, '0'));
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + ms;
}

/** True when a caption only describes sound rather than transcribing speech. */
function isBracketedOnly(text: string): boolean {
  const stripped = text.replace(/\s+/g, ' ').trim();
  if (!stripped) return true;
  return /^(\[[^\]]*\]|\([^)]*\)|♪[^♪]*♪?)+$/.test(stripped);
}

/**
 * Parse WebVTT or SRT into speech intervals.
 *
 * Deliberately tolerant: real caption files carry BOM marks, CRLF, numeric
 * cue identifiers, positioning cues after the timestamp, and inconsistent
 * blank lines. None of that is worth failing over.
 */
export function parseCaptions(
  source: string,
  opts: { bracketedIsNonSpeech?: boolean } = {},
): SpeechInterval[] {
  const bracketedIsNonSpeech = opts.bracketedIsNonSpeech ?? true;
  const lines = source.replace(/^﻿/, '').split(/\r?\n/);
  const out: SpeechInterval[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = TIMESTAMP.exec(lines[i]);
    if (!m) continue;

    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);

    const body: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j++) {
      body.push(lines[j]);
      i = j;
    }

    // Strip VTT inline tags: <v Speaker>, <i>, <00:00:01.000> karaoke marks.
    const text = body.join(' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    if (endMs <= startMs) continue; // zero or negative duration, discard
    if (bracketedIsNonSpeech && isBracketedOnly(text)) continue;
    if (!text) continue;

    out.push({ startMs, endMs, text });
  }

  return out.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Collapse overlapping or touching speech into non-overlapping runs.
 *
 * Captions overlap constantly — two speakers, or a line held on screen while
 * the next begins. Inverting without merging first would invent gaps inside
 * continuous dialogue, which is the one place a description must never land.
 */
export function mergeSpeech(intervals: SpeechInterval[]): SpeechInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: SpeechInterval[] = [{ ...sorted[0] }];

  for (const next of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (next.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, next.endMs);
      last.text = `${last.text} ${next.text}`.trim();
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

/**
 * Invert speech into the gaps between it.
 *
 * Padding is taken off both ends of every gap, then anything left shorter
 * than `minGapMs` is discarded. A gap is reported only if it survives both.
 */
export function gapsFromSpeech(
  speech: SpeechInterval[],
  options: GapOptions,
): Gap[] {
  const { minGapMs, padMs, durationMs } = options;
  const merged = mergeSpeech(speech);
  const gaps: Gap[] = [];

  const maxGapMs = options.maxGapMs ?? DEFAULT_GAP_OPTIONS.maxGapMs;

  const push = (rawStart: number, rawEnd: number) => {
    const startMs = rawStart + padMs;
    const endMs = rawEnd - padMs;
    const total = endMs - startMs;
    if (total < minGapMs) return;

    if (total <= maxGapMs) {
      gaps.push({ startMs, durationMs: total });
      return;
    }

    // Divide evenly rather than taking maxGapMs slices and leaving a runt at
    // the end: an even split keeps every remark a similar length, and a
    // two-second offcut after four full slots would be described in three
    // words for no reason other than arithmetic.
    const slots = Math.ceil(total / maxGapMs);
    const each = Math.floor(total / slots);
    for (let i = 0; i < slots; i++) {
      const slotStart = startMs + i * each;
      // The last slot absorbs the rounding remainder.
      const slotLength = i === slots - 1 ? endMs - slotStart : each;
      if (slotLength >= minGapMs) {
        gaps.push({ startMs: slotStart, durationMs: slotLength });
      }
    }
  };

  if (merged.length === 0) {
    push(0, durationMs);
    return gaps;
  }

  push(0, merged[0].startMs); // before the first line
  for (let i = 0; i < merged.length - 1; i++) {
    push(merged[i].endMs, merged[i + 1].startMs);
  }
  push(merged[merged.length - 1].endMs, durationMs); // after the last

  return gaps;
}

/** Convenience: caption file straight to gaps. */
export function gapsFromCaptions(source: string, options: GapOptions): Gap[] {
  return gapsFromSpeech(
    parseCaptions(source, { bracketedIsNonSpeech: options.bracketedIsNonSpeech }),
    options,
  );
}

/**
 * The dialogue immediately before a gap.
 *
 * Needed when generating: with a budget of three words, choosing between an
 * entrance, a reaction and an object on a table is a question about what the
 * scene just established, not about the frame. Without this the model is
 * compressing rather than selecting.
 */
export function contextBefore(
  gap: Gap,
  speech: SpeechInterval[],
  windowMs = 20_000,
): string {
  const since = gap.startMs - windowMs;
  return speech
    .filter((s) => s.endMs <= gap.startMs && s.endMs >= since)
    .map((s) => s.text)
    .join(' ')
    .trim();
}
