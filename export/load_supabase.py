"""Copy mili's finished tables from DuckDB into Supabase (Postgres).

The pipeline builds everything in data/mili.duckdb. This script copies the
tables the website needs into the live Postgres database at Supabase, which
the website reads from. Run it after `dbt build`, like the JSON export:

    python export/load_supabase.py            set up the database and load it
    python export/load_supabase.py --check    only show what's in Supabase now

How it works:
  1. Reads the gold tables from DuckDB and checks them: every ID has to be
     unique, and every link has to belong to an object that exists.
  2. Connects to Supabase with SUPABASE_DB_URL from .env.
  3. Runs supabase/schema.sql, which creates the tables, indexes, the search
     function and the read-only rules the first time (and changes nothing
     after that).
  4. Empties the tables and fills them again, all in one transaction. A
     transaction is all or nothing: if anything goes wrong halfway, Postgres
     undoes it, and the website keeps showing the data from the last load.
  5. Writes a line in load_log with the time and the number of rows.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import duckdb
from dotenv import load_dotenv

try:
    import psycopg
except ImportError:
    sys.exit('psycopg isn\'t installed yet. Run:  pip install "psycopg[binary]"')

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DUCKDB_FILE = PROJECT_ROOT / "data" / "mili.duckdb"
SCHEMA_FILE = PROJECT_ROOT / "supabase" / "schema.sql"

# Each Postgres table, its key, and the DuckDB query that fills it.
# The column names in each query match the table in schema.sql.
TABLES = [
    {
        "name": "objects",
        "key": "id",
        "query": """
            select id, kind, title, artist, artist_ids, type, year, labels, cover, genres,
                   bandcamp_page, availability, cast(versions_total as integer) as versions_total
            from gold_site_objects
        """,
    },
    {
        "name": "listen_options",
        "key": "listen_option_id",
        "query": """
            select listen_option_id, object_id, platform_id, display_name, url, confidence,
                   version_id, version_label, cast(menu_order as integer) as menu_order
            from gold_listen_options
        """,
    },
    {
        "name": "buy_options",
        "key": "buy_option_id",
        "query": """
            select buy_option_id, object_id, platform_id, display_name, url, link_kind,
                   cast(menu_order as integer) as menu_order
            from gold_buy_options
        """,
    },
    {
        "name": "object_versions",
        "key": "version_id",
        "query": """
            select version_id, object_id, version_key, version_label, display_title,
                   cast(platforms as integer) as platforms, cast(links as integer) as links,
                   is_main, maybe_another_release
            from gold_object_versions
        """,
    },
    {
        "name": "object_instances",
        "key": "instance_id",
        "query": """
            select instance_id, object_id, version_id, platform_id, url, title_seen,
                   sources, methods, confidence, maybe_another_release
            from gold_object_instances
        """,
    },
    {
        "name": "library",
        "key": "object_id",
        "query": "select object_id, added_on, status, collages from gold_library",
    },
    {
        "name": "labels",
        "key": "label",
        "query": """
            select label, slug, image, image_source, bandcamp_url,
                   cast(objects as integer) as objects, position
            from gold_labels
        """,
    },
    {
        "name": "platforms",
        "key": "platform_id",
        "query": """
            select platform_id, display_name, listen, buy,
                   cast(default_order as integer) as default_order, for_releases
            from platforms
        """,
    },
]


def database_url():
    load_dotenv(PROJECT_ROOT / ".env")
    url = os.getenv("SUPABASE_DB_URL", "").strip()
    if not url:
        sys.exit("SUPABASE_DB_URL is missing from .env. Add the Session pooler connection string from Supabase "
                 "(Connect, at the top of the project page).")
    if "[YOUR-PASSWORD]" in url:
        sys.exit("SUPABASE_DB_URL still says [YOUR-PASSWORD]. Replace it, brackets included, with your database password.")
    return url


def connect(url):
    try:
        return psycopg.connect(url, connect_timeout=20, application_name="mili loader")
    except psycopg.OperationalError as error:
        # the message names the server but never the password
        sys.exit(f"Couldn't connect to Supabase:\n  {str(error).strip()}\n"
                 "Check SUPABASE_DB_URL in .env (the Session pooler string, with your password in it), "
                 "and that the project isn't paused.")


def read_from_duckdb():
    """Read every table from DuckDB, and check the keys and links before loading."""
    try:
        con = duckdb.connect(str(DUCKDB_FILE), read_only=True)
    except duckdb.IOException as error:
        sys.exit(f"Couldn't open {DUCKDB_FILE.name}: {error}\nIs dbt still running? Wait for it to finish.")

    data = {}
    with con:
        for table in TABLES:
            result = con.execute(table["query"])
            columns = [d[0] for d in result.description]
            rows = result.fetchall()
            key = columns.index(table["key"])
            if len({row[key] for row in rows}) != len(rows):
                sys.exit(f"{table['name']}: {table['key']} isn't unique, so it can't be the key. "
                         "Nothing was loaded. Check the gold model in dbt.")
            data[table["name"]] = {"columns": columns, "rows": rows}

    # Links have to belong to an object that's being loaded. Any that don't are
    # left out and counted, so the load doesn't fail on a few loose rows.
    object_ids = {row[0] for row in data["objects"]["rows"]}
    skipped = {}
    for name, table in data.items():
        if name in ("objects", "platforms", "labels"):
            continue
        at = table["columns"].index("object_id")
        kept = [row for row in table["rows"] if row[at] in object_ids]
        if len(kept) < len(table["rows"]):
            skipped[name] = len(table["rows"]) - len(kept)
        table["rows"] = kept
    return data, skipped


def load(conn, data):
    with conn.cursor() as cur:
        cur.execute("set client_min_messages = warning")

        # 1. Set the database up (only does something the first time)
        cur.execute(SCHEMA_FILE.read_text())
        conn.commit()

        # 2. Empty and refill, in one transaction
        started = time.monotonic()
        # Emptying objects also empties every table that points to it.
        cur.execute("truncate public.objects, public.platforms, public.labels cascade")
        for name, table in data.items():
            columns = ", ".join(table["columns"])
            with cur.copy(f"copy public.{name} ({columns}) from stdin") as copy:
                for row in table["rows"]:
                    copy.write_row(row)
        counts = {name: len(table["rows"]) for name, table in data.items()}
        seconds = round(time.monotonic() - started, 1)
        cur.execute("insert into public.load_log (rows, seconds) values (%s, %s)", (json.dumps(counts), seconds))
        conn.commit()

        # 3. Tell Postgres to update its statistics, so it plans searches well
        conn.autocommit = True
        cur.execute("analyze public.objects, public.listen_options, public.buy_options, "
                    "public.object_versions, public.object_instances, public.library, public.platforms, public.labels")
    return counts, seconds


def show(conn):
    with conn.cursor() as cur:
        cur.execute("select to_regclass('public.objects') is not null")
        if not cur.fetchone()[0]:
            print("Supabase is connected, but nothing has been loaded yet.")
            return
        print("In Supabase now:")
        for table in TABLES + [{"name": "load_log"}]:
            cur.execute(f"select count(*) from public.{table['name']}")
            print(f"  {table['name']:<18} {cur.fetchone()[0]:>8,}")
        cur.execute("select loaded_at, seconds from public.load_log order by load_id desc limit 1")
        last = cur.fetchone()
        if last:
            print(f"\nLast load: {last[0]:%Y-%m-%d %H:%M} UTC, took {last[1]} seconds.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="only show what's in Supabase now")
    args = parser.parse_args()

    url = database_url()
    if args.check:
        with connect(url) as conn:
            show(conn)
        return

    print("Reading the gold tables from DuckDB…")
    data, skipped = read_from_duckdb()
    for name, n in skipped.items():
        print(f"  {name}: left out {n:,} rows whose object isn't in gold_site_objects")

    print("Loading into Supabase…")
    with connect(url) as conn:
        counts, seconds = load(conn, data)

    print()
    for name, n in counts.items():
        print(f"  {name:<18} {n:>8,} rows")
    print(f"\nDone in {seconds} seconds. Try it in Supabase's SQL Editor:")
    print("  select title, artist, year from search_objects('wind');")


if __name__ == "__main__":
    main()
