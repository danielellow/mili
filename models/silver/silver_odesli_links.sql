-- SILVER: one row per platform link Odesli gave for a work, with a title check.
--
-- Odesli answers with "linksByPlatform": for each platform, a link and the ID
-- of an "entity" (the album or song on that platform), whose title is in
-- "entitiesByUniqueId". We unpack those, translate Odesli's platform names to
-- ours, and compare each title with the MusicBrainz title. The check is the
-- same as for barcode matches on a different barcode: similarity >= 0.85, or
-- one title contained in the other.
--
-- Platforms that aren't in our list (e.g. Napster, Audiomack, Amazon's store)
-- are kept here with platform_id = null, but don't go on to gold.

with newest as (

    select
        *,
        row_number() over (partition by work_id order by fetched_at desc) as newest_first
    from {{ ref('bronze_odesli_links') }}
    where status in ('found', 'not_found')

),

answers as (

    select * from newest
    where newest_first = 1
      and status = 'found'

),

links as (

    -- one row per platform in "linksByPlatform"
    select
        a.work_id,
        a.start_platform,
        a.fetched_at,
        k as odesli_platform,
        a.response -> 'linksByPlatform' -> k ->> 'url' as odesli_url,
        a.response -> 'linksByPlatform' -> k ->> 'entityUniqueId' as entity_id,
        a.response
    from answers a,
        unnest(json_keys(a.response -> 'linksByPlatform')) as t(k)

),

described as (

    select
        work_id,
        start_platform,
        fetched_at,
        odesli_platform,
        odesli_url,
        response -> 'entitiesByUniqueId' -> entity_id ->> 'title' as platform_title,
        response -> 'entitiesByUniqueId' -> entity_id ->> 'artistName' as platform_artist,
        response -> 'entitiesByUniqueId' -> entity_id ->> 'type' as entity_type,
        -- Odesli's platform names -> ours (see seeds/platforms.csv)
        case odesli_platform
            when 'spotify'      then 'spotify'
            when 'appleMusic'   then 'apple_music'
            when 'youtube'      then 'youtube'
            when 'youtubeMusic' then 'youtube_music'
            when 'tidal'        then 'tidal'
            when 'deezer'       then 'deezer'
            when 'amazonMusic'  then 'amazon_music'
            when 'pandora'      then 'pandora'
            when 'soundcloud'   then 'soundcloud'
            when 'bandcamp'     then 'bandcamp'
        end as platform_id,
        -- a clean link: drop the "?..." tail (tracking codes), except on
        -- YouTube, where "?v=..." is what identifies the video
        case
            when odesli_platform in ('youtube', 'youtubeMusic') then odesli_url
            else split_part(odesli_url, '?', 1)
        end as url
    from links

),

compared as (

    select
        d.*,
        w.title as mb_title,
        greatest(
            jaro_winkler_similarity({{ normalize_title('w.title') }}, {{ normalize_title('d.platform_title') }}),
            jaro_winkler_similarity({{ core_title('w.title') }}, {{ core_title('d.platform_title') }})
        ) as title_similarity,
        (
            length({{ normalize_title('w.title') }}) >= 3
            and (
                contains({{ normalize_title('d.platform_title') }}, {{ normalize_title('w.title') }})
                or contains({{ normalize_title('w.title') }}, {{ normalize_title('d.platform_title') }})
            )
        ) as title_contained
    from described d
    -- only works that still exist in our catalogue
    join {{ ref('silver_mb_release_groups') }} w
        on w.release_group_id = d.work_id

)

select
    md5(work_id || '|' || odesli_platform) as link_id,
    work_id,
    start_platform,
    odesli_platform,
    platform_id,
    url,
    odesli_url,
    entity_type,       -- album, or song (for singles)
    mb_title,
    platform_title,
    platform_artist,
    round(title_similarity, 3) as title_similarity,
    coalesce(title_contained, false) as title_contained,
    platform_id is not null
        and url is not null
        and (title_similarity >= 0.85 or coalesce(title_contained, false))
        as is_accepted,
    fetched_at
from compared
