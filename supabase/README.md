# supabase/

The live database the website reads from: a Postgres database at Supabase.

The pipeline (ingest scripts, then dbt with DuckDB) does all the work and stays
the same. This database only holds the finished tables the website needs. It's
the "serving layer".

- `schema.sql`: the tables, keys, indexes, the search function `search_objects`,
  and the rules for who may do what (the website may only read). Safe to run again.
- `../export/load_supabase.py`: runs `schema.sql`, then empties the tables and
  fills them again from DuckDB, in one transaction.

After each `dbt build`:

    python export/load_supabase.py            load
    python export/load_supabase.py --check    see what's there now

It needs `SUPABASE_DB_URL` in `.env`: the Session pooler connection string,
with the database password in it. Never commit it.
