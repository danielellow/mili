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
                        versions, the songs, Bandcamp's player), split into 256 small files by the first two
                        characters of the mili ID, so a page only loads one small
                        file: the release 3f9a2c81d0be is in objects/3f.json
    library.json        your library (seeds/library.csv): which objects are in it,
                        when they were added, collection or queue, and your collages
    platforms.json      the platforms, their names and their order
    labels.json         the labels, in your order, with their pictures
    supabase.json       where the live database is, for live search: the
                        project address and the publishable key from .env
                        (both are meant to be public; the secret key never is)
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
import base64
import json
import os
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import duckdb
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE = PROJECT_ROOT / "data" / "mili.duckdb"
OUT_DIR = PROJECT_ROOT / "site" / "data"

# the fields that go into index.json (the release pages get all of them)
INDEX_FIELDS = [
    "id", "kind", "title", "artist", "artist_ids", "type", "year",
    "labels", "cover", "genres", "availability", "versions_total", "bandcamp_page",
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


def supabase_settings():
    """The project address and publishable key from .env, checked so that a
    secret key can never end up in the website by mistake."""
    load_dotenv(PROJECT_ROOT / ".env")
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
    if not url or not key:
        return None, "SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY isn't in .env, so the site searches in the browser"
    if key.startswith("sb_secret_"):
        sys.exit("SUPABASE_PUBLISHABLE_KEY in .env is a secret key (sb_secret_…). That one must never go in "
                 "the website. Put the publishable key (sb_publishable_…) there instead. Nothing was written.")
    if key.count(".") == 2:
        # an older kind of key: a token whose middle part says which role it is
        try:
            middle = key.split(".")[1]
            role = json.loads(base64.urlsafe_b64decode(middle + "=" * (-len(middle) % 4))).get("role")
        except Exception:
            role = None
        if role != "anon":
            sys.exit("SUPABASE_PUBLISHABLE_KEY in .env isn't the publishable (anon) key. Nothing was written.")
    if not url.startswith("https://"):
        sys.exit("SUPABASE_URL in .env should start with https:// (the Project URL from Supabase).")
    return {"url": url, "key": key}, f"live search through {url}"


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

    # checked first, so a wrong key stops the export before anything is written
    supabase, supabase_note = supabase_settings()

    with duckdb.connect(str(DATABASE), read_only=True) as con:
        objects = read_table(con, "select * from gold_site_objects order by id")
        library = read_table(con, """
            select object_id as id, added_on::varchar as added_on, status, collages
            from gold_library
            order by added_on desc nulls last, object_id
        """)
        tracks = read_table(con, """
            select object_id, disc, number, title, artist, length_ms
            from gold_object_tracks
            order by object_id, track_no
        """)
        players = dict(con.execute("select object_id, embed from gold_bandcamp_players").fetchall())
        labels = read_table(con, """
            select label as name, slug, image, bandcamp_url as page, objects
            from gold_labels
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

    # 2. objects/<xx>.json: the full version, grouped by the first two characters of the ID,
    #    with the songs (when we know them) and Bandcamp's player (when there are none)
    songs = defaultdict(list)
    for track in tracks:
        songs[track.pop("object_id")].append(track)
    chunks = defaultdict(dict)
    for obj in objects:
        obj["tracks"] = songs.get(obj["id"], [])
        obj["bandcamp_player"] = None if obj["tracks"] else players.get(obj["id"])
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

    # 4. platforms.json and labels.json (the labels in your order, with their pictures)
    write_json(OUT_DIR / "platforms.json", platforms, args.pretty)
    write_json(OUT_DIR / "labels.json", labels, args.pretty)

    # 5. supabase.json, for live search (removed if .env doesn't have the settings)
    if supabase:
        write_json(OUT_DIR / "supabase.json", supabase, args.pretty)
    elif (OUT_DIR / "supabase.json").exists():
        (OUT_DIR / "supabase.json").unlink()

    # 6. meta.json
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
    with_songs = sum(1 for obj in objects if obj["tracks"])
    with_player = sum(1 for obj in objects if obj["bandcamp_player"])
    print(f"  songs             {len(tracks):,} songs on {with_songs:,} releases; "
          f"Bandcamp's player on {with_player:,} more")
    with_pictures = sum(1 for label in labels if label["image"])
    print(f"  labels.json       {len(labels)} labels, {with_pictures} with a picture")
    print(f"  platforms.json, meta.json")
    print(f"  supabase.json     {supabase_note}" if supabase else f"  (no supabase.json: {supabase_note})")
    print("By kind:", ", ".join(f"{k} {v:,}" for k, v in sorted(kinds.items())))
    print("Where they can be heard:", ", ".join(f"{k} {v:,}" for k, v in sorted(availability.items())))


if __name__ == "__main__":
    main()
