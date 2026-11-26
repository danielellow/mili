"""
mili, step 9: the songs on releases that MusicBrainz doesn't know.

MusicBrainz gives the songs for the catalogue (step 8). Releases that came
from somewhere else, mostly your Bandcamp purchases, don't have that, but many
of them are on Apple Music (found by Odesli or the Apple name search). Apple's
public lookup gives the songs on an album:
    https://itunes.apple.com/lookup?id=<album id>&entity=song

This asks for every release that isn't from MusicBrainz, has an Apple Music
album link, and isn't a single track, at Apple's slow pace (one request
every 3 seconds or so). Answers are saved untouched, in
    data/raw/apple_tracks/<run time>/albums.jsonl
and turned into track lists in dbt. Albums already saved are skipped.

Before running: `dbt build`.

Examples:
    python ingest/lookup_apple_tracks.py --limit 5      (a quick test)
    python ingest/lookup_apple_tracks.py                (all of them)
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from lookup_platforms_by_barcode import Apple, APPLE_COUNTRY, SECONDS_BETWEEN_CALLS

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE = PROJECT_ROOT / "data" / "mili.duckdb"
RAW_ROOT = PROJECT_ROOT / "data" / "raw" / "apple_tracks"


def album_id(url):
    """The album's number in an Apple Music link, e.g. .../album/radical-frame/1812345678.
    A link to one song (with ?i=) isn't an album, so it gives None."""
    if not url or "?i=" in url:
        return None
    found = re.search(r"/album/(?:[^/?]+/)?(\d+)", url)
    return found.group(1) if found else None


def albums_to_fetch():
    if not DATABASE.exists():
        sys.exit("No database found. Run `dbt build` first.")
    try:
        with duckdb.connect(str(DATABASE), read_only=True) as con:
            rows = con.execute("""
                select o.object_id, o.title, l.url
                from gold_objects o
                join gold_listen_options l
                    on l.object_id = o.object_id and l.platform_id = 'apple_music'
                left join gold_library lib
                    on lib.object_id = o.object_id
                where o.identity_source <> 'musicbrainz'
                  and o.kind = 'release'
                  and coalesce(o.work_type, '') not in ('track', 'single')
                order by (lib.object_id is not null) desc, o.object_id
            """).fetchall()
    except duckdb.IOException as error:
        sys.exit(f"Couldn't open the database: {error}\nIs dbt still running? Wait for it to finish.")

    wanted = [(object_id, title, album_id(url)) for object_id, title, url in rows]
    wanted = [row for row in wanted if row[2]]

    done = set()
    for path in RAW_ROOT.glob("*/albums.jsonl"):
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    record = json.loads(line)
                    done.add((record["object_id"], record["album_id"]))
                except (json.JSONDecodeError, KeyError):
                    pass
    return [row for row in wanted if (row[0], row[2]) not in done], len(wanted)


def main():
    parser = argparse.ArgumentParser(description="Get the songs on releases from Apple Music.")
    parser.add_argument("--limit", type=int, default=None, help="only this many albums (for a test)")
    args = parser.parse_args()

    todo, total = albums_to_fetch()
    if args.limit:
        todo = todo[: args.limit]
    print(f"{total:,} releases with an Apple Music album link, {len(todo):,} to ask Apple about.")
    if not todo:
        print("Nothing to do. Next: dbt build")
        return
    minutes = len(todo) * SECONDS_BETWEEN_CALLS["apple"] / 60
    n = max(1, round(minutes))
    print(f"This will take about {n} minute{'s' if n != 1 else ''}. Stop anytime with Ctrl+C.\n")

    apple = Apple()
    run_dir = RAW_ROOT / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True, exist_ok=True)
    found = not_found = errors = 0
    try:
        with open(run_dir / "albums.jsonl", "a", encoding="utf-8") as out:
            for i, (object_id, title, apple_id) in enumerate(todo, start=1):
                try:
                    response = apple.get("https://itunes.apple.com/lookup",
                                         params={"id": apple_id, "entity": "song",
                                                 "country": APPLE_COUNTRY, "limit": 200})
                    answer = response.json()
                except Exception as error:   # keep going; it's tried again next run
                    errors += 1
                    print(f"   {title}: {error}")
                    continue
                songs = [r for r in answer.get("results", []) if r.get("wrapperType") == "track"]
                if songs:
                    found += 1
                else:
                    not_found += 1
                out.write(json.dumps({
                    "object_id": object_id,
                    "album_id": apple_id,
                    "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "response": answer,
                }, ensure_ascii=False) + "\n")
                out.flush()
                if i % 25 == 0 or i == len(todo):
                    print(f"   {i:,}/{len(todo):,}: with songs {found:,}, without {not_found:,}, errors {errors:,}")
    except KeyboardInterrupt:
        print("\nStopped. What was saved is kept; run the same command again to carry on.")

    print(f"\nWith songs {found:,}, without {not_found:,}, errors {errors:,}.")
    print(f"Saved to {(run_dir / 'albums.jsonl').relative_to(PROJECT_ROOT)}")
    print("Next: dbt build")


if __name__ == "__main__":
    main()
