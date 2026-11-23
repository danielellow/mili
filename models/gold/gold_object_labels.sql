-- GOLD (for the app): which objects belong to which mili label.
-- MusicBrainz works take their labels from gold_label_works; Bandcamp-only
-- releases take the label whose Bandcamp page they're on. Mixes have no label.

select distinct
    o.object_id,
    lw.mili_label
from {{ ref('gold_label_works') }} lw
join {{ ref('gold_objects') }} o
    on o.work_id = lw.work_id

union

select distinct
    o.object_id,
    unnest(b.mili_labels) as mili_label
from {{ ref('silver_bandcamp_unmatched') }} b
join {{ ref('gold_objects') }} o
    on o.born_from = 'link:' || b.url_key
where b.decision = 'bandcamp_only'
