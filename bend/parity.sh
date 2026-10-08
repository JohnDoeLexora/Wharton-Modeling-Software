#!/bin/sh
# Golden-vector parity: Bend, the TypeScript engine, and the Python cross-check.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
npx vite-node scripts/parity.ts
python3 reference/python/parity_check.py
