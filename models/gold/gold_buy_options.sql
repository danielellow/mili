-- GOLD (for the app): what the "buy" menu shows for each work.
-- One row per work and buy option (the platforms marked buy = true in the
-- platforms seed: Bandcamp and Discogs).
--
--   Discogs   every work has one: the main page when we know it, otherwise a
--             ready-made Discogs search (link_kind = 'search', so the app can
--             label it "Discogs · search").
--   Bandcamp  only when we have a link. A work can have several Bandcamp
--             pages (the label's and the artist's); the menu shows one:
--             the label's own page first, albums before single tracks.
--             The others are still in gold_instances.

with bandcamp_ranked as (

    select
        work_id,
        url,
        count(*) over (partition by work_id) as bandcamp_links,
        row_number() over (
            partition by work_id
            order by
                contains(sources, 'bandcamp_page') desc,   -- the label's own Bandcamp page
                contains(url, '/album/') desc,             -- the album, not one track
                contains(sources, 'musicbrainz') desc,
                url
        ) as preference
    from {{ ref('gold_instances') }}
    where platform_id = 'bandcamp'

),

options as (

    select
        work_id,
        'bandcamp' as platform_id,
        url,
        'page' as link_kind,
        bandcamp_links - 1 as other_links
    from bandcamp_ranked
    where preference = 1

    union all

    select
        work_id,
        'discogs' as platform_id,
        discogs_url as url,
        case when discogs_page_type = 'search' then 'search' else 'page' end as link_kind,
        null::bigint as other_links
    from {{ ref('gold_works') }}

)

select
    md5(o.work_id || '|' || o.platform_id) as buy_option_id,
    o.work_id,
    o.platform_id,
    p.display_name,
    o.url,
    o.link_kind,      -- page, or search (a Discogs search when we found no page)
    o.other_links,    -- more Bandcamp pages for the same work, in gold_instances
    row_number() over (
        partition by o.work_id
        order by p.default_order nulls last, o.platform_id
    ) as menu_order
from options o
join {{ ref('platforms') }} p
    on p.platform_id = o.platform_id
where p.buy
