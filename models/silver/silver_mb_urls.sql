-- SILVER: every link MusicBrainz knows for our releases, one row per link.
--
-- Links come from two levels:
--   edition = a link on one specific release (e.g. its Bandcamp page)
--   album   = a link on the release group (e.g. the main Discogs "master" page)
-- Each link is matched to a platform using the platform_domains seed.
-- Links to sites that aren't in our platform list keep platform_id = null.

with edition_links as (

    select
        'edition' as level,
        r.release_id,
        r.release_group_id,
        rel ->> '$.type' as relation_type,
        rel ->> '$.url.resource' as url
    from {{ ref('silver_mb_releases') }} r,
        unnest(json_extract(r.release_json, '$.relations[*]')) as t(rel)
    where rel ->> '$.target-type' = 'url'

),

album_links as (

    select
        'album' as level,
        null::varchar as release_id,
        g.release_group_id,
        rel ->> '$.type' as relation_type,
        rel ->> '$.url.resource' as url
    from {{ ref('silver_mb_release_groups') }} g,
        unnest(json_extract(g.release_group_json, '$.relations[*]')) as t(rel)
    where rel ->> '$.target-type' = 'url'

),

all_links as (

    select * from edition_links
    union all
    select * from album_links

),

with_domain as (

    -- "https://www.ad93.bandcamp.com/album/053" -> "ad93.bandcamp.com"
    select
        *,
        regexp_replace(
            lower(regexp_extract(url, '^https?://([^/:?#]+)', 1)), '^www\.', ''
        ) as domain
    from all_links

),

matched as (

    -- A link matches a platform if its domain is the platform's domain or ends
    -- with it (so artist.bandcamp.com matches bandcamp.com). If several match,
    -- the most specific (longest) wins: music.youtube.com beats youtube.com.
    select
        l.*,
        d.platform_id,
        row_number() over (
            partition by l.level, l.release_id, l.release_group_id, l.relation_type, l.url
            order by length(d.domain) desc nulls last
        ) as best_match
    from with_domain l
    left join {{ ref('platform_domains') }} d
        on l.domain = d.domain
        or ends_with(l.domain, '.' || d.domain)

)

select
    level,
    release_id,
    release_group_id,
    relation_type,
    url,
    domain,
    platform_id,
    -- for Discogs: is this the main page for all editions (master) or one edition (release)?
    case
        when platform_id = 'discogs'
        then nullif(regexp_extract(url, 'discogs\.com/(master|release|artist|label)/', 1), '')
    end as discogs_page_type
from matched
where best_match = 1
