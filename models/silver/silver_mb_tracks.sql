-- SILVER: one row per song on each MusicBrainz release, in order.
--
-- A release has one or more media (discs, or sides of a set), and each medium
-- has its tracks. "number" is what's printed on the release: 1, 2, 3, or A1, B2
-- on vinyl. The artist is the track's own credit, which matters on
-- compilations, put together from the names and the words between them
-- ("Tsvi" + " & " + "Loraine James").
-- The newest answer per release is used.

with newest as (
    select *
    from {{ ref('bronze_mb_release_tracks') }}
    qualify row_number() over (partition by release_id order by fetched_at desc) = 1
),

media as (
    select
        work_id,
        release_id,
        json_extract_string(response, '$."artist-credit"[0].name') as release_artist,
        unnest(cast(json_extract(response, '$.media') as json[])) as medium
    from newest
),

tracks as (
    select
        work_id,
        release_id,
        release_artist,
        cast(json_extract_string(medium, '$.position') as integer) as disc,
        json_extract_string(medium, '$.format') as disc_format,
        unnest(cast(json_extract(medium, '$.tracks') as json[])) as track
    from media
),

numbered as (
    select
        *,
        cast(json_extract_string(track, '$.position') as integer) as position_on_disc
    from tracks
),

credits as (
    -- each name in a track's artist credit, in order, with the words after it
    select
        release_id,
        disc,
        position_on_disc,
        generate_subscripts(cast(json_extract(track, '$."artist-credit"') as json[]), 1) as credit_order,
        unnest(cast(json_extract(track, '$."artist-credit"') as json[])) as credit
    from numbered
),

track_artists as (
    select
        release_id,
        disc,
        position_on_disc,
        string_agg(
            json_extract_string(credit, '$.name') || coalesce(json_extract_string(credit, '$.joinphrase'), ''),
            '' order by credit_order) as artist
    from credits
    group by release_id, disc, position_on_disc
)

select
    n.work_id,
    n.release_id,
    n.disc,
    n.disc_format,
    n.position_on_disc,
    json_extract_string(n.track, '$.number') as number,
    json_extract_string(n.track, '$.title') as title,
    coalesce(a.artist, n.release_artist) as artist,
    try_cast(json_extract_string(n.track, '$.length') as integer) as length_ms,
    json_extract_string(n.track, '$.recording.id') as recording_id
from numbered n
left join track_artists a
    on a.release_id = n.release_id
   and a.disc = n.disc
   and a.position_on_disc = n.position_on_disc
order by n.release_id, n.disc, n.position_on_disc
