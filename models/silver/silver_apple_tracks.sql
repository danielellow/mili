-- SILVER: one row per song on each album Apple told us about, in order.
-- Apple's answer lists the album first, then its songs (and sometimes music
-- videos, which we leave out). The newest answer per release is used.

with newest as (
    select *
    from {{ ref('bronze_apple_tracks') }}
    qualify row_number() over (partition by object_id order by fetched_at desc) = 1
),

results as (
    select
        object_id,
        album_id,
        unnest(cast(json_extract(response, '$.results') as json[])) as result
    from newest
)

select
    object_id,
    album_id,
    coalesce(try_cast(json_extract_string(result, '$.discNumber') as integer), 1) as disc,
    try_cast(json_extract_string(result, '$.trackNumber') as integer) as position_on_disc,
    json_extract_string(result, '$.trackName') as title,
    json_extract_string(result, '$.artistName') as artist,
    try_cast(json_extract_string(result, '$.trackTimeMillis') as integer) as length_ms
from results
where json_extract_string(result, '$.wrapperType') = 'track'
  and coalesce(json_extract_string(result, '$.kind'), 'song') = 'song'
