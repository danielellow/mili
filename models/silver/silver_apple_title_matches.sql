-- SILVER: for each work we searched for on Apple Music by name: the best
-- candidate, and whether we trust it.
--
-- Without a barcode, the only evidence is the names, so the check is as strict
-- as the Deezer name search (silver_deezer_title_matches):
--   title_similarity  >= 0.92   the title matches, with or without brackets
--                               ("Haw (Remastered)" still matches "Haw"), and
--                               Apple's " - EP" / " - Single" don't count
--   and the artist matches:
--     artist_similarity >= 0.90, or
--     artist_listed: the main artist is one of the names Apple lists
--     ("Kode9 & The Spaceape" for "Kode9"), as in the Bandcamp and Discogs matching
-- Similarity runs from 0 (nothing alike) to 1 (identical).

with newest as (

    select
        *,
        row_number() over (partition by work_id order by fetched_at desc) as newest_first
    from {{ ref('bronze_apple_title_search') }}
    where status in ('found', 'not_found')     -- errors get retried, so we skip them here

),

latest as (

    select * from newest where newest_first = 1

),

candidates as (

    -- one row per candidate album Apple suggested
    select
        l.work_id,
        c ->> '$.collectionName' as apple_title,
        c ->> '$.artistName' as apple_artist,
        split_part(c ->> '$.collectionViewUrl', '?', 1) as url,   -- without tracking bits
        nullif(left(c ->> '$.releaseDate', 10), '') as apple_release_date,
        try_cast(c ->> '$.trackCount' as integer) as track_count
    from latest l,
        unnest(json_extract(l.response, '$.results[*]')) as t(c)
    where c ->> '$.wrapperType' = 'collection'

),

scored as (

    select
        c.*,
        w.title as mb_title,
        w.release_group_json ->> '$.artist-credit[0].name' as mb_artist,
        greatest(
            jaro_winkler_similarity({{ normalize_title('w.title') }}, {{ normalize_title('c.apple_title') }}),
            jaro_winkler_similarity({{ core_title('w.title') }}, {{ core_title('c.apple_title') }})
        ) as title_similarity,
        jaro_winkler_similarity(
            {{ normalize_artist("w.release_group_json ->> '$.artist-credit[0].name'") }},
            {{ normalize_artist('c.apple_artist') }}
        ) as artist_similarity,
        coalesce(
            list_contains(
                list_transform(
                    regexp_split_to_array(
                        c.apple_artist,
                        '\s*,\s*|\s+(&|/|\+|:|[xX]|(?i:feat\.?|featuring|ft\.|vs\.?|with))\s+'
                    ),
                    lambda name: regexp_replace({{ normalize_title('name') }}, '^the\s+', '')
                ),
                regexp_replace(
                    {{ normalize_artist("w.release_group_json ->> '$.artist-credit[0].name'") }}, '^the\s+', ''
                )
            )
            or starts_with(
                {{ normalize_artist('c.apple_artist') }} || ' ',
                {{ normalize_artist("w.release_group_json ->> '$.artist-credit[0].name'") }} || ' '
            ),
            false
        ) as artist_listed
    from candidates c
    join {{ ref('silver_mb_release_groups') }} w
        on w.release_group_id = c.work_id

),

judged as (

    select
        *,
        (artist_similarity >= 0.90 or artist_listed) and title_similarity >= 0.92 as is_accepted
    from scored

),

best as (

    -- an accepted candidate first, then the one whose names look most alike
    select
        *,
        row_number() over (
            partition by work_id
            order by is_accepted desc, title_similarity + artist_similarity desc, url
        ) as candidate_rank
    from judged

)

select
    l.work_id,
    l.has_barcode,
    l.unheard,
    l.status,
    l.title as mb_title,
    l.main_artist as mb_artist,
    b.apple_title,
    b.apple_artist,
    b.apple_release_date,
    b.url,
    round(b.title_similarity, 3) as title_similarity,
    round(b.artist_similarity, 3) as artist_similarity,
    coalesce(b.artist_listed, false) as artist_listed,
    coalesce(b.is_accepted, false) as is_accepted,
    l.fetched_at
from latest l
-- only works that still exist in our catalogue
join {{ ref('silver_mb_release_groups') }} w
    on w.release_group_id = l.work_id
left join best b
    on b.work_id = l.work_id
    and b.candidate_rank = 1
