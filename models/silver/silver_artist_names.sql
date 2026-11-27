-- SILVER: every artist name mili knows, with the key its artist page uses.
--
--   MusicBrainz artists   key = the MusicBrainz artist ID, from the credits on
--                         the catalogue's works (both the artist's own name and
--                         the name they're credited as)
--   Bandcamp-only artists key = "name:" + the cleaned name ("name:swirl-people"),
--                         for releases from labels' Bandcamp pages or your
--                         Bandcamp collection that MusicBrainz doesn't have.
--                         When the name is a MusicBrainz artist's, that artist's
--                         ID is used instead, so they share one page.
--
-- Used to give Bandcamp-only releases an artist page, and to link a mix to its
-- DJ (silver_mix_artists). Only exact matches of the cleaned name count, so
-- "Call Super" finds Call Super but "Call Superr" doesn't.
--
-- When two MusicBrainz artists have the same name, the one with more works in
-- mili wins (name_is_shared says so).

with credits as (

    select
        rg.release_group_id,
        unnest(json_extract(rg.release_group_json, '$.artist-credit[*]')) as credit
    from {{ ref('silver_mb_release_groups') }} rg

),

mb_names as (

    -- the artist's own name and the name on the credit (they can differ)
    select credit ->> '$.artist.id' as artist_id, credit ->> '$.artist.name' as name, release_group_id
    from credits
    union
    select credit ->> '$.artist.id', credit ->> '$.name', release_group_id
    from credits

),

mb_counted as (

    select
        artist_id,
        name,
        {{ normalize_artist('name') }} as name_key,
        count(distinct release_group_id) as works
    from mb_names
    where artist_id is not null and nullif(trim(name), '') is not null
    group by artist_id, name

),

mb_by_key as (

    select
        name_key,
        arg_max(artist_id, works) as artist_id,
        arg_max(name, works) as name,
        count(distinct artist_id) > 1 as name_is_shared,
        max(works) as works
    from mb_counted
    where name_key not in ('', 'various artists')
    group by name_key

),

bandcamp_names as (

    select item_artist as name from {{ ref('silver_bandcamp_unmatched') }} where decision = 'bandcamp_only'
    union
    select artist from {{ ref('silver_bandcamp_collection') }} where decision = 'new'

),

bandcamp_by_key as (

    select
        {{ normalize_artist('name') }} as name_key,
        min(name) as name
    from bandcamp_names
    where nullif(trim(name), '') is not null
    group by 1

)

select
    name_key,                   -- the cleaned name, e.g. "call super"
    artist_id,                  -- what the artist page uses: a MusicBrainz ID or "name:…"
    name,
    'musicbrainz' as known_from,
    name_is_shared,
    works
from mb_by_key

union all

select
    b.name_key,
    'name:' || replace(b.name_key, ' ', '-') as artist_id,
    b.name,
    'bandcamp' as known_from,
    false as name_is_shared,
    null::bigint as works
from bandcamp_by_key b
where b.name_key not in ('', 'various artists')
  and b.name_key not in (select name_key from mb_by_key)
