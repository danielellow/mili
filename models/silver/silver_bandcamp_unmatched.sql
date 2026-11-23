-- SILVER: releases on the labels' own Bandcamp pages that we couldn't link to
-- any MusicBrainz work. One row per release (a co-release on two labels'
-- pages is one row, with both labels listed).
--
-- A release is left out here if its link is already an instance of a work
-- in gold_instances, from any source: matched on the label page, linked in
-- MusicBrainz, or found by Odesli.
--
-- What's left gets one of two decisions:
--   bandcamp_only  clearly not one of the label's MusicBrainz works. It becomes
--                  a mili object of its own (gold_objects).
--   uncertain      close to one of the label's works, but not close enough for
--                  the matching rules: same or no artist shown, and a title
--                  similarity from 0.85 (the var bandcamp_uncertain_from in
--                  dbt_project.yml). These wait for a decision (later: the
--                  AI judge), so we don't create the same release twice.

with items as (

    select
        *,
        {{ normalize_url('item_url') }} as url_key
    from {{ ref('silver_bandcamp_label_matches') }}

),

known_urls as (

    -- Bandcamp links we already have for some work
    select distinct {{ normalize_url('url') }} as url_key
    from {{ ref('gold_instances') }}
    where platform_id = 'bandcamp'

),

per_release as (

    select
        url_key,
        -- when a release is on two pages, take the details from the first label
        min_by(item_url, mili_label) as item_url,
        min_by(item_title, mili_label) as item_title,
        min_by(item_artist, mili_label) as item_artist,
        min_by(item_type, mili_label) as item_type,
        min_by(bandcamp_id, mili_label) as bandcamp_id,
        list(distinct mili_label order by mili_label) as mili_labels,
        -- the closest MusicBrainz work, for checking by hand (or by the AI judge)
        max_by(work_id, title_similarity) as closest_work_id,
        max_by(mb_title, title_similarity) as closest_mb_title,
        max_by(mb_artist, title_similarity) as closest_mb_artist,
        max(title_similarity) as closest_title_similarity,
        max_by(artist_similarity, title_similarity) as closest_artist_similarity,
        max(fetched_at) as fetched_at
    from items i
    where not exists (select 1 from known_urls k where k.url_key = i.url_key)
    group by url_key

)

select
    url_key,
    item_url,
    item_title,
    item_artist,
    item_type,          -- album or track
    bandcamp_id,
    mili_labels,
    closest_work_id,
    closest_mb_title,
    closest_mb_artist,
    closest_title_similarity,
    closest_artist_similarity,
    case
        when closest_title_similarity >= {{ var('bandcamp_uncertain_from') }}
             and (closest_artist_similarity is null or closest_artist_similarity >= 0.80)
            then 'uncertain'
        else 'bandcamp_only'
    end as decision,
    fetched_at
from per_release
