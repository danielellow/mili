-- SILVER: one row per work and platform: the newest answer from the barcode
-- lookups, with a check of whether we trust the match.
--
-- How a match is judged:
--   matched_on = 'barcode'        the platform found the exact barcode we asked for
--   matched_on = 'other_barcode'  the platform answered with a different barcode
--                                 (Deezer does this, and Spotify/Apple inherit it when
--                                 we retry with Deezer's barcode)
-- Exact barcode matches are accepted. Matches on another barcode are only
-- accepted if the platform's title looks like the MusicBrainz title.

with newest as (

    select
        *,
        row_number() over (
            partition by platform, work_id
            order by fetched_at desc
        ) as newest_first
    from {{ ref('bronze_barcode_lookups') }}
    where status in ('found', 'not_found')     -- errors get retried, so we skip them here

),

answers as (

    select
        platform,
        work_id,
        barcode,
        coalesce(barcode_source, 'musicbrainz') as barcode_source,
        status,
        url,
        fetched_at,
        -- what the platform calls the album, and the barcode it has for it
        case platform
            when 'deezer'  then response ->> '$.title'
            when 'spotify' then response ->> '$.albums.items[0].name'
            when 'apple'   then response ->> '$.results[0].collectionName'
        end as platform_title,
        case platform
            when 'deezer'  then response ->> '$.artist.name'
            when 'spotify' then response ->> '$.albums.items[0].artists[0].name'
            when 'apple'   then response ->> '$.results[0].artistName'
        end as platform_artist,
        case platform
            when 'deezer' then response ->> '$.upc'
        end as platform_barcode,
        -- the release date the platform shows: "2020-01-01" (Apple adds a time,
        -- Spotify sometimes only has "2020"). Deezer writes "0000-00-00" when it
        -- doesn't know, which we treat as empty.
        nullif(nullif(left(case platform
            when 'deezer'  then response ->> '$.release_date'
            when 'spotify' then response ->> '$.albums.items[0].release_date'
            when 'apple'   then response ->> '$.results[0].releaseDate'
        end, 10), ''), '0000-00-00') as platform_release_date
    from newest
    where newest_first = 1

),

compared as (

    select
        a.*,
        w.title as mb_title,
        w.artist_credit as mb_artist,
        case
            when a.status <> 'found' then null
            when a.platform = 'deezer'
                 and ltrim(a.platform_barcode, '0') = ltrim(a.barcode, '0') then 'barcode'
            when a.platform <> 'deezer' and a.barcode_source = 'musicbrainz' then 'barcode'
            else 'other_barcode'
        end as matched_on,
        jaro_winkler_similarity(
            {{ normalize_title('w.title') }},
            {{ normalize_title('a.platform_title') }}
        ) as title_similarity,
        -- one title inside the other also counts, e.g. "Metallur" in "Metallur (Remastered)"
        (
            length({{ normalize_title('w.title') }}) >= 3
            and (
                contains({{ normalize_title('a.platform_title') }}, {{ normalize_title('w.title') }})
                or contains({{ normalize_title('w.title') }}, {{ normalize_title('a.platform_title') }})
            )
        ) as title_contained
    from answers a
    -- only works that still exist in our catalogue (a work can disappear
    -- from MusicBrainz between runs, e.g. when two entries are merged)
    join {{ ref('silver_mb_release_groups') }} w
        on w.release_group_id = a.work_id

)

select
    platform || ':' || work_id as match_id,
    platform,
    case platform when 'apple' then 'apple_music' else platform end as platform_id,
    work_id,
    status,
    url,
    barcode,
    barcode_source,
    platform_barcode,
    mb_title,
    platform_title,
    mb_artist,
    platform_artist,
    platform_release_date,
    matched_on,
    round(title_similarity, 3) as title_similarity,
    coalesce(title_contained, false) as title_contained,
    -- the decision: do we trust this match?
    status = 'found'
        and (
            matched_on = 'barcode'
            or title_similarity >= 0.85
            or coalesce(title_contained, false)
        ) as is_accepted,
    fetched_at
from compared
