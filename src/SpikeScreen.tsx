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
import {
  View, Text, Pressable, ScrollView, StyleSheet, Image, findNodeHandle,
} from 'react-native';
import { FocusManager } from '@amazon-devices/react-native-kepler';

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
// timing being measured. Resolved through Metro rather than hardcoded, so the
// URI is whatever the packager actually produced.
const CLIP_SRC = Image.resolveAssetSource(require('./assets/clip.mp4')).uri;
const CUE_SRC = Image.resolveAssetSource(require('./assets/cue.wav')).uri;

type ProbeKey = 'clock' | 'usage' | 'ducking' | 'placement';

export default function SpikeScreen(): React.JSX.Element {
  const [log, setLog] = useState('Initialising players…');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<ProbeKey | null>(null);
  const [humanVerdict, setHumanVerdict] = useState<HumanVerdict | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [status, setStatus] = useState('initialising…');
  const [lastEvent, setLastEvent] = useState('—');
  const firstBtn = useRef<View | null>(null);

  const video = useRef<VideoPlayer | null>(null);
  // The surface and the player arrive independently and in either order, so
  // neither can assume the other exists. Park the handle and attach when both
  // are present — whichever lands second does the work.
  const surfaceHandle = useRef<string | null>(null);
  const surfaceAttached = useRef(false);
  const cueAccessibility = useRef<AudioPlayer | null>(null);
  const cueMedia = useRef<AudioPlayer | null>(null);

  // Newest first. The log pane is short on a 10-foot layout and nothing
  // auto-scrolls, so appending to the bottom hides every result below the fold.
  const append = useCallback((s: string) => {
    setLastEvent(s.split('\n')[0]);
    setLog((prev) => `${s}\n\n${prev}`);
    console.log(s); // also reaches `vega device shell` — copy/paste beats retyping
  }, []);

  // A play() that resolves is not proof anything is decoding. Dump what the
  // player actually believes, so a dead clock can be told apart from a dead
  // decoder or a source that never loaded.
  const dumpMedia = useCallback((tag: string, m: unknown) => {
    const p = m as Partial<{
      src: string; currentTime: number; duration: number;
      paused: boolean; volume: number; readyState: number;
      error: { code?: number; message?: string } | null;
    }>;
    const CODES: Record<number, string> = {
      1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED',
    };
    const e = p?.error;
    const err = e
      ? `code=${e.code} (${CODES[e.code ?? -1] ?? '?'}) msg="${e.message ?? ''}"`
      : 'none';
    const READY: Record<number, string> = {
      0: 'HAVE_NOTHING', 1: 'HAVE_METADATA', 2: 'HAVE_CURRENT_DATA',
      3: 'HAVE_FUTURE_DATA', 4: 'HAVE_ENOUGH_DATA',
    };
    append(
      `${tag}: ${String(p?.src).split('/').pop()}\n`
      + `  currentTime=${p?.currentTime} duration=${p?.duration} paused=${p?.paused}\n`
      + `  readyState=${p?.readyState} (${READY[p?.readyState ?? -1] ?? '?'})\n`
      + `  error: ${err}`,
    );
  }, [append]);

  // readyState >= 1 (HAVE_METADATA) is the first point at which duration is
  // real and the clock can be expected to move.
  const awaitMetadata = useCallback(async (m: unknown, tag: string, timeoutMs = 6000) => {
    const p = m as { readyState: number; error: { code?: number } | null };
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (p.error) { append(`${tag}: errored while loading after ${Date.now() - t0}ms`); return false; }
      if (p.readyState >= 1) { append(`${tag}: metadata in ${Date.now() - t0}ms`); return true; }
      await new Promise<void>((r) => { setTimeout(() => r(), 50); });
    }
    append(`${tag}: TIMEOUT — still readyState=${p.readyState} after ${timeoutMs}ms`);
    return false;
  }, [append]);

  const attachSurface = useCallback(() => {
    if (surfaceAttached.current) return;
    const player = video.current;
    const handle = surfaceHandle.current;
    if (!player || handle == null) return;
    try {
      player.setSurfaceHandle(handle);
      surfaceAttached.current = true;
      append(`surface attached (${handle})`);
    } catch (err) {
      append(`setSurfaceHandle THREW: ${String(err)}`);
    }
  }, [append]);

  // Vega does not auto-focus anything. Without seeding focus the D-pad has no
  // target and no press ever reaches a handler — which looks exactly like
  // "the buttons do nothing".
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const tag = firstBtn.current ? findNodeHandle(firstBtn.current) : null;
        if (tag != null) {
          FocusManager.focus(tag);
          setStatus((st) => (st === 'initialising…' ? 'focus seeded · initialising…' : st));
        } else {
          setStatus('focus seed failed: no native tag for the first button');
        }
      } catch (err) {
        setStatus(`focus seed failed: ${String(err)}`);
      }
    }, 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const v = new VideoPlayer();
        await v.initialize();
        v.src = CLIP_SRC;
        v.load(); // setting src alone does not begin the resource selection

        // The cue element under test, declared as an accessibility prompt.
        const a = new AudioPlayer(
          AudioContentType.CONTENT_TYPE_SPEECH,
          AudioUsageType.USAGE_ACCESSIBILITY,
        );
        await a.initialize();
        a.src = CUE_SRC;
        a.load();

        // Control: same audio, declared as ordinary media. If this one is
        // refused and the accessibility one is not, the attribute is the answer.
        const m = new AudioPlayer(
          AudioContentType.CONTENT_TYPE_SPEECH,
          AudioUsageType.USAGE_MEDIA,
        );
        await m.initialize();
        m.src = CUE_SRC;
        m.load();

        if (cancelled) return;
        video.current = v;
        cueAccessibility.current = a;
        cueMedia.current = m;
        setReady(true);
        setStatus('players ready');
        attachSurface(); // the surface may already be waiting
        append('Players initialised. Video + two cue players (accessibility, media).');
        append(`clip uri: ${CLIP_SRC}`);
        append(`cue  uri: ${CUE_SRC}`);
      } catch (err) {
        setStatus(`INIT FAILED — ${String(err)}`);
        append(`INIT THREW: ${String(err)}\n^ friction log material. Copy it verbatim.`);
      }
    })();

    return () => {
      cancelled = true;
      video.current?.deinitialize?.();
      cueAccessibility.current?.deinitialize?.();
      cueMedia.current?.deinitialize?.();
    };
  }, [append, attachSurface]);

  const run = useCallback(
    async (key: ProbeKey) => {
      const v = video.current as MediaLike | null;
      const cueA = cueAccessibility.current as MediaLike | null;
      const cueM = cueMedia.current as MediaLike | null;
      append(`▶ ${key} pressed`); // proves focus and press routing work
      if (!v || !cueA || !cueM) {
        append('…but players are not initialised. See the status line above.');
        return;
      }

      setBusy(key);
      try {
        if (key === 'clock') {
          dumpMedia('before load wait', v);
          await awaitMetadata(v, 'video');
          dumpMedia('after metadata wait', v);
          await v.play();
          await new Promise<void>((resolve) => { setTimeout(() => resolve(), 700); });
          dumpMedia('700ms after play()', v);
          append('Probe C — 9s (clip is 10s). Do not touch the remote.');
          const r = await probeClock(v, { label: 'LABEL THIS: VVD or stick', durationMs: 9_000 });
          dumpMedia('after probe', v);
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
    [append, awaitMetadata, dumpMedia, humanVerdict],
  );

  const verdicts: HumanVerdict[] = ['heard-both', 'heard-video-only', 'heard-cue-only', 'heard-neither'];

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Gap Track · runtime probes</Text>

      <KeplerVideoSurfaceView
        style={styles.video}
        scalingmode="fit"
        onSurfaceViewCreated={(handle: string) => {
          surfaceHandle.current = handle;
          attachSurface(); // the player may already be waiting
        }}
        onSurfaceViewDestroyed={(handle: string) => {
          try {
            video.current?.clearSurfaceHandle(handle);
          } catch {
            // teardown; nothing useful to do if the player is already gone
          }
          surfaceHandle.current = null;
          surfaceAttached.current = false;
        }}
      />

      <Text style={[styles.status, !ready && styles.statusBad]}>{status}</Text>
      <Text style={styles.lastEvent} numberOfLines={1}>last: {lastEvent}</Text>
      <Text style={styles.label}>Probes</Text>
      <View style={styles.row}>
        {(['clock', 'usage', 'ducking', 'placement'] as ProbeKey[]).map((k) => (
          <Pressable
            key={k}
            focusable
            onPress={() => run(k)}
            onFocus={() => setFocusedKey(k)}
            onBlur={() => setFocusedKey(null)}
            ref={k === 'clock' ? firstBtn : undefined}
            disabled={busy !== null}
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
  root: { flex: 1, backgroundColor: '#0C1113', padding: 20 },
  title: { color: '#E6ECEB', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  video: { height: 90, marginBottom: 8, backgroundColor: '#000' },
  status: { color: '#4FBAC1', fontSize: 13, marginBottom: 2 },
  lastEvent: { color: '#E6ECEB', fontSize: 13, fontFamily: 'monospace' },
  statusBad: { color: '#D99A3E' },
  label: {
    color: '#8B9A9B', fontSize: 11, letterSpacing: 1.2,
    marginTop: 8, marginBottom: 5, textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  btn: {
    paddingVertical: 7, paddingHorizontal: 13,
    backgroundColor: '#141A1C', borderWidth: 2, borderColor: '#253032',
  },
  btnFocused: { borderColor: '#4FBAC1', backgroundColor: '#123338' },
  btnSelected: { borderColor: '#4FBAC1' },
  btnDim: { opacity: 0.4 },
  btnText: { color: '#E6ECEB', fontSize: 15 },
  logBox: { flex: 1, marginTop: 10, backgroundColor: '#080C0D', padding: 10 },
  logText: { color: '#BFD0CF', fontSize: 12, fontFamily: 'monospace', lineHeight: 17 },
});
