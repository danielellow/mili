-- GOLD: one row per WORK (album, EP, single ...), ready for the app and the analysis.

with editions as (

    select
        release_group_id,
        count(*) as edition_count,
        count(barcode) as editions_with_barcode
    from {{ ref('silver_mb_releases') }}
    group by 1

),

genres_ranked as (

    select
        *,
        row_number() over (partition by release_group_id order by votes desc, genre) as genre_rank
    from {{ ref('silver_mb_release_group_genres') }}

),

top_genres as (

    -- the three genres with the most votes, e.g. "electronic, techno, ambient"
    select
        release_group_id,
        string_agg(genre, ', ' order by genre_rank) as top_genres
    from genres_ranked
    where genre_rank <= 3
    group by 1

),

discogs_ranked as (

    -- The main Discogs link for a work: the "master" page (all editions) if
    -- MusicBrainz knows it, otherwise the page of the earliest edition.
    select
        u.release_group_id,
        u.url,
        u.discogs_page_type,
        row_number() over (
            partition by u.release_group_id
            order by
                case u.discogs_page_type when 'master' then 0 else 1 end,
                r.release_date nulls last,
                u.url
        ) as preference
    from {{ ref('silver_mb_urls') }} u
    left join {{ ref('silver_mb_releases') }} r
        on r.release_id = u.release_id
    where u.platform_id = 'discogs'
      and u.discogs_page_type in ('master', 'release')

)

select
    g.release_group_id as work_id,
    g.title,
    coalesce(g.primary_type, 'other') as work_type,
    g.secondary_types,
    g.artist_credit,
    g.first_release_date,
    g.first_release_year,
    tg.top_genres,
    e.edition_count,
    e.editions_with_barcode,
    d.url as discogs_url,
    d.discogs_page_type
from {{ ref('silver_mb_release_groups') }} g
left join editions e
    on e.release_group_id = g.release_group_id
left join top_genres tg
    on tg.release_group_id = g.release_group_id
left join discogs_ranked d
    on d.release_group_id = g.release_group_id
    and d.preference = 1
