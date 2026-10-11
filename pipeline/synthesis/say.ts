/**
 * Local synthesis via macOS `say`, so the whole pipeline runs end to end with
 * no cloud account and no credentials.
 *
 * This is not a stand-in for Polly in the submission — the AWS integration is
 * real and documented separately. It exists so the engine, the packager and
 * the cue-track assembly can be developed and tested without a network round
 * trip per line, and so the test suite stays hermetic.
 *
 * macOS only. The interface is the point; Polly implements the same one.
 */

import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { wavInfo } from './wav';
import { UnmeasurableAudioError, type SynthesisResult, type Synthesizer } from './types';

const run = promisify(execFile);

export interface SayOptions {
  /** `say -v ?` lists what is installed. Samantha ships by default. */
  voice?: string;
  /** Words per minute. Description narration is read a touch slower. */
  rate?: number;
  sampleRate?: number;
}

export class SayVoice implements Synthesizer {
  readonly name = 'macos-say';
  readonly sampleRate: number;
  private readonly voice: string;
  private readonly rate: number;

  constructor(opts: SayOptions = {}) {
    this.voice = opts.voice ?? 'Samantha';
    this.rate = opts.rate ?? 180;
    this.sampleRate = opts.sampleRate ?? 24_000;
  }

  async synthesize(text: string, outPath: string): Promise<SynthesisResult> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('refusing to synthesise empty text');

    await mkdir(dirname(outPath), { recursive: true });
    const aiff = `${outPath}.tmp.aiff`;

    try {
      // `say` writes AIFF; afconvert gives us PCM WAV we can measure exactly.
      await run('say', ['-v', this.voice, '-r', String(this.rate), '-o', aiff, '--', trimmed]);
      await run('afconvert', [
        '-f', 'WAVE',
        '-d', `LEI16@${this.sampleRate}`,
        '-c', '1',
        aiff,
        outPath,
      ]);
    } finally {
      await unlink(aiff).catch(() => {
        /* best effort; a stale temp file is not worth failing a build over */
      });
    }

    let durationMs: number;
    let sampleRate: number;
    try {
      const info = wavInfo(await readFile(outPath));
      durationMs = info.durationMs;
      sampleRate = info.sampleRate;
    } catch (err) {
      throw new UnmeasurableAudioError(outPath, (err as Error).message);
    }

    // A measurement of zero is not a short cue, it is a failed measurement.
    // Letting it through would hand admission a number nobody checked.
    if (!(durationMs > 0)) {
      throw new UnmeasurableAudioError(outPath, `measured ${durationMs}ms`);
    }

    return {
      text: trimmed,
      audioPath: outPath,
      durationMs,
      engine: this.name,
      voice: this.voice,
      sampleRate,
    };
  }
}

/** True when local synthesis is available, so tests can skip elsewhere. */
export async function sayAvailable(): Promise<boolean> {
  try {
    await run('say', ['-v', '?']);
    await run('afconvert', ['-h']).catch(() => undefined); // prints usage, exits non-zero
    return true;
  } catch {
    return false;
  }
}
