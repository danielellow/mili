-- SILVER: one row per platform link Odesli gave for something from your Bandcamp
-- collection (ingest/lookup_odesli.py --library), with the same title check as
-- silver_odesli_links: similarity >= 0.85, or one title contained in the other.
--
-- Links are cleaned like in silver_odesli_links (tracking codes dropped), except
-- that Apple Music keeps "?i=<song ID>" and YouTube keeps "?v=...", because those
-- say which song or video it is.

with newest as (

    select
        *,
        row_number() over (partition by born_from order by fetched_at desc) as newest_first
    from {{ ref('bronze_odesli_library') }}
    where status in ('found', 'not_found')

),

answers as (

    select * from newest
    where newest_first = 1
      and status = 'found'

),

links as (

    select
        a.born_from,
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
        born_from,
        fetched_at,
        odesli_platform,
        response -> 'entitiesByUniqueId' -> entity_id ->> 'title' as platform_title,
        response -> 'entitiesByUniqueId' -> entity_id ->> 'artistName' as platform_artist,
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
        case
            when odesli_platform in ('youtube', 'youtubeMusic') then odesli_url
            when odesli_platform = 'appleMusic'
                then split_part(odesli_url, '?', 1)
                     || coalesce('?i=' || nullif(regexp_extract(odesli_url, '[?&]i=(\d+)', 1), ''), '')
            else split_part(odesli_url, '?', 1)
        end as url
    from links

),

compared as (

    select
        d.*,
        k.title as bandcamp_title,
        greatest(
            jaro_winkler_similarity({{ normalize_title('k.title') }}, {{ normalize_title('d.platform_title') }}),
            jaro_winkler_similarity({{ core_title('k.title') }}, {{ core_title('d.platform_title') }})
        ) as title_similarity,
        (
            length({{ normalize_title('k.title') }}) >= 3
            and (
                contains({{ normalize_title('d.platform_title') }}, {{ normalize_title('k.title') }})
                or contains({{ normalize_title('k.title') }}, {{ normalize_title('d.platform_title') }})
            )
        ) as title_contained
    from described d
    join {{ ref('silver_bandcamp_collection') }} k
        on k.born_from = d.born_from
        and k.decision = 'new'

)

select
    md5(born_from || '|' || odesli_platform) as link_id,
    born_from,
    odesli_platform,
    platform_id,
    url,
    bandcamp_title,
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
