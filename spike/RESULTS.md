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
| granularity (ms) | | |
| effective rate (Hz) | | |
| update interval p50 / p95 / max | | |
| total drift (ms over 60s) | | |
| max jitter (ms) | | |
| **suggested margin (ms)** | | |

**Verdict:**

---

## Probe A — concurrent audio

| | VVD | Stick |
|---|---|---|
| video advanced (ms) | | |
| cue advanced (ms) | | |
| machine pass | | |
| **what you actually heard** | | |

**Verdict:** Adaptive Description viable / Pause-and-Describe becomes primary

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
