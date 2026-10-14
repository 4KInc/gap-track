/**
 * Showing the film where the device cannot decode it.
 *
 * The virtual device parses a manifest, reports a duration, accepts play(),
 * and then fails in the decoder — for Amazon's own reference stream as much
 * as ours (FRICTION.md entry 10). An app running there shows black.
 *
 * So when decode fails, this takes over: a strip of stills from the
 * pipeline, advanced by the playhead. The viewer sees the film.
 *
 * The notice is not optional and not dismissible. A sequence of stills shown
 * without saying so would be a claim that the device played video, which it
 * did not. Anyone watching a recording of this screen can read what they are
 * actually looking at.
 */

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colour, mono, radius, space, type } from './theme';

export interface PreviewStripInfo {
  /** Base URL the frames sit under, with a trailing slash. */
  baseUrl: string;
  fps: number;
  count: number;
  frames: string[];
}

export interface PreviewSurfaceProps {
  strip: PreviewStripInfo;
  playheadMs: number;
  /** Why the real stream is not being shown. Rendered verbatim. */
  reason: string;
}

/** Milliseconds to the frame covering it. */
export function frameIndexFor(playheadMs: number, fps: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor((playheadMs / 1000) * fps)));
}

export function PreviewSurface({
  strip,
  playheadMs,
  reason,
}: PreviewSurfaceProps): React.JSX.Element {
  const i = frameIndexFor(playheadMs, strip.fps, strip.count);
  const name = strip.frames[i];

  return (
    <View style={styles.root}>
      {name ? (
        <Image
          style={styles.frame}
          resizeMode="contain"
          source={{ uri: `${strip.baseUrl}${name}` }}
        />
      ) : (
        <View style={styles.frame} />
      )}

      <View style={styles.notice}>
        <Text style={styles.noticeText}>PREVIEW FRAMES · {reason}</Text>
        <Text style={styles.noticeDetail}>
          {strip.fps} fps stills · frame {i + 1} of {strip.count}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  frame: { ...StyleSheet.absoluteFillObject },
  notice: {
    position: 'absolute',
    top: space.safe,
    left: space.safe,
    backgroundColor: colour.scrim,
    borderLeftWidth: 3,
    borderLeftColor: colour.signal,
    borderRadius: radius.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
  },
  noticeText: { color: colour.signal, fontSize: type.tiny, letterSpacing: 1.5 },
  noticeDetail: { color: colour.inkMuted, fontSize: type.tiny, fontFamily: mono },
});
