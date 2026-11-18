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

How to run it (from the project folder, with the mili environment on):
    python ingest/musicbrainz_find_labels.py
"""

import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from musicbrainz_client import MusicBrainz


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

# The project folder is one level up from this file (ingest/ -> mili/).
PROJECT_ROOT = Path(__file__).resolve().parent.parent

SEED_FILE = PROJECT_ROOT / "seeds" / "labels.csv"
RAW_DIR = PROJECT_ROOT / "data" / "raw" / "musicbrainz" / "label_search"
REVIEW_FILE = PROJECT_ROOT / "data" / "review" / "label_candidates.csv"

MATCHES_PER_LABEL = 5  # how many possible matches to keep for review


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


# ---------------------------------------------------------------------------
# Searching
# ---------------------------------------------------------------------------

def search_label(mb, name):
    """
    Look for a label by name. First an exact search on the name (and its
    alternative names, called 'aliases'). If that finds nothing, try again
    more loosely, using just the words in the name. For example 'STROOM.tv'
    becomes a search for 'STROOM' or 'tv', which you then check by eye.

    Returns (params, answer). answer is None if MusicBrainz kept failing.
    """
    params = {"query": f'label:"{name}" OR alias:"{name}"', "limit": MATCHES_PER_LABEL}
    answer = mb.get("label", params)

    if answer is not None and not answer.get("labels"):
        words = " ".join(re.findall(r"[A-Za-z0-9]+", name))
        print(f"   no exact match, trying a looser search for: {words}")
        params = {"query": f"label:({words}) OR alias:({words})", "limit": MATCHES_PER_LABEL}
        answer = mb.get("label", params)

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
        "endpoint": "label",
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

    print(f"Searching MusicBrainz for {len(to_search)} labels...\n")

    mb = MusicBrainz()
    all_candidates = []
    not_found = []   # MusicBrainz answered, but had no matching label
    failed = []      # MusicBrainz was too busy, try these again later

    for i, row in enumerate(to_search, start=1):
        name = row["label_name"].strip()
        print(f"[{i}/{len(to_search)}] {name}")

        fetched_at = datetime.now(timezone.utc)
        params, answer = search_label(mb, name)

        if answer is None:
            failed.append(name)
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
