-- TEST: every MusicBrainz work should be exactly one mili object.
--
-- dbt runs this query during `dbt build`. The test passes if it returns no rows.
-- A work showing up here either got lost on the way to gold_objects (0 objects)
-- or was turned into an object twice (2 or more).

select
    w.work_id,
    count(o.object_id) as objects
from {{ ref('gold_works') }} w
left join {{ ref('gold_objects') }} o
    on o.work_id = w.work_id
group by w.work_id
having count(o.object_id) <> 1
