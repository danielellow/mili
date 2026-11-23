-- GOLD (for the app): the row of listen links on a release or mix page.
-- One row per object and platform, in the order of the platforms seed
-- (default_order): Apple Music, YouTube, YouTube Music, Tidal ...
--
-- An object can have several links on the same platform (the label's Bandcamp
-- page and the artist's, or the standard and the deluxe version). The row shows
-- one, picked in this order:
--   1. the main version (gold_object_versions), so the row stays one version
--      where it can; when a platform only has another version, that link is
--      shown with its version_label ("Deluxe Version")
--   2. the most confident link (seeds/match_confidence.csv)
--   3. for Bandcamp: the label's own page, then the album rather than one track
--   4. a link to the whole release rather than to one edition
-- The others stay in gold_object_instances (other_links says how many).
--
-- Releases only show platforms marked for_releases (so not Mixcloud);
-- mixes show whatever platform they're on. Links to a "version" that is
-- probably another release ("(Live)", "(Remixes)") are left out.

with candidates as (

    select
        i.object_id,
        i.platform_id,
        i.url,
        i.confidence,
        i.version_id,
        v.is_main as is_main_version,
        v.version_label,
        count(*) over (partition by i.object_id, i.platform_id) as links_on_platform,
        row_number() over (
            partition by i.object_id, i.platform_id
            order by
                v.is_main desc,
                i.confidence desc nulls last,
                contains(i.sources, 'bandcamp_page') desc,
                contains(i.url, '/album/') desc,
                i.linked_at_album_level desc,
                i.url
        ) as preference
    from {{ ref('gold_object_instances') }} i
    join {{ ref('gold_object_versions') }} v
        on v.version_id = i.version_id
    join {{ ref('gold_objects') }} o
        on o.object_id = i.object_id
    join {{ ref('platforms') }} p
        on p.platform_id = i.platform_id
    where p.listen
      and (o.kind = 'mix' or p.for_releases)
      and (v.is_main or not v.maybe_another_release)

)

select
    md5(c.object_id || '|' || c.platform_id) as listen_option_id,
    c.object_id,
    c.platform_id,
    p.display_name,         -- what the link says: "Apple Music"
    c.url,
    c.confidence,
    c.version_id,
    -- empty when the link is the main version; otherwise which version it is
    case when c.is_main_version then null else c.version_label end as version_label,
    c.links_on_platform - 1 as other_links,
    row_number() over (
        partition by c.object_id
        order by p.default_order nulls last, c.platform_id
    ) as menu_order
from candidates c
join {{ ref('platforms') }} p
    on p.platform_id = c.platform_id
where c.preference = 1
