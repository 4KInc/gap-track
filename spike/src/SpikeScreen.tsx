/**
 * Spike harness screen — D-pad driven, four probes, results on screen.
 *
 * Deliberately ugly. This exists to answer three questions and then be deleted.
 * Nothing here should survive into the product.
 *
 * ── CONFIRM BEFORE RUNNING ────────────────────────────────────────────────
 * The two imports below are the only uncertain part. Amazon's docs show
 * `{ VideoPlayer, KeplerVideoView }` from react-native-w3cmedia, and document
 * an `HTMLAudioElement` class, but the exact export surface differs across
 * SDK versions. Open node_modules/@amazon-devices/react-native-w3cmedia and
 * match the real names, then delete this comment.
 *
 * Reference apps worth reading first:
 *   github.com/AmazonAppDev/vega-audio-sample   <- audio element usage
 *   github.com/AmazonAppDev/vega-video-sample   <- player + focus management
 */

import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

// TODO(confirm): match these against the installed SDK.
import { VideoPlayer, KeplerVideoView } from '@amazon-devices/react-native-w3cmedia';

import { probeClock, formatClockReport } from './probes/clock';
import {
  probeConcurrentAudio,
  probeDucking,
  probeCuePlacement,
  formatAudioReports,
  type HumanVerdict,
  type MediaLike,
} from './probes/audio';

// Local assets. Keep them local — a network fetch would put bandwidth jitter
// inside the very timing you are trying to measure.
const CLIP = require('../assets/clip.mp4');
const CUE = require('../assets/cue-1400ms.wav');

type ProbeKey = 'clock' | 'concurrent' | 'ducking' | 'placement';

export default function SpikeScreen(): JSX.Element {
  const [log, setLog] = useState<string>('Ready. Pick a probe.\n');
  const [busy, setBusy] = useState<ProbeKey | null>(null);
  const [humanVerdict, setHumanVerdict] = useState<HumanVerdict | null>(null);

  const videoRef = useRef<MediaLike | null>(null);
  const cueRef = useRef<MediaLike | null>(null);

  const append = useCallback((s: string) => {
    setLog((prev) => `${prev}\n${s}\n`);
    console.log(s); // also to `vega device shell` — copy/paste beats retyping
  }, []);

  const run = useCallback(
    async (key: ProbeKey) => {
      const video = videoRef.current;
      const cue = cueRef.current;
      if (!video || !cue) {
        append('Media elements not ready. Check the refs and the imports.');
        return;
      }

      setBusy(key);
      try {
        if (key === 'clock') {
          await video.play();
          append('Probe C running — 60s. Do not touch the remote.');
          const r = await probeClock(video, { label: 'VVD or stick — LABEL THIS', durationMs: 60_000 });
          video.pause();
          append(formatClockReport(r));
        }

        if (key === 'concurrent') {
          append('Probe A running — LISTEN. You are the instrument here.');
          const r = await probeConcurrentAudio(video, cue);
          r.humanVerdict = humanVerdict;
          const b = await probeDucking(video, cue);
          append(formatAudioReports(r, b));
        }

        if (key === 'ducking') {
          append('Probe B running — listen for the programme dipping under the cue.');
          const b = await probeDucking(video, cue);
          const a = await probeConcurrentAudio(video, cue);
          a.humanVerdict = humanVerdict;
          append(formatAudioReports(a, b));
        }

        if (key === 'placement') {
          append('Probe A2 running — 10 runs, roughly 40s. Sit still.');
          const a = await probeConcurrentAudio(video, cue);
          a.humanVerdict = humanVerdict;
          const b = await probeDucking(video, cue);
          const c = await probeCuePlacement(video, cue, { runs: 10 });
          append(formatAudioReports(a, b, c));
        }
      } catch (err) {
        append(`THREW: ${String(err)}\n^ this is friction-log material. Copy it verbatim.`);
      } finally {
        setBusy(null);
      }
    },
    [append, humanVerdict],
  );

  const verdicts: HumanVerdict[] = ['heard-both', 'heard-video-only', 'heard-cue-only', 'heard-neither'];

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Gap Track · runtime probes</Text>

      <View style={styles.stage}>
        {/* TODO(confirm): prop names for source and the player handle. */}
        <KeplerVideoView
          style={styles.video}
          player={VideoPlayer}
          source={CLIP}
          ref={(el: unknown) => { videoRef.current = el as MediaLike; }}
        />
        {/* Cue element: no view, audio only. */}
        <VideoPlayer
          source={CUE}
          ref={(el: unknown) => { cueRef.current = el as MediaLike; }}
        />
      </View>

      <Text style={styles.label}>PROBES</Text>
      <View style={styles.row}>
        {(['clock', 'concurrent', 'ducking', 'placement'] as ProbeKey[]).map((k) => (
          <Pressable
            key={k}
            focusable
            onPress={() => run(k)}
            disabled={busy !== null}
            style={({ focused }) => [styles.btn, focused && styles.btnFocused, busy === k && styles.btnBusy]}
          >
            <Text style={styles.btnText}>{busy === k ? `${k}…` : k}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>WHAT YOU HEARD — set this before trusting any result</Text>
      <View style={styles.row}>
        {verdicts.map((v) => (
          <Pressable
            key={v}
            focusable
            onPress={() => setHumanVerdict(v)}
            style={({ focused }) => [
              styles.btn,
              focused && styles.btnFocused,
              humanVerdict === v && styles.btnSelected,
            ]}
          >
            <Text style={styles.btnText}>{v}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.logBox}>
        <Text style={styles.logText}>{log}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0C1113', padding: 32 },
  title: { color: '#E6ECEB', fontSize: 28, fontWeight: '700', marginBottom: 16 },
  stage: { height: 220, marginBottom: 16, backgroundColor: '#000' },
  video: { flex: 1 },
  label: {
    color: '#8B9A9B', fontSize: 12, letterSpacing: 1.4,
    marginTop: 12, marginBottom: 8, textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  btn: {
    paddingVertical: 10, paddingHorizontal: 16,
    backgroundColor: '#141A1C', borderWidth: 2, borderColor: '#253032',
  },
  btnFocused: { borderColor: '#4FBAC1', backgroundColor: '#123338' },
  btnSelected: { borderColor: '#4FBAC1' },
  btnBusy: { opacity: 0.5 },
  btnText: { color: '#E6ECEB', fontSize: 15 },
  logBox: { flex: 1, marginTop: 16, backgroundColor: '#080C0D', padding: 14 },
  logText: { color: '#BFD0CF', fontSize: 13, fontFamily: 'monospace', lineHeight: 19 },
});
