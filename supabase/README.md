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

## The function: search outside mili

`functions/search-outside/index.ts` runs at Supabase (an Edge Function). It does two things:

- **Search:** when mili doesn't have a release, the website asks it, and it asks
  MusicBrainz, Apple Music, Deezer and Discogs at the same time, then sends back
  one list with the same releases put together.
- **Find everywhere:** from a result's Apple Music or Deezer link, it asks Odesli
  for the same release on Spotify, YouTube, YouTube Music, Tidal, Amazon Music …

It's deployed from the Supabase dashboard: Edge Functions → Deploy a new
function → Via Editor, named `search-outside`, with this file's code pasted in,
and with JWT verification turned off in the function's settings (the
publishable key isn't a JWT, so the code checks the key itself).
After changing the file, paste it in again and deploy.

It needs two secrets, set under Edge Functions → Secrets (never in the website):
`DISCOGS_TOKEN` and `ODESLI_API_KEY`, the same values as in `.env`.
