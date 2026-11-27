-- GOLD (for the app): every place an object lives, one row per object and link.
--
--   MusicBrainz works   all their instances from gold_instances (with the
--                       sources that gave each link)
--   Bandcamp-only       the release's page on the label's Bandcamp
--   mixes               the link added by hand, and where else the platform
--                       says it can be heard (an NTS episode's Mixcloud page)
--
-- Each link also says which VERSION of the work it is (gold_object_versions),
-- read from the title the platform shows (silver_link_versions).
--
-- Each link has a confidence from 0 to 1 (see seeds/match_confidence.csv).
-- A Bandcamp-only release's own page and a mix's own link get 1.0, because
-- the object was born from them.
--
-- gold_instances itself stays keyed by MusicBrainz work, because the lookup
-- scripts use it to decide what still needs looking up.

with from_works as (

    select
        o.object_id,
        i.platform_id,
        i.url,
        i.sources,
        i.methods,
        i.confidence,
        i.relation_types,
        i.editions_linked,
        i.linked_at_album_level
    from {{ ref('gold_instances') }} i
    join {{ ref('gold_objects') }} o
        on o.work_id = i.work_id

),

from_bandcamp as (

    select
        o.object_id,
        'bandcamp' as platform_id,
        b.item_url as url,
        'bandcamp_page' as sources,
        'origin' as methods,          -- the page the object was born from
        1.0::double as confidence,
        null::varchar as relation_types,
        0::bigint as editions_linked,
        true as linked_at_album_level
    from {{ ref('silver_bandcamp_unmatched') }} b
    join {{ ref('gold_objects') }} o
        on o.born_from = 'link:' || b.url_key

),

from_mixes as (

    select
        o.object_id,
        m.platform_id,
        m.url,
        'added_by_hand' as sources,
        'origin' as methods,
        1.0::double as confidence,
        null::varchar as relation_types,
        0::bigint as editions_linked,
        true as linked_at_album_level
    from {{ ref('silver_mixes') }} m
    join {{ ref('gold_objects') }} o
        on o.born_from = 'link:' || m.url_key

),

from_mix_other_links as (

    select
        o.object_id,
        case
            when l.link like '%mixcloud.com%' then 'mixcloud'
            when l.link like '%soundcloud.com%' then 'soundcloud'
            when l.link like '%nts.live%' then 'nts'
        end as platform_id,
        l.link as url,
        'nts' as sources,
        'named_by_platform' as methods,
        1.0::double as confidence,
        null::varchar as relation_types,
        0::bigint as editions_linked,
        true as linked_at_album_level
    from (
        select url_key, unnest(other_links) as link
        from {{ ref('silver_mixes') }}
    ) l
    join {{ ref('gold_objects') }} o
        on o.born_from = 'link:' || l.url_key

),

from_collection as (

    -- the Bandcamp page of something from your collection that mili didn't know yet
    select
        o.object_id,
        'bandcamp' as platform_id,
        c.url,
        'bandcamp_collection' as sources,
        'origin' as methods,
        1.0::double as confidence,
        null::varchar as relation_types,
        0::bigint as editions_linked,
        true as linked_at_album_level
    from {{ ref('silver_bandcamp_collection') }} c
    join {{ ref('gold_objects') }} o
        on o.born_from = c.born_from
    where c.decision = 'new'
      and c.url is not null

),

from_collection_searches as (

    -- what the Apple search and Odesli found for your Bandcamp collection
    -- (the --library runs), with their confidence from seeds/match_confidence.csv
    select
        o.object_id,
        found.platform_id,
        found.url,
        found.method as sources,
        found.method as methods,
        c.confidence,
        null::varchar as relation_types,
        0::bigint as editions_linked,
        true as linked_at_album_level
    from (
        select born_from, 'apple_music' as platform_id, url, 'apple_title_search' as method
        from {{ ref('silver_apple_library_matches') }}
        where is_accepted and url is not null
        union all
        select born_from, platform_id, url, 'odesli' as method
        from {{ ref('silver_odesli_library_links') }}
        where is_accepted
    ) found
    join {{ ref('gold_objects') }} o
        on o.born_from = found.born_from
    join {{ ref('platforms') }} p
        on p.platform_id = found.platform_id
        and p.for_releases
    left join {{ ref('match_confidence') }} c
        on c.method = found.method

),

all_instances as (

    select * from from_works
    union all by name
    select * from from_bandcamp
    union all by name
    select * from from_mixes
    union all by name
    select * from from_mix_other_links
    union all by name
    select * from from_collection
    union all by name
    select * from from_collection_searches

),

keyed as (

    select *, {{ normalize_url('url') }} as url_key
    from all_instances

),

merged as (

    -- Two ways of writing the same link (http/https, a slash at the end) become
    -- one row, keeping the shortest way of writing it and all the sources.
    select
        object_id,
        url_key,
        min(platform_id) as platform_id,
        min_by(url, length(url)) as url,
        array_to_string(list_sort(list_distinct(flatten(list(string_split(sources, ', '))))), ', ')
            as sources,
        array_to_string(list_sort(list_distinct(flatten(list(string_split(methods, ', '))))), ', ')
            as methods,
        max(confidence) as confidence,
        string_agg(distinct relation_types, ', ') as relation_types,
        max(editions_linked) as editions_linked,
        bool_or(linked_at_album_level) as linked_at_album_level
    from keyed
    group by object_id, url_key

),

with_version as (

    -- which version of the work the link is (silver_link_versions);
    -- '' = the standard version, also for links we have no title for
    select
        m.*,
        coalesce(v.version_key, '') as version_key,
        case when coalesce(v.version_key, '') = '' then '' else v.version_label end as version_label,
        coalesce(v.maybe_another_release, false) as maybe_another_release,
        v.title_seen
    from merged m
    join {{ ref('gold_objects') }} o
        on o.object_id = m.object_id
    left join {{ ref('silver_link_versions') }} v
        on v.work_id = o.work_id
        and v.url_key = m.url_key

)

select
    md5(object_id || '|' || url_key) as instance_id,
    object_id,
    md5(object_id || '|' || version_key) as version_id,   -- see gold_object_versions
    platform_id,          -- empty for a mix on a site that isn't in our platform list
    url,
    version_key,          -- e.g. "deluxe"; empty for the standard version
    version_label,        -- e.g. "Deluxe Version"; empty for the standard version
    maybe_another_release,  -- "(Live)", "(Remixes)" ...: probably a different work
    title_seen,           -- the title the platform shows for this link
    sources,
    methods,
    confidence,           -- how sure we are this link is the object (0 to 1)
    relation_types,
    editions_linked,
    linked_at_album_level
from with_version
