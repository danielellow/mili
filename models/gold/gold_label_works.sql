-- GOLD: which works belong to which mili label.
--
-- A work belongs to a label if at least one of its editions came back when we
-- asked MusicBrainz for that label's releases, in the most recent run for that
-- label. (Whities and AD 93 both count as "AD 93", through the labels seed.)
--
-- Why we use the fetch itself, and not the label IDs printed on each release:
-- MusicBrainz sometimes merges two entries for the same label. The old ID still
-- works when fetching (MusicBrainz forwards it), but the releases then carry the
-- new ID, so matching on IDs would silently lose the label. That happened with
-- STROOM.tv.

with latest_run as (

    select
        label_mbid,
        max(run_id) as run_id   -- run folders are named by time, so max = newest
    from {{ ref('bronze_mb_releases') }}
    group by 1

),

fetched as (

    select distinct
        b.mili_label,
        b.release_id
    from {{ ref('bronze_mb_releases') }} b
    join latest_run l
        on l.label_mbid = b.label_mbid
        and l.run_id = b.run_id

)

select distinct
    f.mili_label,
    r.release_group_id as work_id
from fetched f
join {{ ref('silver_mb_releases') }} r
    on r.release_id = f.release_id
