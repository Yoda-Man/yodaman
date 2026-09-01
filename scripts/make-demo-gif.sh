#!/usr/bin/env bash
#
# Build the README demo GIF from the captured screenshots.
#
# WHY A SCRIPT: the same reason as capture-screenshots.js. A GIF assembled by
# hand once is a GIF that shows a four-release-old UI a year from now. This runs
# straight after `npm run screenshots`, from the same frames, so the GIF cannot
# drift from the stills beside it.
#
# Two-pass palette generation, not a single pass: GIF is limited to 256 colours,
# and ffmpeg's default quantiser applied to a dark UI turns the gradients into
# visible banding. Generating a palette from the actual frames first keeps the
# background readable.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$DIR/website/assets/screenshots"
OUT="$SRC/demo.gif"
WIDTH=900
SECONDS_PER_FRAME=2.5

# Order tells a story: what the product knows, how it is structured, where the
# gaps are. Stardust last, because the drift count is the point.
FRAMES=(dashboard.png graph.png plugins.png stardust.png)

for f in "${FRAMES[@]}"; do
  [ -f "$SRC/$f" ] || { echo "Missing $SRC/$f — run 'npm run screenshots' first." >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

i=0
for f in "${FRAMES[@]}"; do
  cp "$SRC/$f" "$(printf '%s/frame%03d.png' "$WORK" "$i")"
  i=$((i + 1))
done

FPS="$(awk "BEGIN {printf \"%.4f\", 1 / $SECONDS_PER_FRAME}")"

ffmpeg -loglevel error -y -framerate "$FPS" -i "$WORK/frame%03d.png" \
  -vf "scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" "$WORK/palette.png"

ffmpeg -loglevel error -y -framerate "$FPS" -i "$WORK/frame%03d.png" -i "$WORK/palette.png" \
  -lavfi "scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"

SIZE_KB=$(( $(wc -c < "$OUT") / 1024 ))
echo "  demo.gif  ${SIZE_KB}KB  (${#FRAMES[@]} frames, ${SECONDS_PER_FRAME}s each, ${WIDTH}px wide)"

# GitHub will render almost anything, but a README that takes a long time to
# load on a phone is a README people close.
if [ "$SIZE_KB" -gt 8000 ]; then
  echo "  WARNING: over 8MB — consider fewer frames or a smaller width." >&2
fi
