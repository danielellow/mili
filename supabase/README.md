# supabase/

The live database the website reads from: a Postgres database at Supabase.

The pipeline (ingest scripts, then dbt with DuckDB) does all the work and stays
the same. This database only holds the finished tables the website needs. It's
the "serving layer".

- `schema.sql`: the tables, keys, indexes, the search function `search_objects`,
  and the rules for who may do what (the website may only read). Safe to run again.
- `user_data.sql`: the notes and collages people make on the site, and who may
  read and write them. The loader never empties these. Safe to run again.
- `../export/load_supabase.py`: runs both files, then empties the catalogue
  tables and fills them again from DuckDB, in one transaction.

After each `dbt build`:

    python export/load_supabase.py            load
    python export/load_supabase.py --check    see what's there now

It needs `SUPABASE_DB_URL` in `.env`: the Session pooler connection string,
with the database password in it. Never commit it.

## The function: search outside mili

`functions/search-outside/index.ts` runs at Supabase (an Edge Function). It does three things:

- **Search:** when mili doesn't have a release, the website asks it, and it asks
  MusicBrainz, Apple Music, Deezer and Discogs at the same time, then sends back
  one list with the same releases put together. It also asks Mixcloud for DJ
  mixes and radio shows (NTS archives every show there), as a second list.
- **Find everywhere:** from a result's Apple Music or Deezer link, it asks Odesli
  for the same release on Spotify, YouTube, YouTube Music, Tidal, Amazon Music …
- **A mix:** from a pasted SoundCloud, Mixcloud or NTS link, it says what the mix
  is (title, DJ, artwork, date, length) and where else it can be heard. The
  same lookups as `ingest/lookup_mixes.py`; none of them needs a key.

It's deployed from the Supabase dashboard: Edge Functions → Deploy a new
function → Via Editor, named `search-outside`, with this file's code pasted in,
and with JWT verification turned off in the function's settings (the
publishable key isn't a JWT, so the code checks the key itself).
After changing the file, paste it in again and deploy.

It needs two secrets, set under Edge Functions → Secrets (never in the website):
`DISCOGS_TOKEN` and `ODESLI_API_KEY`, the same values as in `.env`.

## Notes, collages and signing in

Notes and collages are written from the website, so they live in tables of
their own (`user_data.sql`): `notes`, `collages` and `collage_items`. A thing
can have several notes, and an item in a collage can have notes of its own
(about = `collage:<collage id>:<mili ID>`). Covers people upload for their
collages go in a public Storage bucket, `covers`, in a folder per person; the
loader makes it, and says so if it can't (then: Storage → New bucket → `covers`,
public, and run the loader again). Row level
security decides who sees what. Anyone can read public notes and collages.
Only the person who made something can change it, and only they see it when
it's private. Postgres checks this on every request, whatever the website asks.

Signing in uses Supabase Auth with an email and a password. Accounts are made by
hand, so no one can sign themselves up:

1. Authentication → Sign In / Providers: keep **Email** on, and turn off
   **Allow new users to sign up**.
2. Authentication → Users → **Add user** → Create new user: an email and a
   password, with **Auto Confirm User** ticked. Make one for yourself, and one
   for anyone who should test it.
3. Sign in on the website: the menu → sign in.

The tables don't point to `objects` with a foreign key on purpose: the loader
empties `objects` with "cascade", which would empty them too. A mili ID stays
the same on every rebuild, so notes and collages keep pointing to the right
release.
