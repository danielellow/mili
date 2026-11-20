"""
mili, step 6: find each work on more platforms with Odesli (song.link).

Odesli takes ONE link to a release and answers with the same release on many
other platforms: Spotify, Apple Music, YouTube, YouTube Music, Tidal, Deezer,
Amazon Music, Pandora, SoundCloud and more.

For each work that already has a link on Apple Music, Deezer, Spotify or Tidal
(from MusicBrainz or our own lookups), this script sends that one link to
Odesli, and saves the full answer, untouched, as one line in:
    data/raw/odesli/<run time>.jsonl

Matching the answers to platforms, and checking them against the MusicBrainz
title, happens later, in dbt (silver_odesli_links).

Our key allows 10 requests per minute (at most 600 per hour), so a full run
takes many hours. You can stop it at any time with Ctrl+C; running the same
command again continues where it left off. The key lives in .env as
ODESLI_API_KEY.

Before running: run `dbt build`, because the starting links are read from the
DuckDB database it creates (data/mili.duckdb).

Examples:
    python ingest/lookup_odesli.py --label "AD 93" --limit 5     (a quick test)
    caffeinate -i python ingest/lookup_odesli.py                   (all labels, overnight)
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import requests
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE = PROJECT_ROOT / "data" / "mili.duckdb"
RAW_DIR = PROJECT_ROOT / "data" / "raw" / "odesli"
ODESLI_URL = "https://api.odesli.co/v1-alpha.1/links"

SECONDS_BETWEEN_CALLS = 6.2   # just under 10 per minute (and under 600 per hour)
USER_COUNTRY = "US"           # which country's catalogues Odesli searches (same as our Apple lookups)
MAX_TRIES = 5

# Which links we start from, best first.
START_PLATFORMS = ["apple_music", "deezer", "spotify", "tidal"]


# ---------------------------------------------------------------------------
# Choosing a starting link for each work
# ---------------------------------------------------------------------------

def works_to_look_up(labels):
    """One starting link per work, from the platforms in START_PLATFORMS."""
    if not DATABASE.exists():
        sys.exit("No database found. Run `dbt build` first, then try again.")

    preference = " ".join(
        f"when '{p}' then {i}" for i, p in enumerate(START_PLATFORMS, start=1)
    )
    label_filter = ""
    params = list(START_PLATFORMS)
    if labels:
        placeholders = ", ".join("?" for _ in labels)
        label_filter = f"and lower(lw.mili_label) in ({placeholders})"
        params += [label.lower() for label in labels]

    platform_list = ", ".join("?" for _ in START_PLATFORMS)
    query = f"""
        with ranked as (
            select
                i.work_id,
                i.platform_id,
                i.url,
                row_number() over (
                    partition by i.work_id
                    order by case i.platform_id {preference} else 99 end, i.url
                ) as preference
            from gold_instances i
            where i.platform_id in ({platform_list})
        )
        select distinct r.work_id, r.platform_id, r.url
        from ranked r
        join gold_label_works lw on lw.work_id = r.work_id
        where r.preference = 1
        {label_filter}
        order by r.work_id
    """
    with duckdb.connect(str(DATABASE), read_only=True) as con:
        return con.execute(query, params).fetchall()


def already_answered():
    """Works that already have an answer from Odesli (found or not found)."""
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
# Talking to Odesli
# ---------------------------------------------------------------------------

class Odesli:

    def __init__(self):
        load_dotenv(PROJECT_ROOT / ".env")
        self.key = os.getenv("ODESLI_API_KEY", "").strip()
        if not self.key:
            sys.exit("ODESLI_API_KEY is missing from .env")
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "mili/0.1 (open music catalogue)"
        self.last_call = 0.0

    def wait_for_turn(self):
        since_last = time.monotonic() - self.last_call
        if since_last < SECONDS_BETWEEN_CALLS:
            time.sleep(SECONDS_BETWEEN_CALLS - since_last)
        self.last_call = time.monotonic()

    def links(self, url):
        """
        Ask Odesli for the same release on other platforms.
        Returns (status, answer): status is 'found' or 'not_found'.
        """
        params = {
            "url": url,
            "userCountry": USER_COUNTRY,
            "songIfSingle": "true",   # Odesli matches singles better this way
            "key": self.key,
        }
        for attempt in range(1, MAX_TRIES + 1):
            self.wait_for_turn()
            try:
                response = self.session.get(ODESLI_URL, params=params, timeout=60)
            except requests.RequestException as error:
                problem = f"connection problem ({error.__class__.__name__})"
                wait = 30
            else:
                if response.status_code == 200:
                    return "found", response.json()
                if response.status_code == 429:
                    # over the hourly cap: wait a good while before trying again
                    problem, wait = "Odesli says too many requests", 120 * attempt
                elif response.status_code >= 500:
                    problem, wait = f"Odesli answered {response.status_code}", 30 * attempt
                else:
                    # 400/404: Odesli couldn't work with this link; that's an answer too
                    try:
                        body = response.json()
                    except ValueError:
                        body = {"text": response.text[:500]}
                    return "not_found", {"http_status": response.status_code, "body": body}
            if attempt == MAX_TRIES:
                raise RuntimeError(f"{problem}, giving up on this one for now")
            print(f"   {problem}, waiting {wait} seconds...")
            time.sleep(wait)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Find works on more platforms with Odesli.")
    parser.add_argument("--label", action="append", default=[],
                        help="only works on this mili label (can be used several times)")
    parser.add_argument("--limit", type=int, default=None,
                        help="stop after this many works (handy for a quick test)")
    args = parser.parse_args()

    works = works_to_look_up(args.label)
    done = already_answered()
    to_do = [w for w in works if w[0] not in done]
    if args.limit:
        to_do = to_do[: args.limit]

    print(f"{len(works)} works with a starting link, {len(works) - len(to_do)} already answered, "
          f"{len(to_do)} to look up on Odesli.")
    if not to_do:
        return
    hours = len(to_do) * SECONDS_BETWEEN_CALLS / 3600
    estimate = (f"about {hours * 60:.0f} minutes" if hours < 1
                else f"about {hours:.1f} hours")
    print(f"This will take {estimate}. Stop anytime with Ctrl+C.\n")

    odesli = Odesli()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RAW_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.jsonl"

    counts = {"found": 0, "not_found": 0, "error": 0}
    try:
        with open(out_path, "a", encoding="utf-8") as out:
            for i, (work_id, start_platform, start_url) in enumerate(to_do, start=1):
                fetched_at = datetime.now(timezone.utc).isoformat()
                try:
                    status, answer = odesli.links(start_url)
                except Exception as error:   # one bad lookup shouldn't stop the run
                    status, answer = "error", {"error": str(error)}
                counts[status] += 1

                record = {
                    "work_id": work_id,
                    "start_platform": start_platform,
                    "start_url": start_url,
                    "status": status,
                    "fetched_at": fetched_at,
                    "response": answer,
                }
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()

                if i % 25 == 0 or i == len(to_do):
                    print(f"   {i}/{len(to_do)}: found {counts['found']}, "
                          f"not found {counts['not_found']}, errors {counts['error']}")
    except KeyboardInterrupt:
        print("\nStopped. Everything so far is saved; run the same command to continue.")

    print(f"\nFound {counts['found']}, not found {counts['not_found']}, errors {counts['error']}.")
    print(f"Saved to {out_path.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
