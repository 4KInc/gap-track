/**
 * Synthesis, behind an interface.
 *
 * Two implementations are expected: macOS `say` for local development, and
 * Amazon Polly for the real pipeline. The engine must not care which, and
 * neither must the tests.
 *
 * The contract that matters is the last line of `synthesize`: whatever
 * produced the audio, the duration returned is MEASURED FROM THE RENDERED
 * FILE. Not the provider's estimate, not a words-per-minute calculation, not
 * a model's guess at how long it takes to say. The safety guarantee compares
 * that number against a measured gap, and a guarantee built on an estimate is
 * not a guarantee.
 */

export interface SynthesisResult {
  text: string;
  /** Where the rendered audio landed. */
  audioPath: string;
  /** Measured from the file itself. See the note above. */
  durationMs: number;
  /** Which implementation produced this, for the provenance record. */
  engine: string;
  voice: string;
  sampleRate: number;
}

export interface Synthesizer {
  readonly name: string;
  /** Rendered format, so the packager knows what it is assembling. */
  readonly sampleRate: number;

  /**
   * Render `text` to `outPath` and measure what came out.
   *
   * Implementations must reject rather than return a result they could not
   * measure. Returning a zero or guessed duration would let a cue through
   * admission on a number nobody checked.
   */
  synthesize(text: string, outPath: string): Promise<SynthesisResult>;
}

/**
 * Thrown when audio was produced but could not be measured. Separate from a
 * synthesis failure because it needs a different fix: the audio exists, the
 * measurement path is broken, and silently trusting an estimate instead is
 * exactly the wrong recovery.
 */
export class UnmeasurableAudioError extends Error {
  constructor(path: string, cause: string) {
    super(`synthesised audio at ${path} could not be measured: ${cause}`);
    this.name = 'UnmeasurableAudioError';
  }
}
