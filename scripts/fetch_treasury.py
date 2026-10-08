#!/usr/bin/env python3
"""Download the public US Treasury par yield curve, and Ken French annual factors when the site answers.

Writes data/treasury_par_yields.csv in long form (as_of, tenor_years, par_yield) with yields as decimals.
Writes data/french_ff_annual.csv when the zip can be fetched.
Writes data/PROVENANCE.md with the URL, the date, and a sha256 of each file.

The wide Treasury file is percent, including a bill printed as 0.50. This script divides by 100.
A long-form cell at or below 1 is left as a decimal by the app. Nothing here is a forecast.
"""

from __future__ import annotations

import csv
import hashlib
import io
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TODAY = date.today().isoformat()
FIRST_YEAR = 1990
LAST_YEAR = TODAY[:4]

TENORS = [
    ("1 Mo", 1 / 12),
    ("2 Mo", 2 / 12),
    ("3 Mo", 0.25),
    ("4 Mo", 4 / 12),
    ("6 Mo", 0.5),
    ("1 Yr", 1),
    ("2 Yr", 2),
    ("3 Yr", 3),
    ("5 Yr", 5),
    ("7 Yr", 7),
    ("10 Yr", 10),
    ("20 Yr", 20),
    ("30 Yr", 30),
]

TREASURY_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
    "&field_tdr_date_value={year}&page&_format=csv"
)
FRENCH_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip"

HEADERS = {"User-Agent": "gao-modeling-toolkit/5.0 (research; public Treasury and Ken French files)"}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def treasury_rows(year: int) -> list[tuple[str, float, float]]:
    raw = fetch(TREASURY_URL.format(year=year))
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header:
        return []
    names = [cell.strip().lower() for cell in header]
    date_col = 0
    for index, name in enumerate(names):
        if name in {"date", "as of", "as_of"}:
            date_col = index
            break
    columns = []
    for label, tenor in TENORS:
        key = label.lower()
        if key in names:
            columns.append((names.index(key), tenor))
    rows: list[tuple[str, float, float]] = []
    for cells in reader:
        if len(cells) <= date_col:
            continue
        as_of = cells[date_col].strip()
        if not as_of:
            continue
        for index, tenor in columns:
            if index >= len(cells):
                continue
            cell = cells[index].strip()
            if cell == "" or cell.upper() == "N/A" or cell == ".":
                continue
            try:
                percent = float(cell)
            except ValueError:
                continue
            rows.append((as_of, tenor, percent / 100))
    return rows


def write_treasury() -> tuple[int, list[str]]:
    notes: list[str] = []
    out_rows: list[tuple[str, float, float]] = []
    last = int(LAST_YEAR)
    for year in range(FIRST_YEAR, last + 1):
        try:
            rows = treasury_rows(year)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            notes.append(f"{year}: {error}")
            continue
        notes.append(f"{year}: {len(rows)} tenor rows")
        out_rows.extend(rows)
        print(f"{year}: {len(rows)}", flush=True)
    path = DATA / "treasury_par_yields.csv"
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["as_of", "tenor_years", "par_yield"])
        for as_of, tenor, par in out_rows:
            writer.writerow([as_of, f"{tenor:.10f}".rstrip("0").rstrip("."), f"{par:.8f}"])
    return len(out_rows), notes


def write_french() -> str | None:
    try:
        payload = fetch(FRENCH_URL)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return f"Ken French annual file was not downloaded: {error}"
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        name = next((item for item in archive.namelist() if item.lower().endswith(".csv")), None)
        if name is None:
            return "Ken French zip contained no CSV."
        text = archive.read(name).decode("latin-1", errors="replace")
    path = DATA / "french_ff_annual.csv"
    path.write_text(text)
    return None


def provenance(treasury_rows_n: int, year_notes: list[str], french_note: str | None) -> None:
    lines = [
        "# Data provenance",
        "",
        f"Fetched {TODAY} by `scripts/fetch_treasury.py`.",
        "",
        "These files describe published yields and a published equity factor series.",
        "They are not a forecast, and they are not a portfolio.",
        "",
        "## US Treasury par yield curve",
        "",
        "Source: U.S. Department of the Treasury, Daily Treasury Par Yield Curve Rates.",
        "URL pattern: " + TREASURY_URL.format(year="YEAR"),
        "The published file is percent. `data/treasury_par_yields.csv` stores decimals (a printed 0.50 is 0.005).",
        "Columns: as_of, tenor_years, par_yield. Dates are kept as the Treasury file printed them (M/D/YYYY).",
        f"Rows: {treasury_rows_n}.",
        "",
    ]
    treasury = DATA / "treasury_par_yields.csv"
    if treasury.exists():
        lines.append(f"sha256: `{sha256(treasury)}`")
        lines.append("")
    lines.append("Year log:")
    lines.append("")
    lines.extend(f"- {note}" for note in year_notes)
    lines.append("")
    lines.append("## Ken French research factors")
    lines.append("")
    lines.append(f"URL: {FRENCH_URL}")
    lines.append("The market total return used by the backtest is (Mkt-RF + RF) / 100, from the annual block.")
    lines.append("Equity growth in a window is context. It is not a portfolio weight and it does not enter the case projection.")
    lines.append("")
    french = DATA / "french_ff_annual.csv"
    if french_note:
        lines.append(french_note)
    elif french.exists():
        lines.append(f"sha256: `{sha256(french)}`")
    lines.append("")
    (DATA / "PROVENANCE.md").write_text("\n".join(lines) + "\n")


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    count, notes = write_treasury()
    french_note = write_french()
    provenance(count, notes, french_note)
    print(f"wrote {count} treasury rows", flush=True)
    if french_note:
        print(french_note, flush=True)
    if count == 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
