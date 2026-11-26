-- GOLD (for the app): the songs on each release, in order.
--
-- Where the songs come from:
--   1. MusicBrainz, for releases from the catalogue (one chosen edition each,
--      see silver_mb_track_releases)
--   2. Apple, for releases MusicBrainz doesn't have but Apple Music does
-- A release gets its songs from one source only: MusicBrainz when it has them.
-- Bandcamp-only releases have no songs here; the site shows Bandcamp's own
-- player for them instead (see gold_bandcamp_players).

with from_musicbrainz as (
    select
        o.object_id,
        t.disc,
        t.position_on_disc,
        t.number,
        t.title,
        t.artist,
        t.length_ms,
        'musicbrainz' as source
    from {{ ref('gold_objects') }} o
    join {{ ref('silver_mb_track_releases') }} r
        on r.work_id = o.work_id
    join {{ ref('silver_mb_tracks') }} t
        on t.release_id = r.release_id
    where o.identity_source = 'musicbrainz'
),

from_apple as (
    select
        a.object_id,
        a.disc,
        a.position_on_disc,
        cast(a.position_on_disc as varchar) as number,
        a.title,
        a.artist,
        a.length_ms,
        'apple' as source
    from {{ ref('silver_apple_tracks') }} a
    where a.object_id not in (select object_id from from_musicbrainz)
),

both_sources as (
    select * from from_musicbrainz
    union all
    select * from from_apple
)

select
    object_id || '-' || lpad(cast(row_number() over (
        partition by object_id order by disc, position_on_disc) as varchar), 3, '0') as track_id,
    object_id,
    cast(row_number() over (partition by object_id order by disc, position_on_disc) as integer) as track_no,
    disc,
    number,
    title,
    artist,
    length_ms,
    source
from both_sources
