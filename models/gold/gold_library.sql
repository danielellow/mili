-- GOLD (for the website): your library, one row per object.
--
-- If the same object is in the file twice, it's in the library once: with the
-- earliest date, "collection" if either row says so, and all the collages.

select
    object_id,
    min(added_on) as added_on,
    case when bool_or(status = 'collection') then 'collection' else 'queue' end as status,
    list_sort(list_distinct(flatten(list(collages)))) as collages
from {{ ref('silver_library') }}
where object_id is not null
group by object_id
