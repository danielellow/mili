-- GOLD (analysis): for each label and platform, how many of the label's works
-- have a link to that platform in MusicBrainz.
--
-- Note: this measures what MusicBrainz KNOWS, not yet what is really available.
-- A missing link can mean the work isn't on the platform, or just that nobody
-- has added the link. Later steps (Odesli, Bandcamp) will fill in more.

with label_totals as (

    select mili_label, count(*) as works_total
    from {{ ref('gold_label_works') }}
    group by 1

),

linked as (

    select
        lw.mili_label,
        i.platform_id,
        count(distinct i.work_id) as works_with_known_link
    from {{ ref('gold_label_works') }} lw
    join {{ ref('gold_instances') }} i
        on i.work_id = lw.work_id
    group by 1, 2

)

select
    t.mili_label,
    p.platform_id,
    p.display_name as platform,
    t.works_total,
    coalesce(l.works_with_known_link, 0) as works_with_known_link,
    round(coalesce(l.works_with_known_link, 0) / t.works_total, 3) as share_with_known_link
from label_totals t
cross join {{ ref('platforms') }} p
left join linked l
    on l.mili_label = t.mili_label
    and l.platform_id = p.platform_id
order by t.mili_label, p.default_order nulls last
