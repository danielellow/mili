"""
mili, step 3: look up works on streaming platforms by their barcode.

MusicBrainz knows the barcode (UPC/EAN) of many editions. Platforms like
Apple Music, Deezer and Spotify can find an album by its barcode, so we ask
each platform directly: "do you have the album with this barcode?"

For each work we start with ONE barcode from MusicBrainz, preferring a
digital edition's barcode.

Barcodes change: a release can get a new barcode when a label switches
distributor, and MusicBrainz may only know the old one. Deezer is good at
finding an album from an old barcode, and tells us the barcode it has now.
So for Spotify and Apple, if the MusicBrainz barcode isn't found, we try the
barcode Deezer reported as a second attempt. (Run Deezer first for this.)
Matches made on a different barcode are double-checked against the title
later, in dbt.

Every answer is saved, untouched, as one line in a file in:
    data/raw/barcode_lookups/<platform>/<run time>.jsonl
("jsonl" = one JSON record per line, so nothing is lost if you stop halfway.)

You can stop the script at any time with Ctrl+C. Next time you run it, it
skips the works that already have an answer and continues where it left off.

Before running: run `dbt build`, because the barcodes are read from the
DuckDB database it creates (data/mili.duckdb).

Examples:
    python ingest/lookup_platforms_by_barcode.py --platform deezer --label "AD 93"
    python ingest/lookup_platforms_by_barcode.py --platform spotify --label "AD 93"
    python ingest/lookup_platforms_by_barcode.py --platform apple --label "AD 93"
    python ingest/lookup_platforms_by_barcode.py --platform deezer      (all labels)
"""

import argparse
import base64
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
RAW_ROOT = PROJECT_ROOT / "data" / "raw" / "barcode_lookups"

# How long to wait between requests to each platform, in seconds.
# Apple asks for about 20 requests per minute, so we stay just under that.
SECONDS_BETWEEN_CALLS = {"apple": 3.2, "deezer": 0.2, "spotify": 1.0}

# Which Apple Music store to look in (two-letter country code).
APPLE_COUNTRY = "us"

MAX_TRIES = 5


class StopForNow(Exception):
    """Raised when a platform says we've used up our quota for now."""


# ---------------------------------------------------------------------------
# Choosing which barcodes to look up
# ---------------------------------------------------------------------------

def works_to_look_up(labels):
    """
    One barcode per work, read from the DuckDB database dbt built.
    Prefers editions whose format includes "Digital", then the earliest one.
    With --label, only works on those labels (the mili_label names).
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
        with candidates as (
            select
                r.release_group_id as work_id,
                r.barcode,
                row_number() over (
                    partition by r.release_group_id
                    order by
                        case when r.formats ilike '%digital%' then 0 else 1 end,
                        r.release_date nulls last,
                        r.barcode
                ) as preference
            from silver_mb_releases r
            where r.barcode is not null
              and regexp_full_match(r.barcode, '[0-9]{{8,14}}')
        )
        select distinct c.work_id, c.barcode
        from candidates c
        join gold_label_works lw on lw.work_id = c.work_id
        where c.preference = 1
        {label_filter}
        order by c.work_id
    """
    # read_only = we only look, so dbt can't be disturbed and nothing is changed
    with duckdb.connect(str(DATABASE), read_only=True) as con:
        return con.execute(query, params).fetchall()


def read_records(platform):
    """All saved answers for a platform, oldest file first."""
    folder = RAW_ROOT / platform
    if not folder.exists():
        return
    for path in sorted(folder.glob("*.jsonl")):
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue  # a half-written last line from a stopped run


def previous_answers(platform):
    """
    What earlier runs already did: which works were found, and which barcodes
    have already been tried for each work (found or not).
    """
    found = set()
    tried = {}
    for record in read_records(platform):
        work_id = record["work_id"]
        if record.get("status") == "error":
            continue  # errors get another go next time
        tried.setdefault(work_id, set()).update(
            record.get("barcodes_tried") or [record.get("barcode")]
        )
        if record.get("status") == "found":
            found.add(work_id)
    return found, tried


def deezer_barcodes():
    """For each work Deezer found: the barcode Deezer itself has for that album."""
    barcodes = {}
    for record in read_records("deezer"):
        if record.get("status") == "found":
            upc = str((record.get("response") or {}).get("upc") or "").strip()
            if upc:
                barcodes[record["work_id"]] = upc
    return barcodes


def same_barcode(a, b):
    """Treat 012345 and 12345 as the same barcode (leading zeros don't matter)."""
    return a.lstrip("0") == b.lstrip("0")


# ---------------------------------------------------------------------------
# Talking to each platform
# ---------------------------------------------------------------------------

class Platform:
    """Shared behaviour: keep a polite pace, and retry when the platform is busy."""

    name = ""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "mili/0.1 (open music catalogue)"
        self.last_call = 0.0

    def wait_for_turn(self):
        gap = SECONDS_BETWEEN_CALLS[self.name]
        since_last = time.monotonic() - self.last_call
        if since_last < gap:
            time.sleep(gap - since_last)
        self.last_call = time.monotonic()

    def get(self, url, **kwargs):
        """GET with retries. Returns the response, or raises after MAX_TRIES."""
        for attempt in range(1, MAX_TRIES + 1):
            self.wait_for_turn()
            retry_after = ""
            try:
                response = self.session.get(url, timeout=30, **kwargs)
            except requests.RequestException as error:
                problem = f"connection problem ({error.__class__.__name__})"
            else:
                if response.status_code in (403, 429) or response.status_code >= 500:
                    self.check_quota(response)
                    problem = f"{self.name} answered {response.status_code}"
                    # platforms sometimes say how long to wait, in 'Retry-After'
                    retry_after = response.headers.get("Retry-After", "")
                else:
                    return response
            if attempt == MAX_TRIES:
                raise RuntimeError(f"{problem}, giving up on this one for now")
            wait = int(retry_after) if retry_after.isdigit() else 5 * 2 ** (attempt - 1)
            wait = max(2, min(wait, 120))
            print(f"   {problem}, waiting {wait} seconds...")
            time.sleep(wait)

    def check_quota(self, response):
        """Overridden by platforms that tell us when a quota is used up."""


class Apple(Platform):
    name = "apple"

    def lookup(self, barcode):
        response = self.get(
            "https://itunes.apple.com/lookup",
            params={"upc": barcode, "country": APPLE_COUNTRY},
        )
        answer = response.json()
        albums = [r for r in answer.get("results", []) if r.get("wrapperType") == "collection"]
        if albums:
            url = albums[0].get("collectionViewUrl", "").split("?")[0]  # drop tracking bits
            return "found", url, answer
        return "not_found", None, answer


class Deezer(Platform):
    name = "deezer"

    def lookup(self, barcode):
        for attempt in range(1, MAX_TRIES + 1):
            response = self.get(f"https://api.deezer.com/album/upc:{barcode}")
            answer = response.json()
            error = answer.get("error") if isinstance(answer, dict) else None
            if not error:
                return "found", answer.get("link"), answer
            if error.get("code") == 800:          # 800 = "no data": not on Deezer
                return "not_found", None, answer
            if error.get("code") == 4:            # 4 = too many requests, slow down
                print("   Deezer says slow down, waiting 5 seconds...")
                time.sleep(5)
                continue
            raise RuntimeError(f"Deezer error: {error}")
        raise RuntimeError("Deezer kept saying slow down, giving up on this one for now")


class Spotify(Platform):
    name = "spotify"

    def __init__(self):
        super().__init__()
        load_dotenv(PROJECT_ROOT / ".env")
        self.client_id = os.getenv("SPOTIFY_CLIENT_ID", "").strip()
        self.client_secret = os.getenv("SPOTIFY_CLIENT_SECRET", "").strip()
        if not (self.client_id and self.client_secret):
            sys.exit("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are missing from .env")
        self.token = None
        self.token_expires = 0.0

    def get_token(self):
        """Spotify gives a temporary 'access token' (valid ~1 hour) for your app's ID and secret."""
        if self.token and time.monotonic() < self.token_expires - 60:
            return self.token
        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        response = requests.post(
            "https://accounts.spotify.com/api/token",
            data={"grant_type": "client_credentials"},
            headers={"Authorization": f"Basic {basic}"},
            timeout=30,
        )
        if response.status_code != 200:
            sys.exit(f"Spotify didn't accept the app ID/secret ({response.status_code}). "
                     f"Check the values in .env.")
        data = response.json()
        self.token = data["access_token"]
        self.token_expires = time.monotonic() + data.get("expires_in", 3600)
        return self.token

    def check_quota(self, response):
        # Since July 2026, Spotify says "QUOTA_EXCEEDED" when a development app's
        # quota is used up. Waiting a few seconds won't help, so we stop the run.
        try:
            reason = response.json().get("error", {}).get("reason", "")
        except ValueError:
            reason = ""
        if reason == "QUOTA_EXCEEDED":
            raise StopForNow("Spotify says this app's quota is used up for now")

    def lookup(self, barcode):
        response = self.get(
            "https://api.spotify.com/v1/search",
            params={"q": f"upc:{barcode}", "type": "album", "limit": 1},
            headers={"Authorization": f"Bearer {self.get_token()}"},
        )
        if response.status_code == 401:           # token expired: get a new one, try again
            self.token = None
            response = self.get(
                "https://api.spotify.com/v1/search",
                params={"q": f"upc:{barcode}", "type": "album", "limit": 1},
                headers={"Authorization": f"Bearer {self.get_token()}"},
            )
        answer = response.json()
        items = answer.get("albums", {}).get("items", [])
        if items:
            return "found", items[0].get("external_urls", {}).get("spotify"), answer
        return "not_found", None, answer


PLATFORMS = {"apple": Apple, "deezer": Deezer, "spotify": Spotify}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Look up works on a platform by barcode.")
    parser.add_argument("--platform", required=True, choices=sorted(PLATFORMS))
    parser.add_argument("--label", action="append", default=[],
                        help="only works on this mili label (can be used several times)")
    parser.add_argument("--limit", type=int, default=None,
                        help="stop after this many lookups (handy for a quick test)")
    args = parser.parse_args()

    works = works_to_look_up(args.label)
    found_before, tried_before = previous_answers(args.platform)
    second_tries = deezer_barcodes() if args.platform != "deezer" else {}

    # For each work: the barcodes to try, in order, leaving out any already tried.
    to_do = []
    for work_id, mb_barcode in works:
        if work_id in found_before:
            continue
        candidates = [(mb_barcode, "musicbrainz")]
        deezer_upc = second_tries.get(work_id)
        if deezer_upc and not same_barcode(deezer_upc, mb_barcode):
            candidates.append((deezer_upc, "deezer"))
        remaining = [(b, source) for b, source in candidates
                     if b not in tried_before.get(work_id, set())]
        if remaining:
            to_do.append((work_id, remaining))
    if args.limit:
        to_do = to_do[: args.limit]

    print(f"{len(works)} works with a barcode, {len(works) - len(to_do)} already answered, "
          f"{len(to_do)} to look up on {args.platform}.")
    if not to_do:
        return
    requests_needed = sum(len(remaining) for _, remaining in to_do)
    minutes = requests_needed * SECONDS_BETWEEN_CALLS[args.platform] / 60
    estimate = "less than a minute" if minutes < 1 else f"up to about {minutes:.0f} minutes"
    print(f"This will take {estimate}. Stop anytime with Ctrl+C.\n")

    platform = PLATFORMS[args.platform]()
    out_dir = RAW_ROOT / args.platform
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.jsonl"

    counts = {"found": 0, "not_found": 0, "error": 0}
    try:
        with open(out_path, "a", encoding="utf-8") as out:
            for i, (work_id, remaining) in enumerate(to_do, start=1):
                fetched_at = datetime.now(timezone.utc).isoformat()
                tried = []
                # Try the barcodes in order; stop at the first one that is found.
                for barcode, barcode_source in remaining:
                    tried.append(barcode)
                    try:
                        status, url, answer = platform.lookup(barcode)
                    except StopForNow:
                        raise
                    except Exception as error:   # one bad lookup shouldn't stop the run
                        status, url, answer = "error", None, {"error": str(error)}
                    if status != "not_found":
                        break
                counts[status] += 1

                record = {
                    "platform": args.platform,
                    "work_id": work_id,
                    "barcode": barcode,                 # the barcode of the final answer
                    "barcode_source": barcode_source,   # musicbrainz, or deezer (second try)
                    "barcodes_tried": tried,
                    "status": status,
                    "url": url,
                    "fetched_at": fetched_at,
                    "response": answer,
                }
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()  # write it to disk now, so a stop doesn't lose it

                if i % 25 == 0 or i == len(to_do):
                    print(f"   {i}/{len(to_do)}: found {counts['found']}, "
                          f"not found {counts['not_found']}, errors {counts['error']}")
    except KeyboardInterrupt:
        print("\nStopped. Everything so far is saved; run the same command to continue.")
    except StopForNow as reason:
        print(f"\n{reason}. Everything so far is saved; run the same command later to continue.")

    print(f"\nFound {counts['found']}, not found {counts['not_found']}, errors {counts['error']}.")
    print(f"Saved to {out_path.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
