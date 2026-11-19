"""
mili, step 4: search Deezer by artist and title.

The barcode lookups can only find works that have a barcode. This script
searches Deezer by name instead, for every work that doesn't have a known
Deezer link yet: works without a barcode, and works whose barcode Deezer
didn't recognise.

For each work it asks Deezer:
  1. a precise search:  artist:"Lanark Artefax" album:"Metallur"
  2. if that finds nothing, a looser search with just the words
and saves up to 5 candidate albums, untouched, as one line in:
    data/raw/deezer_title_search/<run time>.jsonl

This script does NOT decide which candidate is right. That happens in dbt
(silver_deezer_title_matches), where a candidate must match both the artist
and the title, because there is no barcode to back it up.

You can stop it at any time with Ctrl+C, and run the same command again to
continue where it left off.

Before running: run `dbt build`, because the list of works is read from the
DuckDB database it creates (data/mili.duckdb).

Examples:
    python ingest/search_deezer_by_title.py --label "AD 93"     (a quick test)
    python ingest/search_deezer_by_title.py                     (all labels)
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb

# Reuse the polite Deezer connection (pace + retries) from the barcode script
from lookup_platforms_by_barcode import Deezer, MAX_TRIES

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE = PROJECT_ROOT / "data" / "mili.duckdb"
RAW_DIR = PROJECT_ROOT / "data" / "raw" / "deezer_title_search"
CANDIDATES_PER_WORK = 5


# ---------------------------------------------------------------------------
# Which works to search for
# ---------------------------------------------------------------------------

def works_to_search(labels):
    """Works that don't have a known Deezer link yet (from any source)."""
    if not DATABASE.exists():
        sys.exit("No database found. Run `dbt build` first, then try again.")

    label_filter = ""
    params = []
    if labels:
        placeholders = ", ".join("?" for _ in labels)
        label_filter = f"and lower(lw.mili_label) in ({placeholders})"
        params = [label.lower() for label in labels]

    query = f"""
        select distinct
            g.release_group_id as work_id,
            g.title,
            -- the first (main) artist; full credits like "A & B" search badly
            g.release_group_json ->> '$.artist-credit[0].name' as main_artist,
            exists (
                select 1 from silver_mb_releases r
                where r.release_group_id = g.release_group_id
                  and r.barcode is not null
            ) as has_barcode
        from silver_mb_release_groups g
        join gold_label_works lw on lw.work_id = g.release_group_id
        where not exists (
            select 1 from gold_instances i
            where i.work_id = g.release_group_id
              and i.platform_id = 'deezer'
        )
        {label_filter}
        order by work_id
    """
    with duckdb.connect(str(DATABASE), read_only=True) as con:
        return con.execute(query, params).fetchall()


def already_searched():
    """Works that already have an answer (with or without candidates)."""
    done = set()
    if not RAW_DIR.exists():
        return done
    for path in RAW_DIR.glob("*.jsonl"):
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if record.get("status") in ("found", "not_found"):
                    done.add(record["work_id"])
    return done


def clean(text):
    """Remove quote marks, which would break Deezer's search syntax."""
    return re.sub(r'["“”]', "", text or "").strip()


# ---------------------------------------------------------------------------
# Searching Deezer
# ---------------------------------------------------------------------------

class DeezerSearch(Deezer):
    """The Deezer connection from the barcode script, plus album search."""

    def search(self, query):
        for attempt in range(1, MAX_TRIES + 1):
            response = self.get(
                "https://api.deezer.com/search/album",
                params={"q": query, "limit": CANDIDATES_PER_WORK},
            )
            answer = response.json()
            error = answer.get("error") if isinstance(answer, dict) else None
            if not error:
                return answer
            if error.get("code") == 4:            # 4 = too many requests, slow down
                print("   Deezer says slow down, waiting 5 seconds...")
                time.sleep(5)
                continue
            raise RuntimeError(f"Deezer error: {error}")
        raise RuntimeError("Deezer kept saying slow down, giving up on this one for now")


def search_work(deezer, title, artist):
    """Try a precise search first, then a looser one. Returns (queries tried, answer)."""
    title, artist = clean(title), clean(artist)
    queries = [f'artist:"{artist}" album:"{title}"', f"{artist} {title}"]
    tried = []
    answer = {}
    for query in queries:
        tried.append(query)
        answer = deezer.search(query)
        if answer.get("data"):
            break
    return tried, answer


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Search Deezer by artist and title.")
    parser.add_argument("--label", action="append", default=[],
                        help="only works on this mili label (can be used several times)")
    parser.add_argument("--limit", type=int, default=None,
                        help="stop after this many works (handy for a quick test)")
    args = parser.parse_args()

    works = works_to_search(args.label)
    done = already_searched()
    to_do = [w for w in works if w[0] not in done]
    if args.limit:
        to_do = to_do[: args.limit]

    print(f"{len(works)} works without a known Deezer link, "
          f"{len(works) - len(to_do)} already searched, {len(to_do)} to search.")
    if not to_do:
        return
    minutes = len(to_do) * 2 * 0.2 / 60   # at most two searches per work
    estimate = "less than a minute" if minutes < 1 else f"up to about {minutes:.0f} minutes"
    print(f"This will take {estimate}. Stop anytime with Ctrl+C.\n")

    deezer = DeezerSearch()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RAW_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.jsonl"

    counts = {"found": 0, "not_found": 0, "error": 0}
    try:
        with open(out_path, "a", encoding="utf-8") as out:
            for i, (work_id, title, artist, has_barcode) in enumerate(to_do, start=1):
                fetched_at = datetime.now(timezone.utc).isoformat()
                try:
                    tried, answer = search_work(deezer, title, artist)
                    status = "found" if answer.get("data") else "not_found"
                except Exception as error:   # one bad search shouldn't stop the run
                    tried, answer, status = [], {"error": str(error)}, "error"
                counts[status] += 1

                record = {
                    "work_id": work_id,
                    "title": title,
                    "main_artist": artist,
                    "has_barcode": has_barcode,
                    "queries_tried": tried,
                    "status": status,      # found = Deezer returned candidates (not yet checked!)
                    "fetched_at": fetched_at,
                    "response": answer,
                }
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()

                if i % 25 == 0 or i == len(to_do):
                    print(f"   {i}/{len(to_do)}: with candidates {counts['found']}, "
                          f"no candidates {counts['not_found']}, errors {counts['error']}")
    except KeyboardInterrupt:
        print("\nStopped. Everything so far is saved; run the same command to continue.")

    print(f"\nWith candidates {counts['found']}, no candidates {counts['not_found']}, "
          f"errors {counts['error']}.")
    print("(Candidates are checked against artist and title in dbt.)")
    print(f"Saved to {out_path.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
