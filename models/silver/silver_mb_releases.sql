-- SILVER: one row per release (edition), cleaned.
--
-- 1. If the same release was fetched in several runs, keep only the newest copy.
-- 2. Pull the useful fields out of the JSON into normal columns.
-- The full JSON is kept in the last column, so later models can unpack lists
-- (links, labels) from it.

with ranked as (

    select
        *,
        row_number() over (
            partition by release_id
            order by fetched_at desc
        ) as newest_first
    from {{ ref('bronze_mb_releases') }}

),

latest as (

    select * from ranked where newest_first = 1

)

select
    release_id,
    release_json ->> '$.title' as title,
    release_json ->> '$.status' as status,
    nullif(release_json ->> '$.date', '') as release_date,
    try_cast(left(release_json ->> '$.date', 4) as integer) as release_year,
    nullif(release_json ->> '$.country', '') as country,
    nullif(release_json ->> '$.barcode', '') as barcode,
    release_json ->> '$.packaging' as packaging,
    release_json ->> '$.release-group.id' as release_group_id,

    -- e.g. "TSVI & Loraine James": each artist's name followed by its join word
    array_to_string(
        list_transform(
            json_extract(release_json, '$.artist-credit[*]'),
            lambda c: coalesce(c ->> '$.name', '') || coalesce(c ->> '$.joinphrase', '')
        ),
        ''
    ) as artist_credit,

    -- e.g. "12\" Vinyl, Digital Media"
    array_to_string(
        list_distinct(
            list_transform(json_extract(release_json, '$.media[*]'), lambda m: m ->> '$.format')
        ),
        ', '
    ) as formats,

    list_sum(
        list_transform(
            json_extract(release_json, '$.media[*]'),
            lambda m: try_cast(m ->> '$.track-count' as integer)
        )
    )::integer as track_count,

    coalesce(try_cast(release_json ->> '$.cover-art-archive.front' as boolean), false)
        as has_front_cover,

    fetched_at,
    release_json

from latest
