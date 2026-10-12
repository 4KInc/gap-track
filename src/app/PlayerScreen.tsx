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
import { toMs } from '../player/ports';
import { Focusable } from './Focusable';
import { TrustOverlay, type OverlayEvent } from './TrustOverlay';
import { useVegaPlayers } from './useVegaPlayers';
import { colour, mono, space, type } from './theme';

export interface PlayerScreenProps {
  title: string;
  videoUrl: string;
  /** From the track manifest the pipeline writes. */
  manifest: CueManifest;
  descriptionUrl: string;
  config?: Partial<SchedulerConfig>;
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
  onBack,
}: PlayerScreenProps): React.JSX.Element {
  const players = useVegaPlayers(videoUrl, descriptionUrl);
  const [mode, setMode] = useState<DescriptionMode>('off');
  const [showOverlay, setShowOverlay] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [events, setEvents] = useState<OverlayEvent[]>([]);
  const [speaking, setSpeaking] = useState<string | null>(null);

  const engine = useRef<DescriptionPlayer | null>(null);
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

  // One loop drives everything. Reading the playhead from the programme
  // rather than a wall clock means a description can never be scheduled
  // against a time the viewer is not actually at.
  useEffect(() => {
    const id = setInterval(() => {
      const p = engine.current;
      const v = players.video;
      if (!p || !v) return;

      p.tick();
      setPlayheadMs(toMs(v.currentTime));

      const now = p.currentDecisions();
      if (now.length) {
        setEvents((prev) => [...now, ...prev].slice(0, 40));
      }
      setSpeaking(p.speakingText());
    }, TICK_MS);
    return () => clearInterval(id);
  }, [players.video]);

  const choose = useCallback((next: DescriptionMode) => {
    setMode(next);
    engine.current?.setMode(next);
    if (next !== 'off') {
      void players.video?.play();
      engine.current?.resume();
    }
  }, [players.video]);

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

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colour.ground },
  surface: { ...StyleSheet.absoluteFillObject },
  chrome: {
    position: 'absolute',
    left: space.safe,
    bottom: space.safe,
    right: space.safe,
  },
  headRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: space.md },
  title: { color: colour.ink, fontSize: type.display, marginRight: space.md },
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
  error: { color: colour.signal, fontSize: type.body, marginVertical: space.md },
});
