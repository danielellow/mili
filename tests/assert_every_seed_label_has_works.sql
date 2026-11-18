-- TEST: every label in the seed file should end up with at least one work.
--
-- dbt runs this query during `dbt build`. The test passes if it returns no rows.
-- If a label shows up here, its releases got lost somewhere on the way
-- (this is the test that would have caught the STROOM.tv problem).

select distinct s.mili_label
from {{ ref('labels') }} s
left join {{ ref('gold_label_works') }} w
    on w.mili_label = s.mili_label
where w.work_id is null
