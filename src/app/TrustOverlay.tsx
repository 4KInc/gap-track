/**
 * The overlay that shows the guarantee holding.
 *
 * This is the one screen that makes the project's claim checkable rather
 * than asserted. It shows the two measured numbers and the comparison
 * between them, so a viewer — or a judge — can see *why* a description was
 * spoken or discarded, instead of being told it was safe.
 *
 * It is deliberately not the default view. A blind viewer wants the film,
 * not telemetry; this is a developer and demonstration surface, reached by a
 * remote action and dismissed the same way.
 *
 * The important moment is a DROP. Anyone can show an AI that talks. Showing
 * one that refuses to, with the arithmetic that refused it, is the thing
 * worth filming.
 */

import React from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Decision, SchedulerConfig } from '../engine/types';
import { colour, mono, radius, space, type } from './theme';

export interface OverlayEvent {
  decision: Decision;
  atMs: number;
}

export interface TrustOverlayProps {
  playheadMs: number;
  config: SchedulerConfig;
  /** Most recent first. */
  events: OverlayEvent[];
  /** What is sounding right now, if anything. */
  speakingText: string | null;
}

const clock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  const cs = String(Math.floor((ms % 1000) / 100));
  return `${m}:${s}.${cs}`;
};

export function TrustOverlay({
  playheadMs,
  config,
  events,
  speakingText,
}: TrustOverlayProps): React.JSX.Element {
  const latest = events[0];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.heading}>Admission</Text>
        <Text style={styles.playhead}>{clock(playheadMs)}</Text>
      </View>

      {latest ? <Verdict event={latest} config={config} /> : (
        <Text style={styles.waiting}>Waiting for the first gap…</Text>
      )}

      {speakingText ? (
        <View style={styles.speaking}>
          <Text style={styles.speakingLabel}>SPEAKING</Text>
          <Text style={styles.speakingText}>“{speakingText}”</Text>
        </View>
      ) : null}

      <Text style={styles.heading}>History</Text>
      <ScrollView style={styles.history}>
        {events.slice(0, 12).map((e, i) => (
          <HistoryRow key={`${e.decision.cue.id}-${e.atMs}-${i}`} event={e} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * The arithmetic, laid out so the comparison is readable as a comparison.
 *
 * Both operands are shown with their labels, because the claim is not "we
 * checked" but "these two measured numbers, compared this way".
 */
function Verdict({ event, config }: { event: OverlayEvent; config: SchedulerConfig }) {
  const { decision } = event;
  const { cue } = decision;
  const play = decision.verdict === 'PLAY';
  const required = cue.audioDurationMs + config.safetyMarginMs;

  return (
    <View style={[styles.verdict, play ? styles.verdictPlay : styles.verdictDrop]}>
      <Text style={styles.cueText}>“{cue.text}”</Text>

      <View style={styles.sumRow}>
        <Operand label="SPEECH" value={`${cue.audioDurationMs}ms`} note="measured" />
        <Text style={styles.operator}>+</Text>
        <Operand label="MARGIN" value={`${config.safetyMarginMs}ms`} note="configured" />
        <Text style={styles.operator}>{play ? '≤' : '>'}</Text>
        <Operand label="SILENCE" value={`${cue.gap.durationMs}ms`} note="measured" />
      </View>

      <Text style={[styles.verdictLine, play ? styles.playText : styles.dropText]}>
        {play
          ? `PLAY · ${required}ms fits, ${decision.headroomMs}ms to spare`
          : decision.reason === 'WOULD_OVERRUN'
            ? `DROP · would run ${decision.overrunMs}ms into the dialogue`
            : `DROP · ${decision.reason.toLowerCase().replace(/_/g, ' ')}`}
      </Text>
    </View>
  );
}

function Operand({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <View style={styles.operand}>
      <Text style={styles.operandLabel}>{label}</Text>
      <Text style={styles.operandValue}>{value}</Text>
      <Text style={styles.operandNote}>{note}</Text>
    </View>
  );
}

function HistoryRow({ event }: { event: OverlayEvent }) {
  const play = event.decision.verdict === 'PLAY';
  return (
    <View style={styles.historyRow}>
      <Text style={styles.historyTime}>{clock(event.atMs)}</Text>
      <Text style={[styles.historyMark, play ? styles.playText : styles.dropText]}>
        {play ? '✓' : '✕'}
      </Text>
      <Text style={styles.historyText} numberOfLines={1}>
        {event.decision.cue.text}
      </Text>
    </View>
  );
}

/**
 * How much horizontal room the overlay takes.
 *
 * Exported because the controls underneath have to yield exactly this much
 * when it is open. A floating panel that covers the buttons is worse than no
 * panel: the safety margin control is the one place a viewer can watch the
 * trade-off happen, and the overlay is what shows them the result.
 *
 * Proportional rather than fixed. The Vega Virtual Device reports a window
 * far narrower than a 1080p television's logical width, and a hard 620 there
 * left the controls a sliver too narrow to use — the margin buttons were
 * reachable by remote but invisible under the panel.
 */
export const OVERLAY_WIDTH = Math.min(
  620,
  Math.round(Dimensions.get('window').width * 0.52),
);

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    right: space.safe,
    top: space.safe,
    bottom: space.safe,
    width: OVERLAY_WIDTH,
    backgroundColor: colour.scrim,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.line,
    padding: space.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: space.sm,
  },
  heading: {
    color: colour.inkMuted,
    fontSize: type.tiny,
    letterSpacing: 2,
    marginTop: space.sm,
    marginBottom: space.xs,
  },
  playhead: { color: colour.ink, fontSize: type.body, fontFamily: mono },
  waiting: { color: colour.inkMuted, fontSize: type.label, paddingVertical: space.md },

  verdict: {
    borderLeftWidth: 4,
    paddingLeft: space.sm,
    paddingVertical: space.sm,
    backgroundColor: colour.surface,
    borderRadius: radius.sm,
  },
  verdictPlay: { borderLeftColor: colour.accent },
  verdictDrop: { borderLeftColor: colour.signal },

  cueText: { color: colour.ink, fontSize: type.body, marginBottom: space.sm },

  sumRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm },
  operand: { marginRight: space.xs },
  operandLabel: { color: colour.inkMuted, fontSize: 11, letterSpacing: 1 },
  operandValue: { color: colour.ink, fontSize: type.label, fontFamily: mono },
  operandNote: { color: colour.inkMuted, fontSize: 11, fontStyle: 'italic' },
  operator: {
    color: colour.inkMuted,
    fontSize: type.body,
    fontFamily: mono,
    marginHorizontal: space.xs,
  },

  verdictLine: { fontSize: type.label, fontFamily: mono },
  playText: { color: colour.accent },
  dropText: { color: colour.signal },

  speaking: {
    marginTop: space.sm,
    padding: space.sm,
    backgroundColor: colour.accentSoft,
    borderRadius: radius.sm,
  },
  speakingLabel: { color: colour.accent, fontSize: 11, letterSpacing: 2 },
  speakingText: { color: colour.ink, fontSize: type.label },

  history: { flex: 1 },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  historyTime: {
    color: colour.inkMuted,
    fontSize: type.tiny,
    fontFamily: mono,
    width: 86,
  },
  historyMark: { fontSize: type.tiny, width: 24 },
  historyText: { color: colour.inkMuted, fontSize: type.tiny, flex: 1 },
});
