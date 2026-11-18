-- GOLD (analysis): how the barcode lookups went, per platform.
-- Useful for the report: how many works were found, how many matched on the
-- exact barcode, how many needed the title check, and how many were rejected.

select
    platform_id,
    count(*) as works_looked_up,
    count(*) filter (where status = 'found') as found,
    count(*) filter (where status = 'not_found') as not_found,
    count(*) filter (where is_accepted and matched_on = 'barcode') as accepted_on_barcode,
    count(*) filter (where is_accepted and matched_on = 'other_barcode') as accepted_on_title,
    count(*) filter (where status = 'found' and not is_accepted) as rejected
from {{ ref('silver_platform_matches') }}
group by 1
order by 1
