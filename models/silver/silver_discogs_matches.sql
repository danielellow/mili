-- SILVER: for each work we looked up on Discogs, what we found and whether we
-- trust it. One row per work.
--
--   release_lookup  the edition MusicBrainz already links; Discogs tells us its
--                   master (main page). Trusted as it is.
--   barcode_search  Discogs search by barcode. Accepted if the title looks like
--                   the MusicBrainz title (similarity >= 0.85, or one contains the other).
--   title_search    Discogs search by artist + title. Stricter, because there's
--                   no barcode: artist >= 0.90 and title >= 0.92.
--
-- Discogs search results name releases "Artist - Title", and sometimes add a
-- number to tell artists apart ("Burial (2)") or a * for a name variation
-- ("Burial*"); we split and clean that.

with newest as (

    select
        *,
        row_number() over (partition by work_id order by fetched_at desc) as newest_first
    from {{ ref('bronze_discogs_lookups') }}
    where status in ('found', 'not_found')

),

latest as (

    select * from newest where newest_first = 1

),

release_lookups as (

    select
        work_id,
        method,
        status,
        try_cast(response ->> '$.id' as bigint) as release_id,
        nullif(try_cast(response ->> '$.master_id' as bigint), 0) as master_id,
        response ->> '$.title' as discogs_title,
        response ->> '$.artists_sort' as discogs_artist,
        try_cast(response ->> '$.community.have' as integer) as have,
        try_cast(response ->> '$.community.want' as integer) as want,
        null::double as title_similarity,
        null::double as artist_similarity,
        status = 'found' as is_accepted
    from latest
    where method = 'release_lookup'

),

candidates as (

    select
        l.work_id,
        l.method,
        l.status,
        c,
        regexp_extract(c ->> '$.title', '^(.*?) - (.*)$', 2) as discogs_title,
        -- "Burial (2)" -> "Burial", "Burial*" -> "Burial"
        regexp_replace(
            regexp_extract(c ->> '$.title', '^(.*?) - (.*)$', 1), '\s*(\(\d+\)|\*)$', ''
        ) as discogs_artist
    from latest l,
        unnest(json_extract(l.response, '$.results[*]')) as t(c)
    where l.method in ('barcode_search', 'title_search')
      and l.status = 'found'

),

scored as (

    select
        x.work_id,
        x.method,
        x.status,
        try_cast(x.c ->> '$.id' as bigint) as release_id,
        nullif(try_cast(x.c ->> '$.master_id' as bigint), 0) as master_id,
        x.discogs_title,
        x.discogs_artist,
        try_cast(x.c ->> '$.community.have' as integer) as have,
        try_cast(x.c ->> '$.community.want' as integer) as want,
        greatest(
            jaro_winkler_similarity({{ normalize_title('w.title') }}, {{ normalize_title('x.discogs_title') }}),
            jaro_winkler_similarity({{ core_title('w.title') }}, {{ core_title('x.discogs_title') }})
        ) as title_similarity,
        jaro_winkler_similarity(
            {{ normalize_artist("w.release_group_json ->> '$.artist-credit[0].name'") }},
            {{ normalize_artist('x.discogs_artist') }}
        ) as artist_similarity,
        (
            length({{ normalize_title('w.title') }}) >= 3
            and (
                contains({{ normalize_title('x.discogs_title') }}, {{ normalize_title('w.title') }})
                or contains({{ normalize_title('w.title') }}, {{ normalize_title('x.discogs_title') }})
            )
        ) as title_contained
    from candidates x
    join {{ ref('silver_mb_release_groups') }} w
        on w.release_group_id = x.work_id

),

judged as (

    select
        *,
        coalesce(
            case method
                when 'barcode_search'
                    then title_similarity >= 0.85 or coalesce(title_contained, false)
                when 'title_search'
                    then artist_similarity >= 0.90 and title_similarity >= 0.92
            end,
            false
        ) as is_accepted
    from scored

),

best_search as (

    -- the best candidate per work: accepted first, then ones with a master page
    select * exclude (title_contained, preference)
    from (
        select
            *,
            row_number() over (
                partition by work_id
                order by
                    is_accepted desc,
                    (master_id is not null) desc,
                    title_similarity + coalesce(artist_similarity, 0) desc,
                    release_id
            ) as preference
        from judged
    )
    where preference = 1

),

not_found as (

    select
        work_id, method, status,
        null::bigint as release_id, null::bigint as master_id,
        null::varchar as discogs_title, null::varchar as discogs_artist,
        null::integer as have, null::integer as want,
        null::double as title_similarity, null::double as artist_similarity,
        false as is_accepted
    from latest
    where method in ('barcode_search', 'title_search')
      and status = 'not_found'

),

all_works as (

    select * from release_lookups
    union all by name
    select * from best_search
    union all by name
    select * from not_found

)

select
    a.work_id,
    a.method,
    a.status,
    a.release_id,
    a.master_id,
    w.title as mb_title,
    a.discogs_title,
    a.discogs_artist,
    round(a.title_similarity, 3) as title_similarity,
    round(a.artist_similarity, 3) as artist_similarity,
    a.have,           -- Discogs users who own it
    a.want,           -- Discogs users who want it
    a.is_accepted
from all_works a
-- only works that still exist in our catalogue
join {{ ref('silver_mb_release_groups') }} w
    on w.release_group_id = a.work_id
