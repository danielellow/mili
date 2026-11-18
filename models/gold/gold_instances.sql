-- GOLD: the INSTANCES of each work: one row per place a work lives on one of
-- our platforms, as known to MusicBrainz so far.
--
-- A work can have several instances on the same platform, for example on the
-- label's Bandcamp page and on the artist's own Bandcamp page.

select
    md5(release_group_id || '|' || url) as instance_id,
    release_group_id as work_id,
    platform_id,
    url,
    string_agg(distinct relation_type, ', ') as relation_types,   -- e.g. "purchase for download, free streaming"
    count(distinct release_id) as editions_linked,
    bool_or(level = 'album') as linked_at_album_level
from {{ ref('silver_mb_urls') }}
where platform_id is not null
group by release_group_id, platform_id, url
