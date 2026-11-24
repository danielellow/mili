-- GOLD (for the app): the VERSIONS of each object, one row per object and version.
--
--   object    "Wind"
--   version   "Wind", "Wind (Deluxe Version)" ...
--   instance  where each version lives (gold_object_instances, by version_id)
--
-- is_main: the version the page shows first. The standard version when we have
-- links to it; otherwise the version on the most platforms.
-- versions_total lets the page say "2 versions".
--
-- maybe_another_release: a "version" called live, remixes, demos ... is
-- probably a different work that was matched by mistake (silver_link_versions).
-- It's never picked as the main version (unless it's all there is), and it
-- doesn't count in versions_total.
--
-- Objects without any links have no versions yet.

with wordings as (

    -- how often each wording of a version is used
    select version_id, version_label, count(*) as uses
    from {{ ref('gold_object_instances') }}
    group by 1, 2

),

best_wording as (

    -- the most common wording: "Deluxe Version" rather than "Deluxe Edition"
    -- (when it's a tie, the shorter one, then alphabetical, so it's the same on
    -- every run: "Remastered" rather than "Digitally Remastered")
    select version_id, version_label
    from (
        select
            *,
            row_number() over (
                partition by version_id order by uses desc, length(version_label), version_label
            ) as preference
        from wordings
    )
    where preference = 1

),

grouped as (

    select
        i.object_id,
        i.version_id,
        i.version_key,
        w.version_label,
        bool_or(i.maybe_another_release) as maybe_another_release,
        count(distinct i.platform_id) as platforms,
        count(*) as links
    from {{ ref('gold_object_instances') }} i
    join best_wording w
        on w.version_id = i.version_id
    group by i.object_id, i.version_id, i.version_key, w.version_label

),

ranked as (

    select
        *,
        row_number() over (
            partition by object_id
            order by maybe_another_release, (version_key = '') desc, platforms desc, links desc, version_key
        ) as version_rank
    from grouped

)

select
    r.version_id,
    r.object_id,
    r.version_key,                              -- '' = the standard version
    nullif(r.version_label, '') as version_label,
    case
        when r.version_key = '' then o.title
        else o.title || ' (' || r.version_label || ')'
    end as display_title,                       -- "Wind (Deluxe Version)"
    r.platforms,
    r.links,
    r.version_rank = 1 as is_main,
    r.maybe_another_release,
    sum(case when r.maybe_another_release then 0 else 1 end) over (partition by r.object_id)
        as versions_total
from ranked r
join {{ ref('gold_objects') }} o
    on o.object_id = r.object_id
