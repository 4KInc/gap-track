#!/usr/bin/env bash
# Regenerates the two probe assets. Both are gitignored — this keeps the repo
# lean and the media reproducible.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p src/assets

# Cue: ~1.1s of speech, generated locally. Polly comes later; the probes only
# need a sound of known length.
say -v Samantha -o /tmp/cue.aiff "She folds the letter." 2>/dev/null \
  || say -o /tmp/cue.aiff "She folds the letter."
afconvert -f WAVE -d LEI16@44100 -c 1 /tmp/cue.aiff src/assets/cue.wav
echo "cue.wav  $(afinfo src/assets/cue.wav | awk -F': ' '/estimated duration/{print $2}')"

# Clip: Big Buck Bunny, (CC) Blender Foundation, CC-BY 3.0 — see assets/ATTRIBUTION.md
curl -sS --max-time 120 -o src/assets/clip.mp4 \
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4"
echo "clip.mp4 $(ls -lh src/assets/clip.mp4 | awk '{print $5}')"

echo
echo "NOTE: this clip is 10s with no dialogue. Fine for probes C, A and B."
echo "Drift measurement and real gap detection want ~2min with real speech."
