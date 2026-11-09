"""
mili, step 1: find each seed label in MusicBrainz.

What this script does, for every label in seeds/labels.csv that has no
MusicBrainz ID yet:

  1. Asks MusicBrainz: "which labels match this name?"
  2. Saves MusicBrainz's full answer, untouched, as a file in
     data/raw/musicbrainz/label_search/  (this is the bronze / raw layer)
  3. Writes the best few matches to data/review/label_candidates.csv,
     so you can check them by eye and pick the right one.

You then copy the right ID into the musicbrainz_id column of
seeds/labels.csv. Next time you run the script, labels that already
have an ID are skipped.

How to run it (from the project folder, with the virtual environment on):
    python ingest/musicbrainz_find_labels.py
"""

import csv
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

# The project folder is one level up from this file (ingest/ -> mili/).
PROJECT_ROOT = Path(__file__).resolve().parent.parent

SEED_FILE = PROJECT_ROOT / "seeds" / "labels.csv"
RAW_DIR = PROJECT_ROOT / "data" / "raw" / "musicbrainz" / "label_search"
REVIEW_FILE = PROJECT_ROOT / "data" / "review" / "label_candidates.csv"

MB_SEARCH_URL = "https://musicbrainz.org/ws/2/label"
MATCHES_PER_LABEL = 5        # how many possible matches to keep for review
SECONDS_BETWEEN_CALLS = 1.1  # MusicBrainz allows about one request per second
MAX_TRIES = 5                # how many times to try if MusicBrainz is busy
LONGEST_WAIT = 60            # never wait more than this many seconds between tries


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def slugify(name):
    """Turn a label name into a safe file name, e.g. 'RVNG Intl.' -> 'rvng-intl'."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower())
    return slug.strip("-")


def read_seed_labels():
    """Read seeds/labels.csv and return the rows as a list of dictionaries."""
    # 'utf-8-sig' also copes with the hidden marker some spreadsheet apps add.
    with open(SEED_FILE, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def make_session():
    """
    Prepare a 'session' (a reusable connection) that introduces mili to
    MusicBrainz. MusicBrainz asks every app to send a User-Agent: the app's
    name, version and a way to contact the person running it.
    """
    load_dotenv(PROJECT_ROOT / ".env")
    contact = os.getenv("MB_CONTACT", "").strip()
    if not contact:
        sys.exit(
            "MB_CONTACT is missing. Copy .env.example to .env and add your "
            "email or GitHub link after MB_CONTACT="
        )

    session = requests.Session()
    session.headers["User-Agent"] = f"mili/0.1 ( {contact} )"
    session.headers["Accept"] = "application/json"
    return session


# ---------------------------------------------------------------------------
# Talking to MusicBrainz
# ---------------------------------------------------------------------------

def ask_musicbrainz(session, query):
    """
    Send one search to MusicBrainz. If it is busy, wait and try again,
    waiting a little longer each time (5, 10, 20, 40 seconds).

    Returns (params, answer) if it worked, or (params, None) if it kept failing.
    """
    params = {"query": query, "fmt": "json", "limit": MATCHES_PER_LABEL}

    for attempt in range(1, MAX_TRIES + 1):
        try:
            response = session.get(MB_SEARCH_URL, params=params, timeout=30)
            if response.status_code == 200:
                return params, response.json()
            problem = f"MusicBrainz answered {response.status_code}"
            # MusicBrainz sometimes says how long to wait in a 'Retry-After' header.
            suggested_wait = response.headers.get("Retry-After", "")
        except requests.RequestException as error:
            problem = f"connection problem ({error.__class__.__name__})"
            suggested_wait = ""

        if attempt == MAX_TRIES:
            print(f"   {problem}. Giving up on this one for now.")
            return params, None

        wait = int(suggested_wait) if suggested_wait.isdigit() else 5 * 2 ** (attempt - 1)
        wait = min(wait, LONGEST_WAIT)
        print(f"   {problem}, waiting {wait} seconds before try {attempt + 1}...")
        time.sleep(wait)


def search_label(session, name):
    """
    Look for a label by name. First an exact search on the name (and its
    alternative names, called 'aliases'). If that finds nothing, try again
    more loosely, using just the words in the name. For example 'STROOM.tv'
    becomes a search for 'STROOM' or 'tv', which you then check by eye.
    """
    params, answer = ask_musicbrainz(session, f'label:"{name}" OR alias:"{name}"')

    if answer is not None and not answer.get("labels"):
        words = " ".join(re.findall(r"[A-Za-z0-9]+", name))
        print(f"   no exact match, trying a looser search for: {words}")
        time.sleep(SECONDS_BETWEEN_CALLS)
        params, answer = ask_musicbrainz(session, f"label:({words}) OR alias:({words})")

    return params, answer


def save_raw(name, params, answer, fetched_at):
    """
    Save the full answer exactly as it came back, plus a note of when and
    how we asked. Nothing is cleaned or removed here.
    """
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    stamp = fetched_at.strftime("%Y%m%dT%H%M%SZ")
    path = RAW_DIR / f"{slugify(name)}__{stamp}.json"

    record = {
        "source": "musicbrainz",
        "endpoint": MB_SEARCH_URL,
        "request_params": params,
        "seed_label_name": name,
        "fetched_at": fetched_at.isoformat(),
        "response": answer,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
    return path


def candidate_rows(name, answer):
    """Pick out the few fields we need to judge each possible match."""
    rows = []
    for rank, label in enumerate(answer.get("labels", []), start=1):
        life_span = label.get("life-span") or {}
        rows.append({
            "seed_name": name,
            "rank": rank,
            "score": label.get("score", ""),
            "mb_name": label.get("name", ""),
            "disambiguation": label.get("disambiguation", ""),
            "type": label.get("type", ""),
            "country": label.get("country", ""),
            "founded": life_span.get("begin", ""),
            "musicbrainz_id": label.get("id", ""),
            "check_on_web": f"https://musicbrainz.org/label/{label.get('id', '')}",
        })
    return rows


# ---------------------------------------------------------------------------
# Main: run the steps for every label
# ---------------------------------------------------------------------------

def main():
    seeds = read_seed_labels()
    to_search = [row for row in seeds if not (row.get("musicbrainz_id") or "").strip()]

    if not to_search:
        print("Every label in seeds/labels.csv already has a MusicBrainz ID. Nothing to do.")
        return

    print(f"Searching MusicBrainz for {len(to_search)} labels "
          f"(about {len(to_search) * SECONDS_BETWEEN_CALLS:.0f} seconds)...\n")

    session = make_session()
    all_candidates = []
    not_found = []   # MusicBrainz answered, but had no matching label
    failed = []      # MusicBrainz was too busy, try these again later

    for i, row in enumerate(to_search, start=1):
        name = row["label_name"].strip()
        print(f"[{i}/{len(to_search)}] {name}")

        fetched_at = datetime.now(timezone.utc)
        params, answer = search_label(session, name)

        if answer is None:
            failed.append(name)
            time.sleep(SECONDS_BETWEEN_CALLS)
            continue  # move on to the next label instead of stopping

        raw_path = save_raw(name, params, answer, fetched_at)
        rows = candidate_rows(name, answer)
        all_candidates.extend(rows)

        if rows:
            best = rows[0]
            print(f"   best match: {best['mb_name']} "
                  f"({best['country'] or 'no country'}, score {best['score']})")
        else:
            not_found.append(name)
            print("   no matches found")
        print(f"   saved raw answer to {raw_path.relative_to(PROJECT_ROOT)}")

        time.sleep(SECONDS_BETWEEN_CALLS)  # be polite: one request per second

    # Write the review file (replaced each time the script runs).
    REVIEW_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(REVIEW_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(all_candidates[0].keys())
                                if all_candidates else ["seed_name"])
        writer.writeheader()
        writer.writerows(all_candidates)

    # A short summary, so you can see at a glance what needs attention.
    found = len(to_search) - len(not_found) - len(failed)
    print(f"\nDone. Found possible matches for {found} of {len(to_search)} labels.")
    if not_found:
        print(f"No match in MusicBrainz: {', '.join(not_found)}")
    if failed:
        print(f"MusicBrainz was too busy for: {', '.join(failed)} (just run the script again later)")
    print(f"\nOpen {REVIEW_FILE.relative_to(PROJECT_ROOT)} to choose the right match "
          f"for each label,\nthen paste its musicbrainz_id into seeds/labels.csv.")


if __name__ == "__main__":
    main()
