-- GOLD (for the app): one row per mili OBJECT, with mili's own ID.
--
-- Until now, a release only existed in mili if MusicBrainz knew it, because a
-- work's ID was its MusicBrainz ID. Objects have an ID of their own, and the
-- MusicBrainz ID becomes one fingerprint among others. An object comes from:
--
--   musicbrainz     a MusicBrainz work (release group), as in gold_works
--   bandcamp_page   a release on a label's own Bandcamp page that MusicBrainz
--                   doesn't have (decision = bandcamp_only in silver_bandcamp_unmatched)
--   added_by_hand   a mix from seeds/mixes.csv
--   bandcamp_collection  something from your Bandcamp collection that mili didn't
--                   know yet (decision = new in silver_bandcamp_collection); a
--                   track you bought stays a track
--
-- How the ID is made: each object is "born from" its first fingerprint, written
-- as text: "musicbrainz:<release group ID>" when MusicBrainz knows it, otherwise
-- "link:<the link, cleaned>", or for your Bandcamp collection
-- "bandcamp:<album or track>:<Bandcamp's ID>". The mili ID is a hash of that text (see
-- macros/object_helpers.sql), so it stays the same every time dbt rebuilds.
--
-- Known limit: if MusicBrainz later adds a release that is Bandcamp-only here,
-- it will be born a second time from its MusicBrainz ID, and the two objects
-- need merging. The same goes for MusicBrainz merging two release groups.
-- That's for later (a "merged into" table).

with editions as (

    -- does any edition have a front cover in the Cover Art Archive?
    select
        release_group_id,
        bool_or(has_front_cover) as has_cover
    from {{ ref('silver_mb_releases') }}
    group by 1

),

musicbrainz_objects as (

    select
        'musicbrainz:' || w.work_id as born_from,
        'release' as kind,
        'musicbrainz' as identity_source,
        w.work_id,
        w.title,
        w.artist_credit,
        w.work_type,
        w.secondary_types,
        w.first_release_date,
        w.first_release_year,
        w.top_genres,
        case
            when e.has_cover
            then 'https://coverartarchive.org/release-group/' || w.work_id || '/front-500'
        end as cover_url
    from {{ ref('gold_works') }} w
    left join editions e
        on e.release_group_id = w.work_id

),

bandcamp_objects as (

    select
        'link:' || url_key as born_from,
        'release' as kind,
        'bandcamp_page' as identity_source,
        null::varchar as work_id,
        item_title as title,
        nullif(item_artist, '') as artist_credit,
        -- Bandcamp only says "album" (any release with several tracks) or "track"
        case item_type when 'track' then 'single' end as work_type,
        null::varchar as secondary_types,
        null::varchar as first_release_date,
        null::integer as first_release_year,
        null::varchar as top_genres,
        null::varchar as cover_url
    from {{ ref('silver_bandcamp_unmatched') }}
    where decision = 'bandcamp_only'

),

mix_objects as (

    select
        'link:' || url_key as born_from,
        'mix' as kind,
        'added_by_hand' as identity_source,
        null::varchar as work_id,
        title,
        artist as artist_credit,
        null::varchar as work_type,
        null::varchar as secondary_types,
        null::varchar as first_release_date,
        null::integer as first_release_year,
        null::varchar as top_genres,
        nullif(artwork_url, '') as cover_url
    from {{ ref('silver_mixes') }}

),

collection_objects as (

    select
        born_from,
        'release' as kind,
        'bandcamp_collection' as identity_source,
        null::varchar as work_id,
        title,
        artist as artist_credit,
        -- Bandcamp says album (any release with several tracks), track, or package
        case item_type when 'track' then 'track' end as work_type,
        null::varchar as secondary_types,
        null::varchar as first_release_date,
        null::integer as first_release_year,
        null::varchar as top_genres,
        cover_url
    from {{ ref('silver_bandcamp_collection') }}
    where decision = 'new'

),

all_objects as (

    select * from musicbrainz_objects
    union all by name
    select * from bandcamp_objects
    union all by name
    select * from mix_objects
    union all by name
    select * from collection_objects

)

select
    {{ mili_id('born_from') }} as object_id,
    kind,                   -- release or mix
    identity_source,        -- musicbrainz, bandcamp_page, added_by_hand or bandcamp_collection
    born_from,              -- the fingerprint the ID was made from
    work_id,                -- the MusicBrainz work, when there is one
    title,
    artist_credit,
    work_type,              -- album, ep, single, track ... (empty when we don't know)
    secondary_types,
    first_release_date,
    first_release_year,
    top_genres,
    cover_url               -- Cover Art Archive for MusicBrainz works, the artwork for mixes,
                            -- Bandcamp's cover for your collection
from all_objects
