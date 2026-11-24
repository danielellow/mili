-- SILVER: your library (seeds/library.csv), each row matched to a mili object.
--
-- Each row in the file is one release (or mix) you want in your library:
--   link       any link to it you have: Bandcamp, Spotify, Apple Music, Deezer,
--              Tidal, Discogs, MusicBrainz, YouTube, or NTS/Mixcloud for a mix
--   artist, title    as you know them (used when there's no link, or it isn't found)
--   added_on   when you added it, as 2026-07-04 (can be empty)
--   status     collection, or queue (for things you want to listen to); empty = collection
--   collages   your own groupings, separated by ";"   e.g. "late night; sunday"
--   note       anything for yourself; it isn't used
--
-- How a row is matched:
--   1. by link: the link is compared with every link we know for each object,
--      in a way that ignores small differences (country codes, tracking codes,
--      see link_match_key in macros/object_helpers.sql)
--   2. otherwise by artist and title, cleaned the same way as everywhere else.
--      If several objects match, the one on most platforms is picked, and the
--      row says so in check_note, so you can add a link to choose.
-- Rows that aren't found keep object_id empty, with a note.
--
-- Your Bandcamp collection is added too (silver_bandcamp_collection): everything
-- you bought, dated by when you bought it, and your wishlist as the queue.
-- Those rows already know their object, so they don't need matching here.

with rows as (

    select
        md5(concat_ws('|', link, artist, title)) as row_id,
        nullif(trim(link), '') as link,
        nullif(trim(artist), '') as artist,
        nullif(trim(title), '') as title,
        try_cast(nullif(trim(added_on), '') as date) as added_on,
        coalesce(nullif(lower(trim(status)), ''), 'collection') as status,
        list_filter(
            list_transform(string_split(coalesce(collages, ''), ';'), lambda c: trim(c)),
            lambda c: c <> ''
        ) as collages,
        note
    from {{ ref('library') }}

),

link_keys as (

    -- every link we know for each object
    select distinct object_id, {{ link_match_key('url') }} as link_key
    from {{ ref('gold_object_instances') }}

    union

    -- MusicBrainz pages: the work's own page ...
    select object_id, 'musicbrainz/release-group/' || work_id as link_key
    from {{ ref('gold_objects') }}
    where work_id is not null

    union

    -- ... and the page of each of its editions
    select o.object_id, 'musicbrainz/release/' || r.release_id as link_key
    from {{ ref('silver_mb_releases') }} r
    join {{ ref('gold_objects') }} o
        on o.work_id = r.release_group_id

),

by_link as (

    select r.row_id, min(k.object_id) as object_id
    from rows r
    join link_keys k
        on k.link_key = {{ link_match_key('r.link') }}
    where r.link is not null
    group by r.row_id

),

platform_counts as (

    select object_id, count(distinct platform_id) as platforms
    from {{ ref('gold_object_instances') }}
    group by 1

),

by_name as (

    select
        r.row_id,
        o.object_id,
        count(*) over (partition by r.row_id) as candidates,
        row_number() over (
            partition by r.row_id
            order by p.platforms desc nulls last, o.object_id
        ) as preference
    from rows r
    join {{ ref('gold_objects') }} o
        on {{ core_title('o.title') }} = {{ core_title('r.title') }}
        and (
            {{ normalize_artist('o.artist_credit') }} = {{ normalize_artist('r.artist') }}
            -- "Kode9" also finds "Kode9 & The Spaceape"
            or starts_with(
                {{ normalize_artist('o.artist_credit') }} || ' ',
                {{ normalize_artist('r.artist') }} || ' '
            )
        )
    left join platform_counts p
        on p.object_id = o.object_id
    where r.title is not null
      and r.artist is not null

),

from_file as (

    -- the rows from seeds/library.csv
    select
    r.row_id,
    r.link,
    r.artist,
    r.title,
    r.added_on,
    r.status,
    r.collages,
    r.note,
    coalesce(bl.object_id, bn.object_id) as object_id,
    case
        when bl.object_id is not null then 'link'
        when bn.object_id is not null then 'artist_and_title'
    end as found_by,
    case
        when bl.object_id is null and bn.object_id is null
            then 'not found: check the spelling or the link (it may not be on one of the 20 labels)'
        when bl.object_id is null and bn.candidates > 1
            then 'several matches: picked the one on most platforms; add a link to choose'
    end as check_note
from rows r
left join by_link bl
    on bl.row_id = r.row_id
left join by_name bn
    on bn.row_id = r.row_id
    and bn.preference = 1

),

from_bandcamp as (

    select
        md5('bandcamp|' || c.bandcamp_id) as row_id,
        c.url as link,
        c.artist,
        c.title,
        c.added_at::date as added_on,
        case c.list when 'wishlist' then 'queue' else 'collection' end as status,
        []::varchar[] as collages,
        'from your Bandcamp collection' as note,
        o.object_id,
        'bandcamp_collection' as found_by,
        null::varchar as check_note
    from {{ ref('silver_bandcamp_collection') }} c
    join {{ ref('gold_objects') }} o
        on (c.decision = 'matched_work' and o.work_id = c.work_id)
        or (c.decision = 'matched_bandcamp_page' and o.born_from = c.bandcamp_page_born_from)
        or (c.decision = 'new' and o.born_from = c.born_from)

)

select * from from_file
union all by name
select * from from_bandcamp
