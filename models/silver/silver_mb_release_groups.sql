-- SILVER: one row per release group, which in mili is a WORK
-- (the album, EP or single above all of its editions).
--
-- The release group comes along inside every release, so we take the copy
-- from the most recently fetched release of each group.

with newest as (

    select
        release_json ->> '$.release-group.id' as release_group_id,
        arg_max(json_extract(release_json, '$.release-group'), fetched_at) as release_group_json
    from {{ ref('bronze_mb_releases') }}
    group by 1

)

select
    release_group_id,
    release_group_json ->> '$.title' as title,
    lower(release_group_json ->> '$.primary-type') as primary_type,  -- album, ep, single ...
    array_to_string(
        json_extract_string(release_group_json, '$.secondary-types[*]'), ', '
    ) as secondary_types,  -- e.g. compilation, live, remix
    nullif(release_group_json ->> '$.first-release-date', '') as first_release_date,
    try_cast(left(release_group_json ->> '$.first-release-date', 4) as integer)
        as first_release_year,
    array_to_string(
        list_transform(
            json_extract(release_group_json, '$.artist-credit[*]'),
            lambda c: coalesce(c ->> '$.name', '') || coalesce(c ->> '$.joinphrase', '')
        ),
        ''
    ) as artist_credit,
    release_group_json

from newest
