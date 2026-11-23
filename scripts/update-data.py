#!/usr/bin/env python3
"""Refresh the complete official USITC HTS snapshot; retain old data on failure.

No third-party service or API key is required. Download is intentionally explicit;
the app never labels its bundled snapshot as a live rate or a historical lookup.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SOURCE = "https://hts.usitc.gov/reststop/exportList?from=0101&to=9999&format=JSON&styles=false"
VERSION_SOURCE = "https://www.usitc.gov/harmonized_tariff_information"
LICENSE_SOURCE = "https://catalog.data.gov/dataset/harmonized-tariff-schedule-of-the-united-states-2025"


def curl(url):
    proc = subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error",
                           "--max-time", "120", "--retry", "1", "-A", "TanjiTariff/1.0",
                           url], capture_output=True, check=True)
    return proc.stdout


def validate(rows):
    if not isinstance(rows, list) or len(rows) < 25000:
        raise ValueError("Incomplete snapshot: expected at least 25,000 USITC rows")
    chapters = set()
    for row in rows:
        if not isinstance(row, dict) or "description" not in row:
            raise ValueError("Invalid USITC row")
        code = re.sub(r"\D", "", row.get("htsno") or "")
        if code:
            chapters.add(int(code[:2]))
    missing = set(range(1, 100)) - {77} - chapters
    if missing:
        raise ValueError(f"Missing chapters: {sorted(missing)}")
    if not any(re.sub(r"\D", "", r.get("htsno") or "") == "3925900000" for r in rows):
        raise ValueError("Expected reference HTS line was not found")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Validate a previously downloaded official JSON file")
    parser.add_argument("--version-html", type=Path, help="Previously downloaded USITC version announcement")
    args = parser.parse_args()
    raw = args.input.read_bytes() if args.input else curl(SOURCE)
    rows = json.loads(raw)
    validate(rows)
    html = args.version_html.read_text() if args.version_html else curl(VERSION_SOURCE).decode("utf-8")
    match = re.search(r"(20\d{2}) HTS Revision (\d+) was published on ([A-Za-z]+ \d{1,2}, 20\d{2})", html)
    if not match:
        raise ValueError("Could not verify the official HTS revision; old snapshot retained")
    year, revision, released = match.groups()
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta = {
        "version": f"{year} HTS Revision {revision}",
        "revision": int(revision),
        "year": int(year),
        "released_at": datetime.strptime(released, "%B %d, %Y").date().isoformat(),
        "fetched_at": fetched_at,
        "source": SOURCE,
        "version_source": VERSION_SOURCE,
        "license": "U.S. Government public domain",
        "license_source": LICENSE_SOURCE,
        "raw_sha256": hashlib.sha256(raw).hexdigest(),
        "row_count": len(rows),
        "coverage": "HTS chapters 01–99, excluding reserved chapter 77",
        "mode": "official_snapshot",
    }
    DATA.mkdir(parents=True, exist_ok=True)
    dump = {**meta, "rows": rows}
    with tempfile.NamedTemporaryFile("w", dir=DATA, suffix=".tmp", delete=False, encoding="utf-8") as f:
        json.dump(dump, f, ensure_ascii=False, separators=(",", ":"))
        temp_name = f.name
    os.replace(temp_name, DATA / "hts-full.json")
    (DATA / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(rows):,} official rows — {meta['version']} — fetched {fetched_at}")


if __name__ == "__main__":
    main()
