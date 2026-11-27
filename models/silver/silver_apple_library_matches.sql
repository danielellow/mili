-- SILVER: for each thing from your Bandcamp collection we searched for on Apple
-- Music: the best candidate, and whether we trust it. Tracks were searched as
-- songs, so a track can be matched to that same track on Apple Music.
--
-- The same strict check as the other name searches:
--   title_similarity >= 0.92 (with or without brackets, " - EP"/" - Single" ignored)
--   and the artist matches: artist_similarity >= 0.90, or the main artist is
--   one of the names Apple lists.
-- A song's link keeps its "?i=<song ID>", which says which song on the album it is.

with newest as (

    select
        *,
        row_number() over (partition by born_from order by fetched_at desc) as newest_first
    from {{ ref('bronze_apple_title_search_library') }}
    where status in ('found', 'not_found')

),

latest as (

    select * from newest where newest_first = 1

),

collection as (

    -- what you bought, as shown on your collection page
    select born_from, title, artist
    from {{ ref('silver_bandcamp_collection') }}
    where decision = 'new'

),

candidates as (

    select
        l.born_from,
        l.item_type,
        case when c ->> '$.wrapperType' = 'track' then c ->> '$.trackName' else c ->> '$.collectionName' end
            as apple_title,
        c ->> '$.artistName' as apple_artist,
        case
            when c ->> '$.wrapperType' = 'track'
                then split_part(c ->> '$.trackViewUrl', '?', 1)
                     || coalesce('?i=' || nullif(regexp_extract(c ->> '$.trackViewUrl', '[?&]i=(\d+)', 1), ''), '')
            else split_part(c ->> '$.collectionViewUrl', '?', 1)
        end as url,
        nullif(left(c ->> '$.releaseDate', 10), '') as apple_release_date,
        -- for the year and label on the site (gold_release_details): the album's
        -- name ("Untitled - EP") and copyright line ("℗ 2026 FELT"). Songs have no
        -- copyright line in Apple's answer, only the album they're on.
        nullif(c ->> '$.collectionName', '') as apple_album_title,
        nullif(c ->> '$.copyright', '') as apple_copyright
    from latest l,
        unnest(json_extract(l.response, '$.results[*]')) as t(c)
    where c ->> '$.wrapperType' in ('collection', 'track')

),

scored as (

    select
        c.*,
        k.title as bandcamp_title,
        k.artist as bandcamp_artist,
        greatest(
            jaro_winkler_similarity({{ normalize_title('k.title') }}, {{ normalize_title('c.apple_title') }}),
            jaro_winkler_similarity({{ core_title('k.title') }}, {{ core_title('c.apple_title') }})
        ) as title_similarity,
        jaro_winkler_similarity({{ normalize_artist('k.artist') }}, {{ normalize_artist('c.apple_artist') }})
            as artist_similarity,
        coalesce(
            list_contains(
                list_transform(
                    regexp_split_to_array(
                        c.apple_artist,
                        '\s*,\s*|\s+(&|/|\+|:|[xX]|(?i:feat\.?|featuring|ft\.|vs\.?|with))\s+'
                    ),
                    lambda name: regexp_replace({{ normalize_title('name') }}, '^the\s+', '')
                ),
                regexp_replace({{ normalize_artist('k.artist') }}, '^the\s+', '')
            )
            or starts_with({{ normalize_artist('c.apple_artist') }} || ' ', {{ normalize_artist('k.artist') }} || ' ')
            or starts_with({{ normalize_artist('k.artist') }} || ' ', {{ normalize_artist('c.apple_artist') }} || ' '),
            false
        ) as artist_listed
    from candidates c
    join collection k
        on k.born_from = c.born_from

),

best as (

    select
        *,
        (artist_similarity >= 0.90 or artist_listed) and title_similarity >= 0.92 as is_accepted,
        row_number() over (
            partition by born_from
            order by
                (artist_similarity >= 0.90 or artist_listed) and title_similarity >= 0.92 desc,
                title_similarity + artist_similarity desc,
                url
        ) as candidate_rank
    from scored

)

select
    l.born_from,
    l.item_type,
    l.status,
    l.title as bandcamp_title,
    l.artist as bandcamp_artist,
    b.apple_title,
    b.apple_artist,
    b.apple_release_date,
    b.apple_album_title,
    b.apple_copyright,
    b.url,
    round(b.title_similarity, 3) as title_similarity,
    round(b.artist_similarity, 3) as artist_similarity,
    coalesce(b.artist_listed, false) as artist_listed,
    coalesce(b.is_accepted, false) as is_accepted,
    l.fetched_at
from latest l
join collection k
    on k.born_from = l.born_from
left join best b
    on b.born_from = l.born_from
    and b.candidate_rank = 1
