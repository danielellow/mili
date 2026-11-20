-- GOLD (analysis): what Odesli added, per platform.
--   links            links Odesli gave for this platform
--   accepted         passed the title check (these go into gold_instances)
--   rejected         title didn't look like the MusicBrainz title

select
    platform_id,
    count(*) as links,
    count(*) filter (where is_accepted) as accepted,
    count(*) filter (where not is_accepted) as rejected
from {{ ref('silver_odesli_links') }}
where platform_id is not null
group by 1
order by accepted desc
