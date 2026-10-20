#!/usr/bin/env bash
# Fetch the demo source material.
#
# The film and its captions are CC-BY and large, so they are not in the repo.
# They used to live in /tmp, which a reboot clears — discovered mid-demo.
# Everything the verifiers and the demo script need now lands in build/demo/,
# which is gitignored but survives.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p build/demo

if [ ! -f build/demo/sintel_en.srt ]; then
  echo "fetching captions…"
  curl -fsSL --max-time 120 \
    -o build/demo/sintel_en.srt \
    "https://durian.blender.org/wp-content/content/subtitles/sintel_en.srt"
fi

if [ ! -f build/demo/sintel.mp4 ]; then
  echo "fetching Sintel (101MB)…"
  curl -fL --max-time 1800 \
    -o build/demo/sintel.mp4 \
    "https://archive.org/download/Sintel/sintel-2048-surround_512kb.mp4"
fi

echo
ls -lh build/demo/ | tail -n +2 | awk '{printf "  %-26s %s\n", $9, $5}'
echo
echo "verify with:"
echo "  npx tsx scripts/verify-track.ts"
echo "  npx tsx scripts/verify-no-overlap.ts"
