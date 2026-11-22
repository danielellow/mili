"""
mili, step 7: find each work on Discogs, so every release can offer Discogs
as a place to buy it (next to Bandcamp).

What the script does depends on what we already know:
  - MusicBrainz links the main Discogs page ("master")  -> nothing to do
  - MusicBrainz only links one edition ("release")       -> look that edition
    up on Discogs, which tells us its master
  - no Discogs link at all                               -> search Discogs:
    first by barcode, then by artist + title (also when the barcode only
    turns up records with a clearly different title)

Every answer is saved, untouched, as one line in:
    data/raw/discogs/<run time>.jsonl

Checking the search results (artist and title) happens later, in dbt
(silver_discogs_matches). Works that still have no match get a ready-made
Discogs search link in gold_works, so every release has a Discogs option.

Discogs allows 60 requests per minute with a token. You can stop the script
at any time with Ctrl+C; running the same command again continues where it
left off. Your token lives in .env as DISCOGS_TOKEN.

Before running: run `dbt build` (the list of works is read from its database).

Examples:
    python ingest/lookup_discogs.py --label "AD 93" --limit 10     (a quick test)
    caffeinate -i python ingest/lookup_discogs.py                    (all labels)
"""

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

import duckdb
import requests
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE = PROJECT_ROOT / "data" / "mili.duckdb"
RAW_DIR = PROJECT_ROOT / "data" / "raw" / "discogs"
API = "https://api.discogs.com"

SECONDS_BETWEEN_CALLS = 1.1   # Discogs allows 60 per minute with a token
RESULTS_PER_SEARCH = 5
MAX_TRIES = 5


# ---------------------------------------------------------------------------
# Which works need a Discogs lookup, and how
# ---------------------------------------------------------------------------

def works_to_look_up(labels):
    """
    Works whose best Discogs link isn't a master page yet, with what we need
    to look them up: the edition ID (if MusicBrainz links one), a barcode
    (preferring physical editions, since Discogs mostly lists vinyl and CDs),
    and the title and main artist.
    """
    if not DATABASE.exists():
        sys.exit("No database found. Run `dbt build` first, then try again.")

    label_filter = ""
    params = []
    if labels:
        placeholders = ", ".join("?" for _ in labels)
        label_filter = f"and lower(lw.mili_label) in ({placeholders})"
        params = [label.lower() for label in labels]

    query = f"""
        with known as (
            -- the best Discogs link MusicBrainz gives each work: master first
            select
                release_group_id as work_id,
                max(case when discogs_page_type = 'master' then 1 else 0 end) as has_master,
                min(case when discogs_page_type = 'release'
                    then regexp_extract(url, '/release/([0-9]+)', 1) end) as release_id
            from silver_mb_urls
            where platform_id = 'discogs'
            group by 1
        ),
        barcodes as (
            select
                release_group_id as work_id,
                barcode,
                row_number() over (
                    partition by release_group_id
                    order by
                        case when formats ilike '%digital%' then 1 else 0 end,  -- physical first
                        release_date nulls last,
                        barcode
                ) as preference
            from silver_mb_releases
            where barcode is not null
              and regexp_full_match(barcode, '[0-9]{{8,14}}')
        )
        select distinct
            g.release_group_id as work_id,
            nullif(k.release_id, '') as release_id,
            b.barcode,
            g.title,
            g.release_group_json ->> '$.artist-credit[0].name' as main_artist
        from silver_mb_release_groups g
        join gold_label_works lw on lw.work_id = g.release_group_id
        left join known k on k.work_id = g.release_group_id
        left join barcodes b on b.work_id = g.release_group_id and b.preference = 1
        where coalesce(k.has_master, 0) = 0
        {label_filter}
        order by work_id
    """
    with duckdb.connect(str(DATABASE), read_only=True) as con:
        return con.execute(query, params).fetchall()


def already_answered():
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
# Talking to Discogs
# ---------------------------------------------------------------------------

class Discogs:

    def __init__(self):
        load_dotenv(PROJECT_ROOT / ".env")
        token = os.getenv("DISCOGS_TOKEN", "").strip()
        if not token:
            sys.exit("DISCOGS_TOKEN is missing from .env")
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "mili/0.1 +https://github.com/danielellow/mili"
        self.session.headers["Authorization"] = f"Discogs token={token}"
        self.last_call = 0.0

    def wait_for_turn(self):
        since_last = time.monotonic() - self.last_call
        if since_last < SECONDS_BETWEEN_CALLS:
            time.sleep(SECONDS_BETWEEN_CALLS - since_last)
        self.last_call = time.monotonic()

    def get(self, path, params=None):
        """GET with pacing and retries. Returns (http_status, answer)."""
        for attempt in range(1, MAX_TRIES + 1):
            self.wait_for_turn()
            try:
                response = self.session.get(API + path, params=params, timeout=60)
            except requests.RequestException as error:
                problem, wait = f"connection problem ({error.__class__.__name__})", 30
            else:
                if response.status_code == 401:
                    sys.exit("Discogs didn't accept the token. Check DISCOGS_TOKEN in .env.")
                if response.status_code == 429:
                    problem, wait = "Discogs says too many requests", 60
                elif response.status_code >= 500:
                    problem, wait = f"Discogs answered {response.status_code}", 30 * attempt
                else:
                    try:
                        return response.status_code, response.json()
                    except ValueError:
                        return response.status_code, {"text": response.text[:500]}
            if attempt == MAX_TRIES:
                raise RuntimeError(f"{problem}, giving up on this one for now")
            print(f"   {problem}, waiting {wait} seconds...")
            time.sleep(wait)

    def release(self, release_id):
        status, answer = self.get(f"/releases/{release_id}")
        return ("found" if status == 200 else "not_found"), answer

    def search(self, **params):
        status, answer = self.get(
            "/database/search",
            params={**params, "type": "release", "per_page": RESULTS_PER_SEARCH},
        )
        found = status == 200 and bool(answer.get("results"))
        return ("found" if found else "not_found"), answer


def clean(text):
    """Drop quote marks and invisible formatting characters (some MusicBrainz names have them)."""
    text = "".join(ch for ch in (text or "") if unicodedata.category(ch) != "Cf")
    return re.sub(r'["“”]', "", text).strip()


def simple(text):
    """Lowercase, no brackets, no punctuation: "Haw (Remastered)" -> "haw"."""
    text = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", clean(text).lower())
    return " ".join(re.findall(r"\w+", text))


def looks_like(title, answer):
    """
    A rough first check: does any search result have about the same title?
    Only used to decide whether a second search (artist + title) is worth it.
    The real check happens in dbt.
    """
    wanted = simple(title)
    for result in answer.get("results") or []:
        found = simple((result.get("title") or "").split(" - ", 1)[-1])
        if SequenceMatcher(None, wanted, found).ratio() >= 0.8:
            return True
        if len(wanted) >= 3 and (wanted in found or found in wanted):
            return True
    return False


def look_up(discogs, release_id, barcode, title, artist):
    """
    Returns (method, queries_tried, status, answer).
    method = release_lookup, barcode_search or title_search
    """
    if release_id:
        status, answer = discogs.release(release_id)
        return "release_lookup", [f"release {release_id}"], status, answer

    tried = []
    barcode_answer = None
    if barcode:
        tried.append(f"barcode {barcode}")
        status, answer = discogs.search(barcode=barcode)
        if status == "found":
            if looks_like(title, answer):
                return "barcode_search", tried, status, answer
            barcode_answer = answer     # keep it, in case the name search finds nothing

    # Discogs calls compilations' artist "Various"
    if clean(artist).lower() in ("various artists", "various"):
        artist = "Various"
    tried.append(f"artist {artist} / title {title}")
    status, answer = discogs.search(artist=clean(artist), release_title=clean(title))
    if status == "not_found" and barcode_answer is not None:
        return "barcode_search", tried, "found", barcode_answer
    return "title_search", tried, status, answer


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Find works on Discogs.")
    parser.add_argument("--label", action="append", default=[],
                        help="only works on this mili label (can be used several times)")
    parser.add_argument("--limit", type=int, default=None,
                        help="stop after this many works (handy for a quick test)")
    args = parser.parse_args()

    works = works_to_look_up(args.label)
    done = already_answered()
    to_do = [w for w in works if w[0] not in done]
    print(f"{len(works)} works without a known Discogs master page, "
          f"{len(works) - len(to_do)} already looked up, {len(to_do)} still to look up.")
    if args.limit and len(to_do) > args.limit:
        to_do = to_do[: args.limit]
        print(f"Looking up the first {len(to_do)} (--limit).")
    if not to_do:
        return
    minutes = len(to_do) * 1.5 * SECONDS_BETWEEN_CALLS / 60   # some works need two searches
    estimate = "less than a minute" if minutes < 1 else f"up to about {minutes:.0f} minutes"
    print(f"This will take {estimate}. Stop anytime with Ctrl+C.\n")

    discogs = Discogs()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RAW_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.jsonl"

    counts = {"found": 0, "not_found": 0, "error": 0}
    try:
        with open(out_path, "a", encoding="utf-8") as out:
            for i, (work_id, release_id, barcode, title, artist) in enumerate(to_do, start=1):
                fetched_at = datetime.now(timezone.utc).isoformat()
                try:
                    method, tried, status, answer = look_up(discogs, release_id, barcode, title, artist)
                except Exception as error:   # one bad lookup shouldn't stop the run
                    method, tried, status, answer = None, [], "error", {"error": str(error)}
                counts[status] += 1

                out.write(json.dumps({
                    "work_id": work_id,
                    "method": method,            # release_lookup, barcode_search or title_search
                    "queries_tried": tried,
                    "status": status,            # found = Discogs answered with results (checked later)
                    "fetched_at": fetched_at,
                    "response": answer,
                }, ensure_ascii=False) + "\n")
                out.flush()

                if i % 25 == 0 or i == len(to_do):
                    print(f"   {i}/{len(to_do)}: found {counts['found']}, "
                          f"not found {counts['not_found']}, errors {counts['error']}")
    except KeyboardInterrupt:
        print("\nStopped. Everything so far is saved; run the same command to continue.")

    print(f"\nFound {counts['found']}, not found {counts['not_found']}, errors {counts['error']}.")
    print("(Search results are checked against artist and title in dbt.)")
    print(f"Saved to {out_path.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
