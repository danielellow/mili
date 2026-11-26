-- mili in Supabase: the live database the website reads from.
--
-- The pipeline (Python + dbt + DuckDB) stays where all the work happens.
-- This database is the "serving layer": it only holds the finished tables the
-- website needs, copied in by export/load_supabase.py after each pipeline run.
--
-- This file sets the database up: tables, keys, indexes, a search function,
-- and the rules for who may do what. It's safe to run again; anything that
-- already exists is left as it is. load_supabase.py runs it before every load.
--
-- Who may do what:
--   * The website uses the publishable key, which acts as the role "anon".
--     anon may READ the tables below and call search_objects(). Nothing else.
--   * The loader logs in as "postgres" (the database owner) and may do anything.
--   * Row Level Security (RLS) is turned on for every table, with one rule:
--     "anyone may read". With RLS on, anything without a rule is refused, so
--     the website can never add, change or delete rows.


-- ---------------------------------------------------------------------------
-- Extensions: add-ons that come with Postgres
--   pg_trgm   compares text in three-letter pieces, so "aphex twn" still
--             finds "Aphex Twin"
--   unaccent  turns "Björk" into "bjork" before comparing
-- ---------------------------------------------------------------------------

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;


-- Text cleaned up the same way the website does it: no accents, lower case,
-- anything that isn't a letter or digit becomes a space.
create or replace function public.mili_normalize(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
    select trim(regexp_replace(
        lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(value, ''))),
        '[^a-z0-9]+', ' ', 'g'))
$$;

-- What a search looks through: title, artist and labels, cleaned up.
create or replace function public.mili_search_text(title text, artist text, labels text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
    select public.mili_normalize(
        coalesce(title, '') || ' ' || coalesce(artist, '') || ' ' || coalesce(array_to_string(labels, ' '), ''))
$$;


-- ---------------------------------------------------------------------------
-- Tables
-- Each one is a gold table from the pipeline. "references objects (id)" is a
-- foreign key: a listen link can only point to an object that exists.
-- ---------------------------------------------------------------------------

-- One row per release or mix (from gold_site_objects)
create table if not exists public.objects (
    id             text primary key,              -- the mili ID
    kind           text not null,                 -- release or mix
    title          text not null,
    artist         text,
    artist_ids     text[],                        -- MusicBrainz artist IDs
    type           text,                          -- album, ep, single, track …
    year           integer,
    labels         text[],
    cover          text,                          -- cover image address
    genres         text[],
    bandcamp_page  text,                          -- e.g. thetrilogytapes
    availability   text,                          -- bandcamp_and_streaming, streaming_only …
    versions_total integer,
    -- worked out by Postgres itself whenever a row is added:
    search_text    text generated always as (public.mili_search_text(title, artist, labels)) stored,
    title_text     text generated always as (public.mili_normalize(title)) stored,
    artist_text    text generated always as (public.mili_normalize(artist)) stored
);

-- Where each object can be heard: one link per platform (gold_listen_options)
create table if not exists public.listen_options (
    listen_option_id text primary key,
    object_id        text not null references public.objects (id) on delete cascade,
    platform_id      text not null,
    display_name     text,
    url              text not null,
    confidence       double precision,
    version_id       text,
    version_label    text,
    menu_order       integer
);

-- Where it can be bought: Bandcamp and Discogs (gold_buy_options)
create table if not exists public.buy_options (
    buy_option_id text primary key,
    object_id     text not null references public.objects (id) on delete cascade,
    platform_id   text not null,
    display_name  text,
    url           text not null,
    link_kind     text,                           -- page or search
    menu_order    integer
);

-- Versions of an object: deluxe, remaster … (gold_object_versions)
create table if not exists public.object_versions (
    version_id            text primary key,
    object_id             text not null references public.objects (id) on delete cascade,
    version_key           text,
    version_label         text,
    display_title         text,
    platforms             integer,
    links                 integer,
    is_main               boolean,
    maybe_another_release boolean
);

-- Every link found, with how it was found and how sure we are (gold_object_instances)
create table if not exists public.object_instances (
    instance_id           text primary key,
    object_id             text not null references public.objects (id) on delete cascade,
    version_id            text,
    platform_id           text not null,
    url                   text not null,
    title_seen            text,
    sources               text,
    methods               text,
    confidence            double precision,
    maybe_another_release boolean
);

-- Daniel's library: collection and queue (gold_library)
create table if not exists public.library (
    object_id text primary key references public.objects (id) on delete cascade,
    added_on  date,
    status    text,                               -- collection or queue
    collages  text[]
);

-- The platforms and their names (seed: platforms.csv)
create table if not exists public.platforms (
    platform_id   text primary key,
    display_name  text not null,
    listen        boolean,
    buy           boolean,
    default_order integer,
    for_releases  boolean
);

-- The songs on each release, in order (gold_object_tracks)
create table if not exists public.tracks (
    track_id   text primary key,                  -- the object's ID + the song's place, e.g. 3f9a2c81d0be-004
    object_id  text not null references public.objects (id) on delete cascade,
    track_no   integer not null,                  -- 1, 2, 3 … across all discs
    disc       integer,
    number     text,                              -- as printed: 3, or B1 on vinyl
    title      text not null,
    artist     text,
    length_ms  integer,
    source     text                               -- musicbrainz or apple
);

-- Bandcamp's own player, for releases without a track list (gold_bandcamp_players)
create table if not exists public.bandcamp_players (
    object_id text primary key references public.objects (id) on delete cascade,
    embed     text not null                       -- album=<Bandcamp ID> or track=<Bandcamp ID>
);

-- The labels, with their pictures and your order (gold_labels)
create table if not exists public.labels (
    label         text primary key,
    slug          text not null,
    image         text,                           -- picture address
    image_source  text,                           -- chosen by hand or bandcamp page
    bandcamp_url  text,
    objects       integer,
    position      integer                         -- your own order, if you set one
);

-- A note for every load: when, and how many rows went into each table
create table if not exists public.load_log (
    load_id   bigint generated always as identity primary key,
    loaded_at timestamptz not null default now(),
    rows      jsonb not null,
    seconds   real
);


-- ---------------------------------------------------------------------------
-- Indexes: like the index at the back of a book, so Postgres can jump
-- straight to the rows it needs instead of reading every row
-- ---------------------------------------------------------------------------

create index if not exists objects_search_trigrams on public.objects using gin (search_text extensions.gin_trgm_ops);
create index if not exists listen_options_object on public.listen_options (object_id);
create index if not exists buy_options_object on public.buy_options (object_id);
create index if not exists object_versions_object on public.object_versions (object_id);
create index if not exists object_instances_object on public.object_instances (object_id);
create index if not exists tracks_object on public.tracks (object_id, track_no);


-- ---------------------------------------------------------------------------
-- Search: every word typed has to appear, best matches first. If nothing
-- matches word for word, near-misses (typos) are found with pg_trgm.
-- The website calls it like this: POST /rest/v1/rpc/search_objects {"query": "wind"}
-- ---------------------------------------------------------------------------

create or replace function public.search_objects(query text, max_results integer default 60)
returns table (
    id text, kind text, title text, artist text, artist_ids text[], type text, year integer,
    labels text[], cover text, genres text[], bandcamp_page text, availability text,
    versions_total integer, in_library boolean, close_match boolean, score real, total bigint
)
language sql
stable
set search_path = public, extensions
as $$
    with typed as (
        select public.mili_normalize(query) as q
    ),
    words as (
        select word from typed, unnest(string_to_array(typed.q, ' ')) as word where word <> ''
    ),
    exact as (
        -- every word appears somewhere in title, artist or labels
        select o.*
        from public.objects o
        where exists (select 1 from words)
          and not exists (select 1 from words where o.search_text not like '%' || words.word || '%')
    ),
    near as (
        -- only when nothing matched word for word: near-misses
        select o.*
        from public.objects o, typed
        where not exists (select 1 from exact)
          and typed.q <> ''
          and typed.q <% o.search_text
    ),
    hits as (
        select e.*, false as close_match from exact e
        union all
        select n.*, true as close_match from near n
    )
    select
        h.id, h.kind, h.title, h.artist, h.artist_ids, h.type, h.year, h.labels, h.cover,
        h.genres, h.bandcamp_page, h.availability, h.versions_total,
        (l.object_id is not null) as in_library,
        h.close_match,
        (case when l.object_id is not null then 4 else 0 end
         + case when h.title_text = t.q or h.artist_text = t.q then 3 else 0 end
         + case when h.title_text like t.q || '%' or h.artist_text like t.q || '%' then 2 else 0 end
         + word_similarity(t.q, h.search_text))::real as score,
        count(*) over () as total
    from hits h
    cross join typed t
    left join public.library l on l.object_id = h.id
    order by score desc, h.year desc nulls last, h.title
    limit max_results
$$;


-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

do $$
declare
    t text;
begin
    foreach t in array array['objects', 'listen_options', 'buy_options', 'object_versions',
                             'object_instances', 'library', 'platforms', 'labels', 'tracks',
                             'bandcamp_players', 'load_log']
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists "anyone may read" on public.%I', t);
        execute format('create policy "anyone may read" on public.%I for select to anon, authenticated using (true)', t);
        execute format('revoke all on public.%I from anon, authenticated', t);
        execute format('grant select on public.%I to anon, authenticated', t);
    end loop;
end
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema extensions to anon, authenticated;
revoke all on function public.search_objects(text, integer) from public;
grant execute on function public.search_objects(text, integer) to anon, authenticated;
grant execute on function public.mili_normalize(text) to anon, authenticated;
grant execute on function public.mili_search_text(text, text, text[]) to anon, authenticated;
