-- GOLD (analysis): per label, where mili's objects come from.
--
--   objects_total        all objects on the label
--   from_musicbrainz     works MusicBrainz knows
--   bandcamp_only        releases on the label's Bandcamp page that MusicBrainz
--                        doesn't have
--   waiting_for_decision Bandcamp releases close to a MusicBrainz work, not yet
--                        objects (decision = uncertain in silver_bandcamp_unmatched)
--   share_bandcamp_only  bandcamp_only / objects_total

with objects as (

    select ol.mili_label, o.identity_source
    from {{ ref('gold_object_labels') }} ol
    join {{ ref('gold_objects') }} o
        on o.object_id = ol.object_id

),

counts as (

    select
        mili_label,
        count(*) as objects_total,
        count(*) filter (where identity_source = 'musicbrainz') as from_musicbrainz,
        count(*) filter (where identity_source = 'bandcamp_page') as bandcamp_only
    from objects
    group by 1

),

waiting as (

    select label as mili_label, count(*) as waiting_for_decision
    from (
        select unnest(mili_labels) as label
        from {{ ref('silver_bandcamp_unmatched') }}
        where decision = 'uncertain'
    )
    group by 1

)

select
    c.mili_label,
    c.objects_total,
    c.from_musicbrainz,
    c.bandcamp_only,
    coalesce(w.waiting_for_decision, 0) as waiting_for_decision,
    round(c.bandcamp_only / c.objects_total, 3) as share_bandcamp_only
from counts c
left join waiting w
    on w.mili_label = c.mili_label
order by share_bandcamp_only desc, c.mili_label
