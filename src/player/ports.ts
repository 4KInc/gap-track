/**
 * The narrow slice of a media element the player actually needs.
 *
 * Declared here rather than importing Vega's types so the playback logic can
 * be driven by fakes in tests. `VideoPlayer` and `AudioPlayer` from
 * `@amazon-devices/react-native-w3cmedia` both satisfy it structurally.
 *
 * Note the unit: `currentTime` is SECONDS, as the W3C spec requires, while
 * the entire engine works in milliseconds. Every crossing of that boundary
 * goes through the helpers below, because a silent factor-of-1000 error here
 * would place every description a thousand times too early and look, on
 * screen, like the scheduler had simply stopped working.
 */

export interface MediaPort {
  /** Seconds. See the note above. */
  currentTime: number;
  readonly paused: boolean;
  volume: number;
  play(): Promise<void> | void;
  pause(): void;
}

export const toMs = (seconds: number): number => Math.round(seconds * 1000);
export const toSeconds = (ms: number): number => ms / 1000;

/** Somewhere to send decisions: the trust overlay, the log, a test. */
export type DecisionSink = (line: string) => void;
