/**
 * Amazon Polly, behind the same interface as macOS `say`.
 *
 * Polly is asked for `pcm`, not `mp3`, and the reason is the safety
 * guarantee. MP3 is a compressed format whose duration has to be inferred
 * from frame headers or trusted from a muxer, and an encoder is free to pad
 * the final frame. PCM has no such ambiguity: the duration is the sample
 * count divided by the sample rate, exactly, and nothing in the path can
 * round it. Admission compares that number against a measured gap, so an
 * approximate duration here would quietly turn the guarantee into an
 * estimate.
 *
 * Polly's PCM comes back headerless, so it is wrapped in a WAV container on
 * the way to disk and then measured back off the file — not trusted from the
 * byte count in memory. That costs one read and removes a class of bug where
 * what was measured and what was written are not the same thing.
 *
 * Neural voices are the default. They are a little more expensive per
 * character and markedly better at the register description needs: flat,
 * unhurried, and not acting.
 */

import { writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

import {
  PollyClient,
  SynthesizeSpeechCommand,
  type Engine,
  type VoiceId,
} from '@aws-sdk/client-polly';

import { UnmeasurableAudioError, type SynthesisResult, type Synthesizer } from './types';
import { wavInfo, wrapPcm } from './wav';

export interface PollyOptions {
  voice?: VoiceId;
  engine?: Engine;
  region?: string;
  /**
   * Polly's PCM rates. 16000 is the highest it offers for PCM and the only
   * sensible choice: the track is resampled once during packaging anyway, so
   * starting lower only loses information.
   */
  sampleRate?: 8_000 | 16_000;
}

export class PollyVoice implements Synthesizer {
  readonly name = 'polly';
  readonly sampleRate: number;

  private readonly client: PollyClient;
  private readonly voice: VoiceId;
  private readonly engine: Engine;

  constructor(opts: PollyOptions = {}) {
    this.voice = opts.voice ?? ('Joanna' as VoiceId);
    this.engine = opts.engine ?? ('neural' as Engine);
    this.sampleRate = opts.sampleRate ?? 16_000;
    this.client = new PollyClient({ region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  }

  async synthesize(text: string, outPath: string): Promise<SynthesisResult> {
    const res = await this.client.send(
      new SynthesizeSpeechCommand({
        Text: text,
        OutputFormat: 'pcm',
        VoiceId: this.voice,
        Engine: this.engine,
        SampleRate: String(this.sampleRate),
      }),
    );

    if (!res.AudioStream) {
      throw new Error(`Polly returned no audio for ${JSON.stringify(text.slice(0, 60))}`);
    }

    const pcm = Buffer.from(await res.AudioStream.transformToByteArray());
    if (pcm.length === 0) {
      throw new Error(`Polly returned an empty stream for ${JSON.stringify(text.slice(0, 60))}`);
    }

    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, wrapPcm(pcm, { sampleRate: this.sampleRate }));

    // Measured back off the file, deliberately. See the note at the top.
    let durationMs: number;
    try {
      durationMs = wavInfo(await readFile(outPath)).durationMs;
    } catch (e) {
      throw new UnmeasurableAudioError(outPath, (e as Error).message);
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new UnmeasurableAudioError(outPath, `implausible duration ${durationMs}`);
    }

    return {
      text,
      audioPath: outPath,
      durationMs,
      engine: `polly:${this.engine}`,
      voice: String(this.voice),
      sampleRate: this.sampleRate,
    };
  }
}

/** Whether Polly is reachable with the current credentials. */
export async function pollyAvailable(region?: string): Promise<boolean> {
  try {
    const client = new PollyClient({ region: region ?? process.env.AWS_REGION ?? 'us-east-1' });
    await client.send(
      new SynthesizeSpeechCommand({
        Text: 'ok',
        OutputFormat: 'pcm',
        VoiceId: 'Joanna' as VoiceId,
        Engine: 'neural' as Engine,
        SampleRate: '16000',
      }),
    );
    return true;
  } catch {
    return false;
  }
}
