#!/usr/bin/env python3
"""Download daily adjusted closes from the public Yahoo chart endpoint.

Requires --tickers. Writes a long CSV the risk importer can read, plus a
provenance note with the URL, the as-of date, and a sha256 of the CSV.

This script is optional. `npm run verify` does not call it.
Nothing downloaded here is a portfolio.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=10y&events=div%2Csplit"
HEADERS = {"User-Agent": "gao-modeling-toolkit/6.0 (research; public Yahoo chart)"}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def rows_for(ticker: str, sector: str, role: str) -> list[dict[str, str]]:
    url = CHART.format(ticker=ticker)
    payload = json.loads(fetch(url).decode("utf-8"))
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        raise SystemExit(f"{ticker}: chart response had no result")
    block = result[0]
    stamps = block.get("timestamp") or []
    indicators = (block.get("indicators") or {}).get("adjclose") or []
    closes = indicators[0].get("adjclose") if indicators else None
    if not closes:
        raise SystemExit(f"{ticker}: adjusted close was missing")
    out: list[dict[str, str]] = []
    for stamp, close in zip(stamps, closes):
        if close is None:
            continue
        day = datetime.fromtimestamp(int(stamp), tz=timezone.utc).date().isoformat()
        out.append(
            {
                "date": day,
                "ticker": ticker,
                "adj_close": f"{float(close):.6f}",
                "sector": sector,
                "role": role,
                "benchmark": "",
                "event": "0",
                "nonsync": "0",
            }
        )
    if not out:
        raise SystemExit(f"{ticker}: no adjusted closes")
    return out


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch daily adjusted closes.")
    parser.add_argument("--tickers", required=True, help="Comma-separated tickers. Required.")
    parser.add_argument("--out", default="data/prices.csv")
    parser.add_argument("--market", default="", help="Ticker to mark as the market column.")
    parser.add_argument("--sectors", default="", help="ticker=sector pairs, comma-separated.")
    parser.add_argument("--as-of", default=date.today().isoformat())
    args = parser.parse_args()
    sectors = {}
    for pair in args.sectors.split(","):
        if "=" in pair:
            ticker, sector = pair.split("=", 1)
            sectors[ticker.strip().upper()] = sector.strip()
    tickers = [part.strip().upper() for part in args.tickers.split(",") if part.strip()]
    if not tickers:
        raise SystemExit("--tickers needs at least one symbol")
    market = args.market.strip().upper()
    rows: list[dict[str, str]] = []
    urls: list[str] = []
    for ticker in tickers:
        role = "market" if ticker == market else "asset"
        rows.extend(rows_for(ticker, sectors.get(ticker, ""), role))
        urls.append(CHART.format(ticker=ticker))
    rows.sort(key=lambda row: (row["date"], row["ticker"]))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["date", "ticker", "adj_close", "sector", "role", "benchmark", "event", "nonsync"],
        )
        writer.writeheader()
        writer.writerows(rows)
    last = rows[-1]["date"]
    provenance = out.with_suffix(".PROVENANCE.md")
    provenance.write_text(
        "\n".join(
            [
                "# Price provenance",
                "",
                f"As of {args.as_of}. Last session in the file: {last}.",
                f"Rows: {len(rows)}. Tickers: {', '.join(tickers)}.",
                "",
                "Source: Yahoo chart API, adjusted close, daily bars.",
                *(f"- {url}" for url in urls),
                "",
                f"sha256 {out.name}: {sha256(out)}",
                "",
                "The file is an input to the risk estimators. It is not a portfolio.",
                "",
            ]
        )
    )
    print(f"Wrote {out} ({len(rows)} rows) and {provenance}")


if __name__ == "__main__":
    main()
