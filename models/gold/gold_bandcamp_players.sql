-- GOLD (for the app): what Bandcamp's own embedded player needs for a release:
-- "album=<Bandcamp ID>" or "track=<Bandcamp ID>".
-- The site shows the player on releases that have no track list of their own
-- (gold_object_tracks), mostly Bandcamp-only ones. The player is Bandcamp's
-- official way to put a release on another site; it shows the songs and plays them.
--
-- The IDs come from your collection page and from the labels' Bandcamp pages.

with from_collection as (
    -- your purchases: the object they became, or the one they were matched to
    select
        o.object_id,
        c.item_type || '=' || c.bandcamp_id as embed
    from {{ ref('silver_bandcamp_collection') }} c
    join {{ ref('gold_objects') }} o
        on (c.decision = 'new' and o.born_from = c.born_from)
        or (c.decision = 'matched_bandcamp_page' and o.born_from = c.bandcamp_page_born_from)
        or (c.decision = 'matched_work' and o.work_id = c.work_id and o.identity_source = 'musicbrainz')
    where c.item_type in ('album', 'track')
      and regexp_matches(c.bandcamp_id, '^[0-9]+$')
),

from_label_pages as (
    -- Bandcamp-only releases from the labels' own pages
    select
        o.object_id,
        coalesce(nullif(u.item_type, ''), 'album') || '=' || u.bandcamp_id as embed
    from {{ ref('silver_bandcamp_unmatched') }} u
    join {{ ref('gold_objects') }} o
        on o.born_from = 'link:' || u.url_key
    where u.decision = 'bandcamp_only'
      and regexp_matches(u.bandcamp_id, '^[0-9]+$')
      and u.item_type in ('album', 'track')
)

select object_id, embed
from (
    select *, 1 as preference from from_collection
    union all
    select *, 2 as preference from from_label_pages
)
qualify row_number() over (partition by object_id order by preference, embed) = 1
