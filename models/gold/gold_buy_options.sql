-- GOLD (for the app): what the "buy" menu shows for each object.
-- One row per object and buy option (the platforms marked buy = true in the
-- platforms seed: Bandcamp and Discogs).
--
--   Discogs   every release has one. MusicBrainz works use the link chosen in
--             gold_works: the main page when we know it, otherwise a
--             ready-made Discogs search. Bandcamp-only releases get the search.
--             (link_kind = 'search', so the app can label it "Discogs · search")
--   Bandcamp  only when we have a link. An object can have several Bandcamp
--             pages (the label's and the artist's); the menu shows one:
--             the label's own page first, albums before single tracks.
--             The others are still in gold_object_instances.
--   Mixes have no buy options.

with bandcamp_ranked as (

    select
        i.object_id,
        i.url,
        count(*) over (partition by i.object_id) as bandcamp_links,
        row_number() over (
            partition by i.object_id
            order by
                contains(i.sources, 'bandcamp_page') desc,   -- the label's own Bandcamp page
                contains(i.url, '/album/') desc,             -- the album, not one track
                contains(i.sources, 'musicbrainz') desc,
                i.url
        ) as preference
    from {{ ref('gold_object_instances') }} i
    join {{ ref('gold_object_versions') }} v
        on v.version_id = i.version_id
    where i.platform_id = 'bandcamp'
      -- not a "version" that is probably another release ("(Remixes)")
      and (v.is_main or not v.maybe_another_release)

),

discogs as (

    -- MusicBrainz works: the link chosen in gold_works
    select
        o.object_id,
        w.discogs_url as url,
        case when w.discogs_page_type = 'search' then 'search' else 'page' end as link_kind
    from {{ ref('gold_objects') }} o
    join {{ ref('gold_works') }} w
        on w.work_id = o.work_id

    union all

    -- Bandcamp-only releases: a ready-made search for artist + title
    select
        object_id,
        {{ discogs_search_url('artist_credit', 'title') }} as url,
        'search' as link_kind
    from {{ ref('gold_objects') }}
    where kind = 'release'
      and work_id is null

),

options as (

    select
        object_id,
        'bandcamp' as platform_id,
        url,
        'page' as link_kind,
        bandcamp_links - 1 as other_links
    from bandcamp_ranked
    where preference = 1
      -- mixes are listened to, not bought
      and object_id in (select object_id from {{ ref('gold_objects') }} where kind = 'release')

    union all

    select
        object_id,
        'discogs' as platform_id,
        url,
        link_kind,
        null::bigint as other_links
    from discogs

)

select
    md5(o.object_id || '|' || o.platform_id) as buy_option_id,
    o.object_id,
    obj.work_id,      -- the MusicBrainz work, when there is one
    o.platform_id,
    p.display_name,
    o.url,
    o.link_kind,      -- page, or search (a Discogs search when we found no page)
    o.other_links,    -- more Bandcamp pages for the same object, in gold_object_instances
    row_number() over (
        partition by o.object_id
        order by p.default_order nulls last, o.platform_id
    ) as menu_order
from options o
join {{ ref('gold_objects') }} obj
    on obj.object_id = o.object_id
join {{ ref('platforms') }} p
    on p.platform_id = o.platform_id
where p.buy
