#!/bin/sh
# Typecheck every Bend module, then check the law file.
# The demo is `bend bend/main.bend` (or `npm run bend:demo`).
set -e
cd "$(dirname "$0")/.."
for f in \
  bend/fix.bend \
  bend/case.bend \
  bend/glide.bend \
  bend/reserve.bend \
  bend/facility.bend \
  bend/rng.bend \
  bend/corr.bend \
  bend/shock.bend \
  bend/project.bend \
  bend/main.bend
do
  bend --check-only "$f"
done
bend bend/laws/LAWS.bend
