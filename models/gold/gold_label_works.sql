-- GOLD: which works belong to which mili label.
-- A work belongs to a label if at least one of its editions is on that label.
-- (Whities and AD 93 both count as "AD 93", through the labels seed.)

select distinct
    l.mili_label,
    r.release_group_id as work_id
from {{ ref('silver_mb_release_labels') }} l
join {{ ref('silver_mb_releases') }} r
    on r.release_id = l.release_id
where l.is_seed_label
