-- GOLD: CLAIMS. One row per fact per source about an object, written as
-- "predicate -> value", for example:  title -> "Haw",  release_date -> "2020-03-06".
--
-- Several sources can say something about the same fact, and they can
-- disagree. Instead of picking one answer, we keep them all, side by side,
-- each with where it came from and how sure we are that the source is talking
-- about the same release.
--
--   predicate     title, artist, release_date or uploaded_by
--                 (uploaded_by: on YouTube, YouTube Music and SoundCloud, the name
--                 next to a release is the account that uploaded it: the artist,
--                 the label, one of YouTube's automatic channels, or a fan. So
--                 there it's stored as uploaded_by, not as artist.)
--   source        who says it: musicbrainz, spotify, apple_music, deezer,
--                 bandcamp, discogs, tidal ... or added_by_hand (mixes)
--   method        how that source was linked to the object (origin, barcode_exact,
--                 odesli ...), the same names as in seeds/match_confidence.csv
--   scope         work      the album above all its editions (MusicBrainz)
--                 platform  the product a platform sells or streams
--                 edition   one specific edition (Discogs)
--   confidence    from seeds/match_confidence.csv: how sure we are that this
--                 source's record is the same release. 1.0 for the record the
--                 object was born from.
--
-- Where the facts come from:
--   musicbrainz        the work itself (first release date of the album)
--   barcode lookups    Apple, Deezer, Spotify: title, artist, release date
--   Deezer search      title, artist (Deezer's search answers have no date)
--   Odesli             title and artist on each platform it found (no dates);
--                      uploaded_by instead of artist on YouTube, YouTube Music and
--                      SoundCloud. Platforms only for DJ mixes (Mixcloud) are left out.
--   label Bandcamp     title, artist (the pages show no dates)
--   Discogs            title, artist, and the year of the edition we found
-- Only matches we accepted are used.

with mb_fetched as (

    select release_group_id, max(fetched_at) as fetched_at
    from {{ ref('silver_mb_releases') }}
    group by 1

),

origin_records as (

    -- the record each object was born from
    select
        o.object_id,
        case o.identity_source
            when 'musicbrainz' then 'musicbrainz'
            when 'bandcamp_page' then 'bandcamp'
            else 'added_by_hand'
        end as source,
        'origin' as method,
        case o.identity_source when 'musicbrainz' then 'work' else 'platform' end as scope,
        o.title,
        o.artist_credit as artist,
        o.first_release_date as release_date,
        null::varchar as uploaded_by,
        f.fetched_at
    from {{ ref('gold_objects') }} o
    left join mb_fetched f
        on f.release_group_id = o.work_id

),

work_records as (

    -- everything else is matched to a MusicBrainz work (work_id)

    select
        work_id,
        platform_id as source,
        case matched_on when 'barcode' then 'barcode_exact' else 'barcode_other' end as method,
        'platform' as scope,
        platform_title as title,
        platform_artist as artist,
        platform_release_date as release_date,
        null::varchar as uploaded_by,
        fetched_at
    from {{ ref('silver_platform_matches') }}
    where is_accepted

    union all

    select
        work_id,
        'deezer' as source,
        'title_search' as method,
        'platform' as scope,
        deezer_title as title,
        deezer_artist as artist,
        null::varchar as release_date,
        null::varchar as uploaded_by,
        fetched_at
    from {{ ref('silver_deezer_title_matches') }}
    where is_accepted

    union all

    select
        work_id,
        platform_id as source,
        'odesli' as method,
        'platform' as scope,
        platform_title as title,
        case when platform_id not in ('youtube', 'youtube_music', 'soundcloud')
            then platform_artist end as artist,
        null::varchar as release_date,
        case when platform_id in ('youtube', 'youtube_music', 'soundcloud')
            then platform_artist end as uploaded_by,
        fetched_at
    from {{ ref('silver_odesli_links') }}
    where is_accepted
      and platform_id in (select platform_id from {{ ref('platforms') }} where for_releases)

    union all

    select
        work_id,
        'bandcamp' as source,
        'bandcamp_page' as method,
        'platform' as scope,
        item_title as title,
        nullif(item_artist, '') as artist,
        null::varchar as release_date,
        null::varchar as uploaded_by,
        fetched_at
    from {{ ref('silver_bandcamp_label_matches') }}
    where is_matched

    union all

    select
        d.work_id,
        'discogs' as source,
        'discogs_' || d.method as method,
        'edition' as scope,
        d.discogs_title as title,
        d.discogs_artist as artist,
        d.discogs_year::varchar as release_date,
        null::varchar as uploaded_by,
        b.fetched_at
    from {{ ref('silver_discogs_matches') }} d
    left join (
        select work_id, max(fetched_at) as fetched_at
        from {{ ref('bronze_discogs_lookups') }}
        group by 1
    ) b
        on b.work_id = d.work_id
    where d.is_accepted

),

all_records as (

    select * from origin_records

    union all by name

    select
        o.object_id,
        r.source,
        r.method,
        r.scope,
        r.title,
        r.artist,
        r.release_date,
        r.uploaded_by,
        r.fetched_at
    from work_records r
    join {{ ref('gold_objects') }} o
        on o.work_id = r.work_id

),

facts as (

    -- turn the four columns into rows: one row per fact
    -- (UNPIVOT leaves out the empty ones)
    unpivot all_records
    on title, artist, release_date, uploaded_by
    into name predicate value value

)

select
    md5(f.object_id || '|' || f.predicate || '|' || f.source || '|' || f.method || '|' || f.value)
        as claim_id,
    f.object_id,
    f.predicate,
    f.value,
    f.source,
    f.method,
    f.scope,
    max(c.confidence) as confidence,
    max(f.fetched_at) as fetched_at
from facts f
left join {{ ref('match_confidence') }} c
    on c.method = f.method
where trim(f.value) <> ''
group by f.object_id, f.predicate, f.value, f.source, f.method, f.scope
