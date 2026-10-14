/**
 * Where the playhead comes from.
 *
 * Normally the programme is the clock: reading time from the media element
 * guarantees a description is never scheduled against a moment the viewer is
 * not at. That is the right source and the default.
 *
 * But a device that cannot decode never advances `currentTime`, so there is
 * no clock at all — the film is frozen at zero and nothing is ever due. On
 * the virtual device that is every device (FRICTION.md entry 10).
 *
 * So when the media clock is dead this falls back to wall time. Every cue,
 * gap, duration and admission decision stays exactly as real as before; the
 * only substitution is where "now" comes from, and the UI says so.
 *
 * The fallback is detected, never assumed. A media clock that is merely slow
 * to start must not be replaced, or the engine would schedule against a time
 * the device is about to disagree with.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { MediaPort } from '../player/ports';
import { toMs } from '../player/ports';

export type ClockSource = 'programme' | 'wall';

export interface ProgrammeClock {
  playheadMs: number;
  source: ClockSource;
  /** Populated when the media element reported a decode failure. */
  mediaError: string | null;
  /** Programme duration if known; the media element reports it even when it cannot decode. */
  durationMs: number;
}

interface Probe {
  currentTime: number;
  readyState?: number;
  duration?: number;
  error?: { code?: number; message?: string } | null;
}

/**
 * @param stallMs how long a non-advancing clock is tolerated before the
 *   fallback engages. Long enough to outlast ordinary buffering.
 */
export function useProgrammeClock(
  video: MediaPort | null,
  tickMs = 50,
  stallMs = 2_500,
): ProgrammeClock {
  const [state, setState] = useState<ProgrammeClock>({
    playheadMs: 0,
    source: 'programme',
    mediaError: null,
    durationMs: 0,
  });

  const lastMediaMs = useRef(0);
  const stalledSince = useRef<number | null>(null);
  const wallBase = useRef<number | null>(null);

  const reset = useCallback(() => {
    lastMediaMs.current = 0;
    stalledSince.current = null;
    wallBase.current = null;
  }, []);

  useEffect(() => {
    if (!video) return undefined;
    reset();

    const id = setInterval(() => {
      const p = video as unknown as Probe;
      const mediaMs = toMs(p.currentTime);
      const durationMs = Number.isFinite(p.duration) ? Math.round((p.duration ?? 0) * 1000) : 0;
      const err = p.error
        ? `code=${p.error.code} ${(p.error.message ?? '').slice(0, 80)}`
        : null;

      const advancing = mediaMs > lastMediaMs.current;
      if (advancing) {
        // The programme is the clock again. Drop any fallback outright so a
        // stream that recovers is not left running on wall time.
        lastMediaMs.current = mediaMs;
        stalledSince.current = null;
        wallBase.current = null;
        setState({ playheadMs: mediaMs, source: 'programme', mediaError: err, durationMs });
        return;
      }

      // Not advancing. Decide whether that is a stall worth replacing.
      const now = Date.now();
      if (stalledSince.current === null) stalledSince.current = now;

      // A reported decode failure is immediate grounds; otherwise wait, in
      // case it is only buffering.
      const decodeFailed = Boolean(p.error);
      const stalledLongEnough = now - stalledSince.current > stallMs;

      if (!decodeFailed && !stalledLongEnough) {
        setState((s) => ({ ...s, playheadMs: mediaMs, mediaError: err, durationMs }));
        return;
      }

      if (wallBase.current === null) wallBase.current = now - mediaMs;
      const wallMs = now - wallBase.current;
      const bounded = durationMs > 0 ? Math.min(wallMs, durationMs) : wallMs;

      setState({ playheadMs: bounded, source: 'wall', mediaError: err, durationMs });
    }, tickMs);

    return () => clearInterval(id);
  }, [video, tickMs, stallMs, reset]);

  return state;
}
