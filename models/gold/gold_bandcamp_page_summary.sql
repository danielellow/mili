-- GOLD (analysis): what reading the labels' own Bandcamp pages added, per label.
--
--   releases_on_page            releases listed on the label's Bandcamp page
--   matched / not_matched       matched to one of the label's works, or not
--                               (not_matched = on Bandcamp, missing from MusicBrainz)
--   works_with_bandcamp_before  works with a Bandcamp link from MusicBrainz only
--   works_with_bandcamp_now     works with a Bandcamp link from any source

with totals as (

    select mili_label, count(*) as works_total
    from {{ ref('gold_label_works') }}
    group by 1

),

page as (

    select
        mili_label,
        count(*) as releases_on_page,
        count(*) filter (where is_matched) as matched,
        count(*) filter (where not is_matched) as not_matched
    from {{ ref('silver_bandcamp_label_matches') }}
    group by 1

),

before as (

    select lw.mili_label, count(distinct u.release_group_id) as works
    from {{ ref('silver_mb_urls') }} u
    join {{ ref('gold_label_works') }} lw
        on lw.work_id = u.release_group_id
    where u.platform_id = 'bandcamp'
    group by 1

),

now as (

    select lw.mili_label, count(distinct i.work_id) as works
    from {{ ref('gold_instances') }} i
    join {{ ref('gold_label_works') }} lw
        on lw.work_id = i.work_id
    where i.platform_id = 'bandcamp'
    group by 1

)

select
    t.mili_label,
    t.works_total,
    p.releases_on_page,
    p.matched,
    p.not_matched,
    coalesce(b.works, 0) as works_with_bandcamp_before,
    coalesce(n.works, 0) as works_with_bandcamp_now
from totals t
left join page p on p.mili_label = t.mili_label
left join before b on b.mili_label = t.mili_label
left join now n on n.mili_label = t.mili_label
order by t.works_total
