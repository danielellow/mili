-- TEST: every object with versions should have exactly one main version
-- (the one its page shows first). The test passes if this returns no rows.

select
    object_id,
    count(*) filter (where is_main) as main_versions
from {{ ref('gold_object_versions') }}
group by object_id
having count(*) filter (where is_main) <> 1
