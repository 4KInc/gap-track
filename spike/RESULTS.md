# Probe results

Fill this in as you go. It feeds two things: the safety margin the engine is
built on, and the friction log that carries up to 10% of the score.

Record the failures in more detail than the successes. Exact error strings,
verbatim. You will not remember the wording on 20 October.

---

## Environment

| | |
|---|---|
| Date | |
| Vega SDK version | |
| React Native version | (expect 0.72) |
| Host | macOS |
| Target | VVD / Fire TV Stick (model:  ) |
| Clip | file, licence, attribution |

---

## Probe C — clock

| Metric | VVD | Stick |
|---|---|---|
| granularity (ms) | **100** | |
| max jitter (ms) | **0** | |
| **suggested margin (ms)** | **250** | |

Measured 9 Oct 2026, SDK 0.24.12044, video driven by Shaka against Apple's
bipbop fMP4 HLS stream. Earlier attempts returned NO MEASUREMENT because the
source was never playing; see FRICTION.md entry 5.

**Verdict:** USABLE. `currentTime` advances in clean 100ms quanta with no
jitter observed over the sampling window. The suggested margin lands on the
250ms floor rather than being driven by measured error, which means the floor
is doing the work — worth re-checking on the stick, where emulated timing
flattery is most likely.

---

## Probe A — concurrent audio

| | VVD | Stick |
|---|---|---|
| video advanced (ms) | | |
| cue advanced (ms) | | |
| machine pass | | |
| **what you actually heard** | | |

**Verdict:** UNANSWERABLE ON THE EMULATOR, and more so than first recorded.
The device has no audio output (entry 9) and cannot decode video at all
(entry 10) — Apple's own reference stream fails identically. An earlier note
here recorded the Shaka path as working; that test checked `readyState >= 1`,
which proves a manifest parsed and nothing more.

 The VVD has no audio device
configured (see FRICTION.md entry 9), so audibility cannot be tested here at
all. Machine-side evidence — whether both players' clocks advance while
overlapping — still indicates whether the platform *permits* two concurrent
audio pipelines, which is most of the question. Audibility needs the stick.

If it failed, write down exactly how it failed — silent but progressing, threw,
stalled the video, distorted. Each one implies a different fix and a different
friction-log entry.

---

## Probe B — ducking

| | VVD | Stick |
|---|---|---|
| volume writable | | |
| requested / observed | | |
| restored cleanly | | |
| duck audible to you | | |

**Verdict:** duck / synthesise louder

---

## Probe A2 — placement, 10 runs

| | VVD | Stick |
|---|---|---|
| start offset p50 (ms) | | |
| start offset p95 (ms) | | |
| start offset max (ms) | | |
| **margin from worst × 1.5** | | |

**Verdict:**

---

## The number that goes into the engine

```
SAFETY_MARGIN_MS = max(probe C suggested, probe A2 from-worst)
                 =
```

Take the stick's numbers over the VVD's wherever they disagree.

---

## Friction log entries earned here

One block per real problem. Six fields, no invention — if a probe passed, there
is no entry, and that is fine.

### Entry 1

- **Task attempted:**
- **Steps taken:**
- **Expected:**
- **Actual:** *(verbatim error or observed behaviour)*
- **Severity:**
- **Workaround:**
- **Suggestion:**
