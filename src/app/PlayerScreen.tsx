/**
 * The player.
 *
 * Video on the left of the remote's attention, the accessibility setting
 * where a viewer expects to find it, and an overlay that can be summoned to
 * show the guarantee holding.
 *
 * The setting is deliberately three states rather than a switch. "Off" and
 * "on" would hide the fact that there are two honest ways to deliver a
 * description, and which one is right depends on the content: Adaptive for a
 * film with real silences, Pause-and-Describe for a lecture that has none.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { KeplerVideoSurfaceView } from '@amazon-devices/react-native-w3cmedia';

import { DescriptionPlayer, type CueManifest, type DescriptionMode } from '../player/DescriptionPlayer';
import { DEFAULT_CONFIG, type SchedulerConfig } from '../engine/types';
import { Focusable } from './Focusable';
import { TrustOverlay, type OverlayEvent } from './TrustOverlay';
import { useVegaPlayers } from './useVegaPlayers';
import { useProgrammeClock } from './useProgrammeClock';
import { PreviewSurface, type PreviewStripInfo } from './PreviewSurface';
import { colour, mono, space, type } from './theme';

export interface PlayerScreenProps {
  title: string;
  videoUrl: string;
  /** From the track manifest the pipeline writes. */
  manifest: CueManifest;
  descriptionUrl: string;
  config?: Partial<SchedulerConfig>;
  /** Stills to show where the device cannot decode. Absent on hardware. */
  preview?: PreviewStripInfo;
  onBack?: () => void;
}

/**
 * The playhead advances in 100ms quanta (measured on hardware), so polling
 * faster than that buys nothing but polling much slower would let a cue
 * start late inside its own gap.
 */
const TICK_MS = 50;

const MODES: Array<{ mode: DescriptionMode; label: string }> = [
  { mode: 'off', label: 'Off' },
  { mode: 'adaptive', label: 'Adaptive Description' },
  { mode: 'pause-describe', label: 'Pause and Describe' },
];

export function PlayerScreen({
  title,
  videoUrl,
  manifest,
  descriptionUrl,
  config,
  preview,
  onBack,
}: PlayerScreenProps): React.JSX.Element {
  const players = useVegaPlayers(videoUrl, descriptionUrl);
  const [mode, setMode] = useState<DescriptionMode>('off');
  const [showOverlay, setShowOverlay] = useState(false);
  const clock = useProgrammeClock(players.video);
  const playheadMs = clock.playheadMs;
  const [events, setEvents] = useState<OverlayEvent[]>([]);
  const [speaking, setSpeaking] = useState<string | null>(null);
  /**
   * What the media element believes.
   *
   * Shaka loads asynchronously and a failure never reaches the try/catch
   * that started it, so without this a stream that never loads is
   * indistinguishable from a stream that is merely slow — both show a black
   * rectangle and a frozen clock.
   */


  const engine = useRef<DescriptionPlayer | null>(null);
  const playheadRef = useRef(0);
  playheadRef.current = playheadMs;
  const merged: SchedulerConfig = { ...DEFAULT_CONFIG, ...config };

  // Build the engine once both players exist, and give it the cue list.
  useEffect(() => {
    if (!players.ready || !players.video || !players.description) return;
    const p = new DescriptionPlayer(players.video, players.description, {
      config: merged,
      onDecision: () => {
        // The overlay wants structured decisions, which the engine reports
        // through tick(); this sink only carries the human-readable line, so
        // it is left for the log rather than duplicated on screen.
      },
    });
    p.load(manifest);
    engine.current = p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.ready, manifest]);

  // Start the programme as soon as it is ready. A viewer who pressed Watch
  // has asked for the film; whether anything is narrated over it is a
  // separate choice, and gating playback on that choice leaves them looking
  // at a black rectangle wondering what they did wrong.
  useEffect(() => {
    if (!players.ready || !players.video) return;
    void players.video.play();
  }, [players.ready, players.video]);

  // One loop drives everything. Reading the playhead from the programme
  // rather than a wall clock means a description can never be scheduled
  // against a time the viewer is not actually at.
  useEffect(() => {
    const id = setInterval(() => {
      const p = engine.current;
      const v = players.video;
      if (!p || !v) return;

      // Drive the engine from whichever clock is live. On a device that can
      // decode, that is the programme; where it cannot, wall time, and the
      // UI says which.
      p.tickAt(playheadRef.current);

      const now = p.currentDecisions();
      if (now.length) {
        setEvents((prev) => [...now, ...prev].slice(0, 40));
      }
      setSpeaking(p.speakingText());
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const choose = useCallback((next: DescriptionMode) => {
    setMode(next);
    engine.current?.setMode(next);
    if (next !== 'off') engine.current?.resume();
  }, []);

  if (players.error) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.error}>{players.error}</Text>
        {onBack ? <Focusable label="Back" onPress={onBack} autoFocus /> : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeplerVideoSurfaceView
        style={styles.surface}
        scalingmode="fit"
        onSurfaceViewCreated={players.onSurfaceCreated}
        onSurfaceViewDestroyed={players.onSurfaceDestroyed}
      />

      {preview && clock.source === 'wall' ? (
        <PreviewSurface
          strip={preview}
          playheadMs={playheadMs}
          reason={
            clock.mediaError
              ? 'this device cannot decode video'
              : 'the programme stream is not advancing'
          }
        />
      ) : null}

      <View style={styles.scrim} pointerEvents="none" />

      <View style={styles.chrome}>
        <View style={styles.headRow}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.clock}>{players.ready ? fmt(playheadMs) : 'loading…'}</Text>
        </View>

        <Text style={styles.settingLabel}>AUDIO DESCRIPTION</Text>
        <View style={styles.row}>
          {MODES.map((m, i) => (
            <Focusable
              key={m.mode}
              label={m.label}
              autoFocus={i === 0}
              selected={mode === m.mode}
              disabled={!players.ready}
              onPress={() => choose(m.mode)}
              style={styles.modeButton}
            />
          ))}
        </View>

        <View style={styles.row}>
          <Focusable
            label={showOverlay ? 'Hide admission detail' : 'Show admission detail'}
            compact
            onPress={() => setShowOverlay((v) => !v)}
            style={styles.modeButton}
          />
          {onBack ? <Focusable label="Back" compact onPress={onBack} /> : null}
        </View>

        <Text style={styles.diag}>
          clock={clock.source}
          {clock.durationMs ? ` · ${(clock.durationMs / 1000).toFixed(1)}s` : ''}
          {clock.mediaError ? ` · decode err ${codeOf(clock.mediaError)}` : ''}
        </Text>

        {mode === 'pause-describe' ? (
          <Text style={styles.note}>
            The film pauses for each description, then resumes. Nothing is ever spoken over dialogue.
          </Text>
        ) : null}
      </View>

      {showOverlay ? (
        <TrustOverlay
          playheadMs={playheadMs}
          config={merged}
          events={events}
          speakingText={speaking}
        />
      ) : null}
    </View>
  );
}

/** Just the MediaError code. The GStreamer path behind it is noise. */
const codeOf = (message: string): string => /code=(\d+)/.exec(message)?.[1] ?? '?';

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colour.ground },
  surface: { ...StyleSheet.absoluteFillObject },
  // Sits between the picture and the controls. Without it the chrome is
  // unreadable over a bright frame, which on a television is the same as
  // not being there.
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 420,
    backgroundColor: 'rgba(8, 12, 13, 0.78)',
  },
  chrome: {
    position: 'absolute',
    left: space.safe,
    bottom: space.safe,
    right: space.safe,
  },
  headRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: space.md },
  title: { color: colour.ink, fontSize: type.title, marginRight: space.md },
  clock: { color: colour.inkMuted, fontSize: type.body, fontFamily: mono },
  settingLabel: {
    color: colour.inkMuted,
    fontSize: type.tiny,
    letterSpacing: 2,
    marginBottom: space.xs,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.sm },
  modeButton: { marginRight: space.sm },
  note: { color: colour.inkMuted, fontSize: type.label, marginTop: space.xs },
  diag: { color: colour.inkMuted, fontSize: type.tiny, fontFamily: mono, marginTop: space.sm },
  error: { color: colour.signal, fontSize: type.body, marginVertical: space.md },
});
