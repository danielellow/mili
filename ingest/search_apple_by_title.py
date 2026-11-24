"""
mili, step 8: search Apple Music by artist and title.

The barcode lookups only find works that have a barcode, and the Deezer name
search (step 4) missed some of the rest. Those works then never got a link for
Odesli to start from, so we never found them on Spotify, YouTube or anywhere
else. This script searches Apple Music by name for every work that has no
Apple Music link yet. Works with no listen link at all go first.

For each work it asks Apple's free search (no key needed):
  1. the main artist and the title together:  "Gigi Masin Wind"
  2. if that finds nothing, the title alone (only for titles of 4+ letters)
and saves up to 10 candidate albums, untouched, as one line in:
    data/raw/apple_title_search/<run time>.jsonl

This script does NOT decide which candidate is right. That happens in dbt
(silver_apple_title_matches), with the same strict check as the Deezer name
search: the artist AND the title have to match closely.

Apple allows about 20 searches a minute, so the script waits 3.2 seconds
between searches: about 1,900 works take 2 to 3 hours. You can stop it at any
time with Ctrl+C, and run the same command again to continue.

After it: `dbt build`, then run Odesli again (step 6). Works that now have an
Apple Music link get sent to Odesli for the first time, which finds them on
the other platforms.

Before running: the database has to exist (it does if you've run `dbt build`
before).

Examples:
    python ingest/search_apple_by_title.py --limit 10            (a quick test)
    python ingest/search_apple_by_title.py --only-unheard        (just the works with no listen link)
    caffeinate -i python ingest/search_apple_by_title.py         (everything, can take hours)
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

# Reuse the polite Apple connection (pace + retries) from the barcode script
from lookup_platforms_by_barcode import Apple, APPLE_COUNTRY

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE = PROJECT_ROOT / "data" / "mili.duckdb"
RAW_DIR = PROJECT_ROOT / "data" / "raw" / "apple_title_search"
CANDIDATES_PER_WORK = 10
SECONDS_PER_SEARCH = 3.2

# platforms that count as "can be heard" (the subscription streaming services)
STREAMING = ["apple_music", "youtube_music", "tidal", "qobuz", "deezer", "spotify", "amazon_music", "pandora"]


# ---------------------------------------------------------------------------
# Which works to search for
# ---------------------------------------------------------------------------

def works_to_search(labels, only_unheard):
    """Works without an Apple Music link; the ones with no streaming link at all first."""
    if not DATABASE.exists():
        sys.exit("No database found. Run `dbt build` first, then try again.")

    label_filter = ""
    params = list(STREAMING)
    if labels:
        placeholders = ", ".join("?" for _ in labels)
        label_filter = f"and lower(lw.mili_label) in ({placeholders})"
        params += [label.lower() for label in labels]

    streaming = ", ".join("?" for _ in STREAMING)
    query = f"""
        with works as (
            select distinct
                g.release_group_id as work_id,
                g.title,
                -- the first (main) artist; full credits like "A & B" search badly
                g.release_group_json ->> '$.artist-credit[0].name' as main_artist,
                exists (
                    select 1 from silver_mb_releases r
                    where r.release_group_id = g.release_group_id
                      and r.barcode is not null
                ) as has_barcode,
                not exists (
                    select 1 from gold_instances i
                    where i.work_id = g.release_group_id
                      and i.platform_id in ({streaming})
                ) as unheard
            from silver_mb_release_groups g
            join gold_label_works lw on lw.work_id = g.release_group_id
            where not exists (
                select 1 from gold_instances i
                where i.work_id = g.release_group_id
                  and i.platform_id = 'apple_music'
            )
            {label_filter}
        )
        select work_id, title, main_artist, has_barcode, unheard
        from works
        order by unheard desc, work_id
    """
    with duckdb.connect(str(DATABASE), read_only=True) as con:
        rows = con.execute(query, params).fetchall()
    if only_unheard:
        rows = [r for r in rows if r[4]]
    return rows


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


# ---------------------------------------------------------------------------
# Searching Apple
# ---------------------------------------------------------------------------

class AppleSearch(Apple):
    """The Apple connection from the barcode script, plus album search."""

    def search(self, term):
        response = self.get(
            "https://itunes.apple.com/search",
            params={
                "term": term,
                "entity": "album",
                "limit": CANDIDATES_PER_WORK,
                "country": APPLE_COUNTRY,
            },
        )
        return response.json()


def search_work(apple, title, artist):
    """Artist and title first, then the title alone. Returns (searches tried, answer)."""
    terms = [f"{artist or ''} {title}".strip()]
    if len((title or "").strip()) >= 4:
        terms.append(title.strip())
    tried = []
    answer = {}
    for term in terms:
        tried.append(term)
        answer = apple.search(term)
        if answer.get("results"):
            break
    return tried, answer


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Search Apple Music by artist and title.")
    parser.add_argument("--label", action="append", default=[],
                        help="only works on this mili label (can be used several times)")
    parser.add_argument("--only-unheard", action="store_true",
                        help="only works with no streaming link at all")
    parser.add_argument("--limit", type=int, default=None,
                        help="stop after this many works (handy for a quick test)")
    args = parser.parse_args()

    works = works_to_search(args.label, args.only_unheard)
    done = already_searched()
    to_do = [w for w in works if w[0] not in done]
    if args.limit:
        to_do = to_do[: args.limit]

    unheard = sum(1 for w in to_do if w[4])
    print(f"{len(works)} works without a known Apple Music link, "
          f"{len(works) - len(to_do)} already searched, {len(to_do)} to search "
          f"({unheard} of them with no streaming link at all; those go first).")
    if not to_do:
        return
    minutes = len(to_do) * 1.5 * SECONDS_PER_SEARCH / 60   # usually one search, sometimes two
    estimate = "less than a minute" if minutes < 1 else f"about {minutes:.0f} minutes"
    print(f"This will take {estimate}. Stop anytime with Ctrl+C.\n")

    apple = AppleSearch()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RAW_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.jsonl"

    counts = {"found": 0, "not_found": 0, "error": 0}
    try:
        with open(out_path, "a", encoding="utf-8") as out:
            for i, (work_id, title, artist, has_barcode, is_unheard) in enumerate(to_do, start=1):
                fetched_at = datetime.now(timezone.utc).isoformat()
                try:
                    tried, answer = search_work(apple, title, artist)
                    status = "found" if answer.get("results") else "not_found"
                except Exception as error:   # one bad search shouldn't stop the run
                    tried, answer, status = [], {"error": str(error)}, "error"
                counts[status] += 1

                record = {
                    "work_id": work_id,
                    "title": title,
                    "main_artist": artist,
                    "has_barcode": has_barcode,
                    "unheard": is_unheard,
                    "queries_tried": tried,
                    "status": status,      # found = Apple returned candidates (not yet checked!)
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
    print("Next: dbt build, then python ingest/lookup_odesli.py, then dbt build again.")


if __name__ == "__main__":
    main()
