-- GOLD: the INSTANCES of each work: one row per place a work lives on one of
-- our platforms.
--
-- Links come from three sources:
--   musicbrainz     links the MusicBrainz community has added
--   barcode_lookup  links we found by asking Apple, Deezer and Spotify directly,
--                   and that passed the match check in silver_platform_matches
--   title_search    Deezer links found by searching artist + title, that passed
--                   the stricter check in silver_deezer_title_matches
-- If both sources give the same link, it appears once, with both sources listed.
--
-- A work can have several instances on the same platform, for example on the
-- label's Bandcamp page and on the artist's own Bandcamp page.

with musicbrainz_links as (

    select
        release_group_id as work_id,
        platform_id,
        url,
        relation_type,
        release_id,
        level,
        'musicbrainz' as source
    from {{ ref('silver_mb_urls') }}
    where platform_id is not null

),

lookup_links as (

    select
        work_id,
        platform_id,
        url,
        null::varchar as relation_type,
        null::varchar as release_id,
        'album' as level,
        'barcode_lookup' as source
    from {{ ref('silver_platform_matches') }}
    where is_accepted
      and url is not null

),

title_search_links as (

    select
        work_id,
        'deezer' as platform_id,
        url,
        null::varchar as relation_type,
        null::varchar as release_id,
        'album' as level,
        'title_search' as source
    from {{ ref('silver_deezer_title_matches') }}
    where is_accepted
      and url is not null

),

all_links as (

    select * from musicbrainz_links
    union all
    select * from lookup_links
    union all
    select * from title_search_links

)

select
    md5(work_id || '|' || url) as instance_id,
    work_id,
    platform_id,
    url,
    string_agg(distinct source, ', ' order by source) as sources,
    string_agg(distinct relation_type, ', ') as relation_types,   -- e.g. "purchase for download, free streaming"
    count(distinct release_id) as editions_linked,
    bool_or(level = 'album') as linked_at_album_level
from all_links
group by work_id, platform_id, url
