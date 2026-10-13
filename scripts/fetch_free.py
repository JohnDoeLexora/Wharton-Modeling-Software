#!/usr/bin/env python3
"""Optional fetch of free series. Every attempt is appended to data/FETCH_LOG.md.

Sources, and only these:
- US Treasury par yields (the existing scripts/fetch_treasury.py path)
- FRED (a public series id the caller passes)
- Ken French factor files
- Issuer ETF holdings the caller already has as a local CSV

No key is required for the Treasury CSV. FRED and French downloads are best-effort.
The script does not place a trade and it does not choose a portfolio.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOG = ROOT / "data" / "FETCH_LOG.md"
SOURCES = {
    "treasury": "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv",
    "french": "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip",
    "fred": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10",
}


def log(line: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    if not LOG.exists():
        LOG.write_text("# Fetch log\n\nFree sources only. Each row is one attempt.\n\n")
    with LOG.open("a") as handle:
        handle.write(line + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=sorted(SOURCES), default="treasury")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = SOURCES[args.source]
    if args.dry_run:
        log(f"- {stamp} {args.source} dry-run {url}")
        print(f"dry-run {args.source}")
        return
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            body = response.read()
        digest = hashlib.sha256(body).hexdigest()
        out = ROOT / "data" / f"fetch_{args.source}.bin"
        out.write_bytes(body)
        log(f"- {stamp} {args.source} ok bytes {len(body)} sha256 {digest} url {url}")
        print(f"wrote {out} sha256 {digest}")
    except Exception as error:
        log(f"- {stamp} {args.source} failed {type(error).__name__}: {error} url {url}")
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
