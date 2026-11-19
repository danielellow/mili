-- GOLD (analysis): how the Deezer artist + title search went, split by whether
-- the work has a barcode. This shows how much of the "blind spot" (works we
-- couldn't look up by barcode) turns out to be on Deezer after all.

select
    has_barcode,
    count(*) as works_searched,
    count(*) filter (where status = 'not_found') as no_candidates,
    count(*) filter (where status = 'found') as with_candidates,
    count(*) filter (where is_accepted) as accepted,
    count(*) filter (where status = 'found' and not is_accepted) as rejected
from {{ ref('silver_deezer_title_matches') }}
group by 1
order by 1
