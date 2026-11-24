"""
mili: write the catalogue as JSON files for the website.

This is the last step of the pipeline:
    raw files -> bronze -> silver -> gold (dbt) -> JSON files (this script) -> website

It reads the table gold_site_objects from the DuckDB database that dbt builds
(data/mili.duckdb), and writes these files into site/data/:

    index.json          every release and mix, with what search, the atlas and
                        the garden need: id, title, artist, artist IDs, year,
                        labels, cover, genres, where it can be heard, versions
    objects/<xx>.json   everything a release page shows (listen links, buy menu,
                        versions), split into 256 small files by the first two
                        characters of the mili ID, so a page only loads one small
                        file: the release 3f9a2c81d0be is in objects/3f.json
    library.json        your library (seeds/library.csv): which objects are in it,
                        when they were added, collection or queue, and your collages
    platforms.json      the platforms, their names and their order
    meta.json           when the export was made, counts, and where the data
                        comes from

Every run replaces the files, so the website always matches the database.
JSON is a plain text format for data that every browser can read directly.

Before running: run `dbt build`.

Examples:
    python export/export_site_data.py              (small files, for the website)
    python export/export_site_data.py --pretty     (indented, easier to read)
"""

import argparse
import json
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import duckdb

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE = PROJECT_ROOT / "data" / "mili.duckdb"
OUT_DIR = PROJECT_ROOT / "site" / "data"

# the fields that go into index.json (the release pages get all of them)
INDEX_FIELDS = [
    "id", "kind", "title", "artist", "artist_ids", "type", "year",
    "labels", "cover", "genres", "availability", "versions_total",
]

SOURCES = [
    "Release data: MusicBrainz (musicbrainz.org), open data under CC0",
    "Cover images: Cover Art Archive (coverartarchive.org)",
    "Links found with Odesli (song.link), the Apple, Deezer and Spotify APIs, "
    "Discogs, and the labels' own Bandcamp pages",
]


def read_table(con, query):
    """Run a query and return the rows as a list of dictionaries."""
    result = con.execute(query)
    columns = [d[0] for d in result.description]
    return [dict(zip(columns, row)) for row in result.fetchall()]


def write_json(path, data, pretty):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        if pretty:
            json.dump(data, f, ensure_ascii=False, indent=2)
        else:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def size(path):
    """A file's size, written for people: 812 KB, 4.1 MB."""
    n = path.stat().st_size
    return f"{n / 1_000_000:.1f} MB" if n >= 1_000_000 else f"{n / 1000:.0f} KB"


def main():
    parser = argparse.ArgumentParser(description="Write the mili catalogue as JSON for the website.")
    parser.add_argument("--pretty", action="store_true", help="indent the JSON so it's easier to read")
    args = parser.parse_args()

    if not DATABASE.exists():
        sys.exit("No database found. Run `dbt build` first, then try again.")

    with duckdb.connect(str(DATABASE), read_only=True) as con:
        objects = read_table(con, "select * from gold_site_objects order by id")
        library = read_table(con, """
            select object_id as id, added_on::varchar as added_on, status, collages
            from gold_library
            order by added_on desc nulls last, object_id
        """)
        platforms = read_table(con, """
            select platform_id as id, display_name as name, listen, buy, for_releases, default_order
            from platforms
            order by default_order nulls last, platform_id
        """)

    if not objects:
        sys.exit("gold_site_objects is empty. Did `dbt build` finish without errors?")

    # Start from an empty objects folder, so releases that are gone from the
    # database don't linger in old files.
    if (OUT_DIR / "objects").exists():
        shutil.rmtree(OUT_DIR / "objects")

    # 1. index.json: the light version of every object
    index = [{field: obj[field] for field in INDEX_FIELDS} for obj in objects]
    write_json(OUT_DIR / "index.json", index, args.pretty)

    # 2. objects/<xx>.json: the full version, grouped by the first two characters of the ID
    chunks = defaultdict(dict)
    for obj in objects:
        chunks[obj["id"][:2]][obj["id"]] = obj
    for prefix, chunk in chunks.items():
        write_json(OUT_DIR / "objects" / f"{prefix}.json", chunk, args.pretty)

    # 3. library.json: the items, and each collage with the items in it
    collages = defaultdict(list)
    for item in library:
        for name in item["collages"]:
            collages[name].append(item["id"])
    write_json(OUT_DIR / "library.json", {
        "items": library,
        "collages": [{"name": name, "items": ids} for name, ids in sorted(collages.items())],
    }, args.pretty)

    # 4. platforms.json
    write_json(OUT_DIR / "platforms.json", platforms, args.pretty)

    # 5. meta.json
    kinds = defaultdict(int)
    availability = defaultdict(int)
    for obj in objects:
        kinds[obj["kind"]] += 1
        availability[obj["availability"]] += 1
    meta = {
        "exported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "objects": len(objects),
        "by_kind": dict(kinds),
        "by_availability": dict(availability),
        "library": len(library),
        "sources": SOURCES,
    }
    write_json(OUT_DIR / "meta.json", meta, args.pretty)

    print(f"Wrote {len(objects):,} objects to {OUT_DIR.relative_to(PROJECT_ROOT)}/")
    print(f"  index.json        {size(OUT_DIR / 'index.json')}")
    objects_size = sum(p.stat().st_size for p in (OUT_DIR / "objects").glob("*.json"))
    print(f"  objects/          {len(chunks)} files, {objects_size / 1_000_000:.1f} MB in all")
    print(f"  library.json      {len(library)} items, {len(collages)} collages")
    print(f"  platforms.json, meta.json")
    print("By kind:", ", ".join(f"{k} {v:,}" for k, v in sorted(kinds.items())))
    print("Where they can be heard:", ", ".join(f"{k} {v:,}" for k, v in sorted(availability.items())))


if __name__ == "__main__":
    main()
