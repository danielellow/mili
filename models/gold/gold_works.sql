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

    -- The Discogs links MusicBrainz knows: the "master" page (all editions)
    -- first, otherwise the page of the earliest edition.
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

),

from_musicbrainz as (

    select * from discogs_ranked where preference = 1

),

from_lookup as (

    -- what we found ourselves on Discogs (ingest/lookup_discogs.py)
    select work_id, master_id, release_id, have, want
    from {{ ref('silver_discogs_matches') }}
    where is_accepted

),

discogs_choice as (

    -- Every work gets a Discogs link, in this order:
    --   1. the master page MusicBrainz links
    --   2. the master page we found on Discogs
    --   3. the edition page MusicBrainz links
    --   4. the edition page we found on Discogs
    --   5. a ready-made Discogs search for artist + title
    select
        g.release_group_id as work_id,
        case
            when mb.discogs_page_type = 'master' then 'master'
            when lk.master_id is not null then 'master'
            when mb.discogs_page_type = 'release' then 'release'
            when lk.release_id is not null then 'release'
            else 'search'
        end as discogs_page_type,
        case
            when mb.discogs_page_type = 'master' then 'musicbrainz'
            when lk.master_id is not null then 'discogs_lookup'
            when mb.discogs_page_type = 'release' then 'musicbrainz'
            when lk.release_id is not null then 'discogs_lookup'
            else 'search'
        end as discogs_link_source,
        case
            when mb.discogs_page_type = 'master' then mb.url
            when lk.master_id is not null then 'https://www.discogs.com/master/' || lk.master_id
            when mb.discogs_page_type = 'release' then mb.url
            when lk.release_id is not null then 'https://www.discogs.com/release/' || lk.release_id
            else 'https://www.discogs.com/search/?q='
                || url_encode(regexp_replace(
                    -- "Various Artists" only gets in the way of a search
                    case
                        when {{ normalize_artist("g.release_group_json ->> '$.artist-credit[0].name'") }} = 'various artists'
                            then g.title
                        else concat_ws(' ', g.release_group_json ->> '$.artist-credit[0].name', g.title)
                    end,
                    '\p{Cf}', '', 'g'      -- invisible characters some names carry
                ))
                || '&type=all'
        end as discogs_url,
        lk.have as discogs_have,
        lk.want as discogs_want
    from {{ ref('silver_mb_release_groups') }} g
    left join from_musicbrainz mb
        on mb.release_group_id = g.release_group_id
    left join from_lookup lk
        on lk.work_id = g.release_group_id

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
    d.discogs_url,
    d.discogs_page_type,            -- master, release or search
    d.discogs_link_source,          -- musicbrainz, discogs_lookup or search
    d.discogs_have,                 -- Discogs users who own the edition we looked up
    d.discogs_want                  -- Discogs users who want it
from {{ ref('silver_mb_release_groups') }} g
left join editions e
    on e.release_group_id = g.release_group_id
left join top_genres tg
    on tg.release_group_id = g.release_group_id
left join discogs_choice d
    on d.work_id = g.release_group_id
