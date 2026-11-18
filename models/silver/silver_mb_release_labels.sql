-- SILVER: which labels each release is on, with the catalogue number.
--
-- A release can list several labels (co-releases, licensing). We keep them all,
-- and mark the ones that are among our seed labels, with their mili label name
-- (so Whities shows up as AD 93).

with label_info as (

    select
        r.release_id,
        li ->> '$.label.id' as label_mbid,
        li ->> '$.label.name' as label_name,
        nullif(li ->> '$.catalog-number', '') as catalog_number
    from {{ ref('silver_mb_releases') }} r,
        unnest(json_extract(r.release_json, '$.label-info[*]')) as t(li)

)

select distinct
    label_info.release_id,
    label_info.label_mbid,
    label_info.label_name,
    label_info.catalog_number,
    seed.mili_label,
    seed.mili_label is not null as is_seed_label
from label_info
left join {{ ref('labels') }} as seed
    on seed.musicbrainz_id = label_info.label_mbid
where label_info.label_mbid is not null
