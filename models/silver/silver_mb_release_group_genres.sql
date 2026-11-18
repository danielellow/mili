-- SILVER: one row per genre per work, with how many MusicBrainz users voted for it.
-- Genres are taken from the release group (album level), where they are much
-- more complete than on single editions.

select
    release_group_id,
    g ->> '$.name' as genre,
    try_cast(g ->> '$.count' as integer) as votes
from {{ ref('silver_mb_release_groups') }},
    unnest(json_extract(release_group_json, '$.genres[*]')) as t(g)
