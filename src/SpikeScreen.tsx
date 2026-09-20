/**
 * Spike harness — written against the real SDK surface, not a guess.
 *
 * Verified from node_modules/@amazon-devices/react-native-w3cmedia@2.3.2:
 *
 *   new AudioPlayer(audioType?: AudioContentType, audioUsage?: AudioUsageType)
 *   new VideoPlayer()
 *   await player.initialize()        <- MUST complete before any other call
 *   player.src / currentTime / volume / paused / play() / pause()
 *   VideoPlayer renders nothing by itself; it needs a surface handle from
 *   KeplerVideoSurfaceView's onSurfaceViewCreated event.
 *
 * THE EXPERIMENT THAT MATTERS
 * The SDK exposes USAGE_ACCESSIBILITY and CONTENT_TYPE_SPEECH as audio
 * attributes. On an attribute-driven audio policy those tell the platform this
 * stream is an accessibility prompt — which is normally what earns concurrent
 * playback alongside media, and often automatic ducking of the media stream.
 *
 * So the first question is no longer "can two streams play at once" but
 * "does declaring the right usage make the platform do it for us". Probe A
 * runs the same test twice, once as USAGE_MEDIA and once as
 * USAGE_ACCESSIBILITY, and compares. If accessibility wins, manual ducking
 * (Probe B) may be unnecessary — and the product becomes more device-native,
 * not less.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

import {
  AudioPlayer,
  VideoPlayer,
  AudioContentType,
  AudioUsageType,
  KeplerVideoSurfaceView,
} from '@amazon-devices/react-native-w3cmedia';

import { probeClock, formatClockReport } from './probes/clock';
import {
  probeConcurrentAudio,
  probeDucking,
  probeCuePlacement,
  formatAudioReports,
  type HumanVerdict,
  type MediaLike,
} from './probes/audio';

// Local files only. A network fetch would put bandwidth jitter inside the very
// timing being measured. See spike/README.md for what to drop in.
const CLIP_SRC = 'file:///pkg/assets/clip.mp4';
const CUE_SRC = 'file:///pkg/assets/cue-1400ms.wav';

type ProbeKey = 'clock' | 'usage' | 'ducking' | 'placement';

export default function SpikeScreen(): React.JSX.Element {
  const [log, setLog] = useState('Initialising players…\n');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<ProbeKey | null>(null);
  const [humanVerdict, setHumanVerdict] = useState<HumanVerdict | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const video = useRef<VideoPlayer | null>(null);
  const cueAccessibility = useRef<AudioPlayer | null>(null);
  const cueMedia = useRef<AudioPlayer | null>(null);

  const append = useCallback((s: string) => {
    setLog((prev) => `${prev}\n${s}\n`);
    console.log(s); // also reaches `vega device shell` — copy/paste beats retyping
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const v = new VideoPlayer();
        await v.initialize();
        v.src = CLIP_SRC;

        // The cue element under test, declared as an accessibility prompt.
        const a = new AudioPlayer(
          AudioContentType.CONTENT_TYPE_SPEECH,
          AudioUsageType.USAGE_ACCESSIBILITY,
        );
        await a.initialize();
        a.src = CUE_SRC;

        // Control: same audio, declared as ordinary media. If this one is
        // refused and the accessibility one is not, the attribute is the answer.
        const m = new AudioPlayer(
          AudioContentType.CONTENT_TYPE_SPEECH,
          AudioUsageType.USAGE_MEDIA,
        );
        await m.initialize();
        m.src = CUE_SRC;

        if (cancelled) return;
        video.current = v;
        cueAccessibility.current = a;
        cueMedia.current = m;
        setReady(true);
        append('Players initialised. Video + two cue players (accessibility, media).');
      } catch (err) {
        append(`INIT THREW: ${String(err)}\n^ friction log entry 2. Copy it verbatim.`);
      }
    })();

    return () => {
      cancelled = true;
      video.current?.deinitialize?.();
      cueAccessibility.current?.deinitialize?.();
      cueMedia.current?.deinitialize?.();
    };
  }, [append]);

  const run = useCallback(
    async (key: ProbeKey) => {
      const v = video.current as MediaLike | null;
      const cueA = cueAccessibility.current as MediaLike | null;
      const cueM = cueMedia.current as MediaLike | null;
      if (!v || !cueA || !cueM) {
        append('Players not ready.');
        return;
      }

      setBusy(key);
      try {
        if (key === 'clock') {
          await v.play();
          append('Probe C — 60s. Do not touch the remote.');
          const r = await probeClock(v, { label: 'LABEL THIS: VVD or stick', durationMs: 60_000 });
          v.pause();
          append(formatClockReport(r));
        }

        if (key === 'usage') {
          append('Probe A — the one that matters. LISTEN to both runs.');

          append('\n[1/2] cue declared USAGE_MEDIA (control)');
          const asMedia = await probeConcurrentAudio(v, cueM, { label: 'USAGE_MEDIA' });
          append(`  video ${asMedia.videoAdvancedMs.toFixed(0)}ms · cue ${asMedia.cueAdvancedMs.toFixed(0)}ms · ${asMedia.machinePass ? 'PASS' : 'FAIL'}`);

          append('\n[2/2] cue declared USAGE_ACCESSIBILITY');
          const asA11y = await probeConcurrentAudio(v, cueA, { label: 'USAGE_ACCESSIBILITY' });
          asA11y.humanVerdict = humanVerdict;
          append(`  video ${asA11y.videoAdvancedMs.toFixed(0)}ms · cue ${asA11y.cueAdvancedMs.toFixed(0)}ms · ${asA11y.machinePass ? 'PASS' : 'FAIL'}`);

          append(
            '\nCOMPARISON\n'
            + (asA11y.machinePass && !asMedia.machinePass
              ? '  The usage attribute is the unlock. Declare cues USAGE_ACCESSIBILITY\n'
                + '  and let the platform arbitrate. Document this — most entrants will\n'
                + '  hand-roll mixing and never find it.'
              : asA11y.machinePass && asMedia.machinePass
                ? '  Both concurrent. Attribute is not load-bearing for playback, but keep\n'
                  + '  USAGE_ACCESSIBILITY anyway — it is the honest declaration and may\n'
                  + '  still drive system ducking.'
                : '  Neither concurrent. Pause-and-Describe becomes the primary mode.\n'
                  + '  Planned branch, not a setback. Write the friction log now.'),
          );
        }

        if (key === 'ducking') {
          append('Probe B — did the programme dip under the cue, and did anything duck by itself?');
          const b = await probeDucking(v, cueA);
          const a = await probeConcurrentAudio(v, cueA, { label: 'USAGE_ACCESSIBILITY' });
          a.humanVerdict = humanVerdict;
          append(formatAudioReports(a, b));
        }

        if (key === 'placement') {
          append('Probe A2 — 10 runs, roughly 40s. Sit still.');
          const a = await probeConcurrentAudio(v, cueA, { label: 'USAGE_ACCESSIBILITY' });
          a.humanVerdict = humanVerdict;
          const b = await probeDucking(v, cueA);
          const c = await probeCuePlacement(v, cueA, { runs: 10 });
          append(formatAudioReports(a, b, c));
        }
      } catch (err) {
        append(`THREW: ${String(err)}\n^ friction log material. Copy it verbatim.`);
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

      <KeplerVideoSurfaceView
        style={styles.video}
        onSurfaceViewCreated={(handle: unknown) => {
          // VideoPlayer renders nothing until it owns a surface.
          (video.current as unknown as { setSurfaceHandle?: (h: unknown) => void })
            ?.setSurfaceHandle?.(handle);
        }}
      />

      <Text style={styles.label}>Probes {ready ? '' : '· initialising'}</Text>
      <View style={styles.row}>
        {(['clock', 'usage', 'ducking', 'placement'] as ProbeKey[]).map((k) => (
          <Pressable
            key={k}
            focusable
            onPress={() => run(k)}
            onFocus={() => setFocusedKey(k)}
            onBlur={() => setFocusedKey(null)}
            disabled={busy !== null || !ready}
            style={[
              styles.btn,
              focusedKey === k && styles.btnFocused,
              (busy === k || !ready) && styles.btnDim,
            ]}
          >
            <Text style={styles.btnText}>{busy === k ? `${k}…` : k}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>What you heard — the probes cannot, so set this</Text>
      <View style={styles.row}>
        {verdicts.map((v) => (
          <Pressable
            key={v}
            focusable
            onPress={() => setHumanVerdict(v)}
            onFocus={() => setFocusedKey(v)}
            onBlur={() => setFocusedKey(null)}
            style={[
              styles.btn,
              focusedKey === v && styles.btnFocused,
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
  video: { height: 200, marginBottom: 16, backgroundColor: '#000' },
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
  btnDim: { opacity: 0.4 },
  btnText: { color: '#E6ECEB', fontSize: 15 },
  logBox: { flex: 1, marginTop: 16, backgroundColor: '#080C0D', padding: 14 },
  logText: { color: '#BFD0CF', fontSize: 13, fontFamily: 'monospace', lineHeight: 19 },
});
