"""
mili, step 8: the songs on every MusicBrainz release.

Step 2 saved every release on the labels, but only with the number of tracks.
This script asks MusicBrainz for the songs themselves, for one edition of each
work (chosen in dbt, in silver_mb_track_releases): one request per release,
about one per second, as MusicBrainz asks.

Each answer is saved untouched, one release per line, in
    data/raw/musicbrainz/release_tracks/<run time>/releases.jsonl
and turned into a track list later, in dbt.

Releases already saved in an earlier run are skipped, so you can stop with
Ctrl+C at any time and run the same command again to carry on.
Releases in your library go first.

Before running: `dbt build --select silver_mb_track_releases`.

Examples:
    python ingest/musicbrainz_fetch_tracks.py --limit 20     (a quick test)
    caffeinate -i python ingest/musicbrainz_fetch_tracks.py   (all of them)
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from musicbrainz_client import MusicBrainz, SECONDS_BETWEEN_CALLS

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE = PROJECT_ROOT / "data" / "mili.duckdb"
RAW_ROOT = PROJECT_ROOT / "data" / "raw" / "musicbrainz" / "release_tracks"

# what MusicBrainz should include with each release: the songs ("recordings")
# and who each one is by ("artist-credits")
INCLUDE = "recordings artist-credits"


def releases_to_fetch():
    """Every chosen edition, library releases first, minus the ones already saved."""
    if not DATABASE.exists():
        sys.exit("No database found. Run `dbt build --select silver_mb_track_releases` first.")
    try:
        with duckdb.connect(str(DATABASE), read_only=True) as con:
            rows = con.execute("""
                select t.work_id, t.release_id, t.title
                from silver_mb_track_releases t
                left join gold_objects o
                    on o.work_id = t.work_id and o.identity_source = 'musicbrainz'
                left join gold_library l
                    on l.object_id = o.object_id
                order by (l.object_id is not null) desc, t.release_date desc nulls last, t.release_id
            """).fetchall()
    except duckdb.CatalogException:
        sys.exit("silver_mb_track_releases doesn't exist yet. Run "
                 "`dbt build --select silver_mb_track_releases` first.")
    except duckdb.IOException as error:
        sys.exit(f"Couldn't open the database: {error}\nIs dbt still running? Wait for it to finish.")

    done = set()
    for path in RAW_ROOT.glob("*/releases.jsonl"):
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["release_id"])
                except (json.JSONDecodeError, KeyError):
                    pass   # a line cut short when a run was stopped
    return [row for row in rows if row[1] not in done], len(rows), len(done)


def main():
    parser = argparse.ArgumentParser(description="Get the songs on every MusicBrainz release.")
    parser.add_argument("--limit", type=int, default=None, help="only this many releases (for a test)")
    args = parser.parse_args()

    todo, total, done = releases_to_fetch()
    if args.limit:
        todo = todo[: args.limit]
    print(f"{total:,} releases, {done:,} already saved, {len(todo):,} to ask MusicBrainz about.")
    if not todo:
        print("Nothing to do. Next: dbt build")
        return
    minutes = len(todo) * SECONDS_BETWEEN_CALLS / 60
    print(f"This will take about {minutes / 60:.1f} hours." if minutes > 90 else f"This will take about {max(1, round(minutes))} minutes.")
    print("Stop anytime with Ctrl+C; running it again carries on where it stopped.\n")

    mb = MusicBrainz()
    run_dir = RAW_ROOT / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True, exist_ok=True)
    found = missing = 0
    try:
        with open(run_dir / "releases.jsonl", "a", encoding="utf-8") as out:
            for i, (work_id, release_id, title) in enumerate(todo, start=1):
                answer = mb.get(f"release/{release_id}", {"inc": INCLUDE})
                if answer is None:
                    missing += 1   # not saved, so the next run tries it again
                else:
                    found += 1
                    out.write(json.dumps({
                        "work_id": work_id,
                        "release_id": release_id,
                        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        "response": answer,
                    }, ensure_ascii=False) + "\n")
                    out.flush()
                if i % 50 == 0 or i == len(todo):
                    print(f"   {i:,}/{len(todo):,}: saved {found:,}, couldn't get {missing:,}")
    except KeyboardInterrupt:
        print("\nStopped. What was saved is kept; run the same command again to carry on.")

    print(f"\nSaved {found:,}, couldn't get {missing:,}.")
    print(f"Saved to {(run_dir / 'releases.jsonl').relative_to(PROJECT_ROOT)}")
    if missing:
        print("The ones it couldn't get are tried again next time you run it.")
    print("Next: dbt build")


if __name__ == "__main__":
    main()
