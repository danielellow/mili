-- SILVER: your Bandcamp collection (the newest saved page), each item matched to
-- something mili already knows, or not. One row per item; hidden items are left out.
--
-- How an item is matched, in this order:
--   1. by link: its Bandcamp page is already a link of a MusicBrainz work
--      (from MusicBrainz, a label's Bandcamp page, Odesli ...)
--   2. by link: it's a release from a label's Bandcamp page that MusicBrainz
--      doesn't have (a Bandcamp-only object, silver_bandcamp_unmatched)
--   3. by name: the same title and artist as exactly one MusicBrainz work
--      (titles compared without brackets; the artist the same, or one of the
--      names listed, as in the other matching)
-- Tracks bought from an album link to the album's page, so for tracks only a
-- /track/ link counts in 1 and 2, and in 3 a track only matches a single.
--
-- decision:
--   matched_work           -> the MusicBrainz work's object
--   matched_bandcamp_page  -> the Bandcamp-only object from the label's page
--   new                    -> a new mili object, born from the Bandcamp item
--                             (gold_objects, identity_source = bandcamp_collection)

with latest_run as (

    select max(run_id) as run_id from {{ ref('bronze_bandcamp_collection') }}

),

items as (

    select
        b.*,
        {{ normalize_url('b.url') }} as url_key,
        b.item_type <> 'track' or contains(coalesce(b.url, ''), '/track/') as link_names_the_item,
        {{ core_title('b.title') }} as title_core,
        {{ normalize_artist('b.artist') }} as artist_norm,
        'bandcamp:' || b.item_type || ':' || b.bandcamp_id as born_from
    from {{ ref('bronze_bandcamp_collection') }} b
    join latest_run l
        on l.run_id = b.run_id
    where b.list in ('collection', 'wishlist')

),

known_links as (

    select {{ normalize_url('url') }} as url_key, min(work_id) as work_id
    from {{ ref('gold_instances') }}
    where platform_id = 'bandcamp'
    group by 1

),

by_name as (

    select
        i.bandcamp_id,
        min(g.release_group_id) as work_id,
        count(*) as candidates
    from items i
    join {{ ref('silver_mb_release_groups') }} g
        on {{ core_title('g.title') }} = i.title_core
        and (
            {{ normalize_artist("g.release_group_json ->> '$.artist-credit[0].name'") }} = i.artist_norm
            or {{ normalize_artist('g.artist_credit') }} = i.artist_norm
            or starts_with(i.artist_norm || ' ', {{ normalize_artist("g.release_group_json ->> '$.artist-credit[0].name'") }} || ' ')
        )
        and (i.item_type <> 'track' or g.primary_type = 'single')
    where i.title_core <> ''
    group by 1

)

select
    i.list,
    i.item_type,
    i.bandcamp_id,
    i.title,
    i.artist,
    i.url,
    i.url_key,
    i.added_at,
    i.cover_url,
    i.born_from,
    case
        when i.link_names_the_item and kl.work_id is not null then kl.work_id
        when not (i.link_names_the_item and u.url_key is not null) and bn.candidates = 1 then bn.work_id
    end as work_id,
    case when i.link_names_the_item and u.url_key is not null then 'link:' || u.url_key end as bandcamp_page_born_from,
    case
        when i.link_names_the_item and kl.work_id is not null then 'matched_work'
        when i.link_names_the_item and u.url_key is not null then 'matched_bandcamp_page'
        when bn.candidates = 1 then 'matched_work'
        else 'new'
    end as decision,
    i.fetched_at
from items i
left join known_links kl
    on kl.url_key = i.url_key
left join {{ ref('silver_bandcamp_unmatched') }} u
    on u.url_key = i.url_key
    and u.decision = 'bandcamp_only'
left join by_name bn
    on bn.bandcamp_id = i.bandcamp_id
