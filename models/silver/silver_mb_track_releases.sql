-- SILVER: for each MusicBrainz work, the one edition whose track list mili shows.
--
-- An album can have many editions (vinyl, CD, digital, reissues), and their
-- track lists can differ a little (bonus tracks, vinyl sides). We pick one, in
-- this order:
--   1. an official release before a promo or bootleg
--   2. digital before physical, since that's closest to what people stream
--   3. one that has tracks at all
--   4. the earliest
--   5. then simply by ID, so the choice never changes between runs
-- ingest/musicbrainz_fetch_tracks.py asks MusicBrainz for these editions' songs.

select
    release_group_id as work_id,
    release_id,
    title,
    formats,
    track_count,
    release_date
from {{ ref('silver_mb_releases') }}
qualify row_number() over (
    partition by release_group_id
    order by
        (status = 'Official') desc nulls last,
        (formats ilike '%digital%') desc nulls last,
        (coalesce(track_count, 0) > 0) desc,
        release_date nulls last,
        release_id
) = 1
