/**
 * Standing up the two media players this app needs, on Vega.
 *
 * Everything awkward about the platform is concentrated here so the screen
 * above can stay readable. Each of these was learned the hard way and is
 * recorded in FRICTION.md:
 *
 *   `initialize()` must resolve before any other call on a player.
 *
 *   Neither a packaged `file://` asset nor a plain progressive MP4 will
 *   play. Media must be fed through MSE, which in practice means Shaka
 *   against fragmented HLS (entry 5).
 *
 *   `VideoPlayer` renders nothing until it owns a surface, and the surface
 *   arrives independently of the player. Whichever lands second performs the
 *   attach (entry 4).
 *
 *   The description player declares itself an accessibility prompt via the
 *   `AudioPlayer` constructor. Whether that earns it concurrent playback is
 *   the one question the virtual device cannot answer (entry 9), which is
 *   why the screen also offers pause-and-describe.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AudioContentType,
  AudioPlayer,
  AudioUsageType,
  VideoPlayer,
} from '@amazon-devices/react-native-w3cmedia';
import { ShakaPlayer } from '../w3cmedia/shakaplayer/ShakaPlayer';

import type { MediaPort } from '../player/ports';

export interface VegaPlayers {
  video: MediaPort | null;
  description: MediaPort | null;
  ready: boolean;
  error: string | null;
  /** Hand to KeplerVideoSurfaceView's onSurfaceViewCreated. */
  onSurfaceCreated: (handle: string) => void;
  onSurfaceDestroyed: (handle: string) => void;
}

export function useVegaPlayers(videoUrl: string, descriptionUrl: string): VegaPlayers {
  const video = useRef<VideoPlayer | null>(null);
  const description = useRef<AudioPlayer | null>(null);
  const surface = useRef<string | null>(null);
  const attached = useRef(false);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attach = useCallback(() => {
    if (attached.current) return;
    const player = video.current;
    const handle = surface.current;
    if (!player || handle == null) return;
    try {
      player.setSurfaceHandle(handle);
      attached.current = true;
    } catch (err) {
      setError(`surface: ${String(err)}`);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const v = new VideoPlayer();
        await v.initialize();
        new ShakaPlayer(v as never, { secure: false, abrEnabled: false })
          .load({ uri: videoUrl }, false);

        // CONTENT_TYPE_SPEECH / USAGE_ACCESSIBILITY is the platform's own
        // category for an accessibility prompt. Declaring it honestly is
        // right regardless of whether the audio policy rewards it.
        const d = new AudioPlayer(
          AudioContentType.CONTENT_TYPE_SPEECH,
          AudioUsageType.USAGE_ACCESSIBILITY,
        );
        await d.initialize();
        new ShakaPlayer(d as never, { secure: false, abrEnabled: false })
          .load({ uri: descriptionUrl }, false);

        if (cancelled) return;
        video.current = v;
        description.current = d;
        attach();
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();

    return () => {
      cancelled = true;
      try {
        video.current?.deinitialize();
        description.current?.deinitialize();
      } catch {
        // Teardown; a player that is already gone is not a problem.
      }
    };
  }, [videoUrl, descriptionUrl, attach]);

  return {
    video: video.current as MediaPort | null,
    description: description.current as MediaPort | null,
    ready,
    error,
    onSurfaceCreated: useCallback((handle: string) => {
      surface.current = handle;
      attach();
    }, [attach]),
    onSurfaceDestroyed: useCallback((handle: string) => {
      try {
        video.current?.clearSurfaceHandle(handle);
      } catch {
        // Teardown.
      }
      surface.current = null;
      attached.current = false;
    }, []),
  };
}
