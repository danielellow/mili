-- SILVER: for each work we searched for on Deezer by name: the best candidate,
-- and whether we trust it.
--
-- Without a barcode, the only evidence is the names, so the check is strict:
--   artist_similarity >= 0.90   (the main artist matches)
--   title_similarity  >= 0.92   (the title matches, with or without brackets,
--                                so "Haw (Remastered)" still matches "Haw")
-- Similarity runs from 0 (nothing alike) to 1 (identical), after making
-- both names comparable (lowercase, no punctuation).

with newest as (

    select
        *,
        row_number() over (partition by work_id order by fetched_at desc) as newest_first
    from {{ ref('bronze_deezer_title_search') }}
    where status in ('found', 'not_found')     -- errors get retried, so we skip them here

),

latest as (

    select * from newest where newest_first = 1

),

candidates as (

    -- one row per candidate album Deezer suggested
    select
        l.work_id,
        c ->> '$.title' as deezer_title,
        c ->> '$.artist.name' as deezer_artist,
        c ->> '$.link' as url,
        c ->> '$.record_type' as deezer_record_type
    from latest l,
        unnest(json_extract(l.response, '$.data[*]')) as t(c)

),

scored as (

    select
        c.*,
        w.title as mb_title,
        w.release_group_json ->> '$.artist-credit[0].name' as mb_artist,
        greatest(
            jaro_winkler_similarity({{ normalize_title('w.title') }}, {{ normalize_title('c.deezer_title') }}),
            jaro_winkler_similarity({{ core_title('w.title') }}, {{ core_title('c.deezer_title') }})
        ) as title_similarity,
        jaro_winkler_similarity(
            {{ normalize_artist("w.release_group_json ->> '$.artist-credit[0].name'") }},
            {{ normalize_artist('c.deezer_artist') }}
        ) as artist_similarity
    from candidates c
    join {{ ref('silver_mb_release_groups') }} w
        on w.release_group_id = c.work_id

),

best as (

    -- the candidate whose title and artist together look most alike
    select
        *,
        row_number() over (
            partition by work_id
            order by title_similarity + artist_similarity desc, url
        ) as candidate_rank
    from scored

)

select
    l.work_id,
    l.has_barcode,
    l.status,
    l.title as mb_title,
    l.main_artist as mb_artist,
    b.deezer_title,
    b.deezer_artist,
    b.deezer_record_type,
    b.url,
    round(b.title_similarity, 3) as title_similarity,
    round(b.artist_similarity, 3) as artist_similarity,
    coalesce(
        b.artist_similarity >= 0.90 and b.title_similarity >= 0.92,
        false
    ) as is_accepted,
    l.fetched_at
from latest l
-- only works that still exist in our catalogue
join {{ ref('silver_mb_release_groups') }} w
    on w.release_group_id = l.work_id
left join best b
    on b.work_id = l.work_id
    and b.candidate_rank = 1
