"""
mili, step 2: fetch every release on each seed label from MusicBrainz.

For each label in seeds/labels.csv, this script asks MusicBrainz for all the
releases on that label, 100 at a time (each batch is called a "page"), and
saves every page untouched in one folder per run:

    data/raw/musicbrainz/label_releases/<run time>/<label>__offset-00000.json

Each release comes with:
  - title, date, country, status and barcode
  - its formats and number of tracks (vinyl, CD, digital ...)
  - its "release group": the album above all of its editions
  - the artists and the label's catalogue number
  - links to other sites, where MusicBrainz knows them
    (Bandcamp, Discogs, Spotify, Apple Music and so on)
  - genres and tags added by the MusicBrainz community (useful later for
    connecting works to each other in the atlas)

Nothing is cleaned or combined here. That happens later, in dbt.

Run it for all labels:
    python ingest/musicbrainz_fetch_releases.py

Or for just a few labels, to test first (use the name from seeds/labels.csv;
the mili_label name works too, so "AD 93" also fetches Whities):
    python ingest/musicbrainz_fetch_releases.py --label "Halcyon Veil" --label "AD 93"
"""

import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from musicbrainz_client import MusicBrainz


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SEED_FILE = PROJECT_ROOT / "seeds" / "labels.csv"
RAW_ROOT = PROJECT_ROOT / "data" / "raw" / "musicbrainz" / "label_releases"

PAGE_SIZE = 100  # the most MusicBrainz gives in one page

# The extra details we ask MusicBrainz to include with each release.
# (Separated by spaces; they travel as "+" in the web address, as MusicBrainz expects.)
INCLUDE = " ".join([
    "artist-credits",   # who the release is by
    "labels",           # label name and catalogue number
    "release-groups",   # the album that all editions belong to
    "media",            # formats (vinyl, CD, digital) and track counts
    "url-rels",         # links to Bandcamp, Discogs, streaming services ...
    "release-group-level-rels",  # also the album's own links, e.g. the main
                                 # Discogs page ("master") for all editions
    "genres",           # genres the MusicBrainz community has voted on
    "tags",             # freer descriptive tags added by the community
])


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def slugify(name):
    """Turn a label name into a safe file name, e.g. 'RVNG Intl.' -> 'rvng-intl'."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def read_seed_labels():
    """Read seeds/labels.csv and return the rows as a list of dictionaries."""
    with open(SEED_FILE, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def choose_labels(seeds, wanted_names):
    """
    Decide which labels to fetch. With no --label given, that's all of them.
    Otherwise, labels whose label_name or mili_label matches one of the names.
    """
    with_id = [row for row in seeds if (row.get("musicbrainz_id") or "").strip()]
    missing_id = [row["label_name"] for row in seeds if row not in with_id]
    if missing_id:
        print(f"Skipping labels with no MusicBrainz ID yet: {', '.join(missing_id)}\n")

    if not wanted_names:
        return with_id

    wanted = {name.strip().lower() for name in wanted_names}
    chosen = [row for row in with_id
              if row["label_name"].strip().lower() in wanted
              or (row.get("mili_label") or "").strip().lower() in wanted]

    found = {row["label_name"].strip().lower() for row in chosen} | \
            {(row.get("mili_label") or "").strip().lower() for row in chosen}
    for name in wanted - found:
        print(f"Note: no label called '{name}' in seeds/labels.csv")
    return chosen


def save_page(run_dir, label_row, params, answer, fetched_at):
    """Save one page exactly as it came back, with a note of how we asked."""
    offset = params["offset"]
    path = run_dir / f"{slugify(label_row['label_name'])}__offset-{offset:05d}.json"
    record = {
        "source": "musicbrainz",
        "endpoint": "release",
        "request_params": params,
        "label_name": label_row["label_name"],
        "label_mbid": label_row["musicbrainz_id"].strip(),
        "mili_label": label_row.get("mili_label") or label_row["label_name"],
        "fetched_at": fetched_at.isoformat(),
        "response": answer,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False)
    return path


# ---------------------------------------------------------------------------
# Fetching one label, page by page
# ---------------------------------------------------------------------------

def fetch_label(mb, run_dir, label_row):
    """
    Fetch all releases for one label. Returns a small summary dictionary.

    MusicBrainz tells us the total ('release-count') in every answer. We keep
    asking for the next page until we have them all. A page can hold fewer
    than 100 releases (MusicBrainz caps each page at 500 tracks), so we move
    forward by the number of releases we actually got back.
    """
    mbid = label_row["musicbrainz_id"].strip()
    offset = 0
    total = None
    pages = 0
    saved = 0

    while True:
        params = {"label": mbid, "inc": INCLUDE, "limit": PAGE_SIZE, "offset": offset}
        fetched_at = datetime.now(timezone.utc)
        answer = mb.get("release", params)

        if answer is None:
            return {"label": label_row["label_name"], "total": total, "saved": saved,
                    "pages": pages, "complete": False}

        save_page(run_dir, label_row, params, answer, fetched_at)
        pages += 1

        releases = answer.get("releases", [])
        total = answer.get("release-count", 0)
        saved += len(releases)
        offset += len(releases)

        if pages == 1:
            print(f"   {total} releases in MusicBrainz")
        print(f"   page {pages}: got {len(releases)} (saved {saved} of {total})")

        if not releases or offset >= total:
            break

    return {"label": label_row["label_name"], "total": total, "saved": saved,
            "pages": pages, "complete": saved >= total}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Fetch releases for the seed labels.")
    parser.add_argument("--label", action="append", default=[],
                        help="only fetch this label (can be used several times)")
    args = parser.parse_args()

    labels = choose_labels(read_seed_labels(), args.label)
    if not labels:
        print("No labels to fetch.")
        return

    started_at = datetime.now(timezone.utc)
    run_dir = RAW_ROOT / started_at.strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"Fetching releases for {len(labels)} labels into "
          f"{run_dir.relative_to(PROJECT_ROOT)}\n")

    mb = MusicBrainz()
    summaries = []
    for i, label_row in enumerate(labels, start=1):
        print(f"[{i}/{len(labels)}] {label_row['label_name']}")
        summaries.append(fetch_label(mb, run_dir, label_row))

    # A small record of the run itself, saved next to the pages.
    # Useful later for loading, and for describing the data in your report.
    run_info = {
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "include": INCLUDE,
        "labels": summaries,
    }
    with open(run_dir / "_run_info.json", "w", encoding="utf-8") as f:
        json.dump(run_info, f, ensure_ascii=False, indent=2)

    # Summary on screen
    total_saved = sum(s["saved"] for s in summaries)
    incomplete = [s["label"] for s in summaries if not s["complete"]]
    print(f"\nDone. Saved {total_saved} releases for {len(summaries)} labels.")
    if incomplete:
        print(f"Not complete (MusicBrainz was busy): {', '.join(incomplete)}. "
              f"Run again with --label for those.")


if __name__ == "__main__":
    main()
