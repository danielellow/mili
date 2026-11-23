-- SILVER: each release on a label's own Bandcamp page, matched to one of that
-- label's works (or not).
--
-- Each release is only compared with works of the SAME label, which keeps
-- the matching safe. A release counts as matched when:
--   - the page shows an artist:  title_similarity >= 0.92, and the artist matches:
--                                artist_similarity >= 0.90, or artist_listed
--   - no artist on the page:     title_similarity >= 0.95 (almost exact)
--
-- artist_listed is for collaborations, which Bandcamp and MusicBrainz write
-- differently ("Kode9 & The Spaceape" vs the main artist "Kode9"). The artist
-- counts as matching when:
--   - the main artist is one of the names on the page, split the same way as
--     in silver_discogs_matches ("Tessela / Lanark Artefax")
--   - one name starts with the other, as whole words ("Panda Bear and Cate
--     Le Bon" starts with "Panda Bear")
--   - they're the same apart from a leading "The"
-- (added after the first look at the "uncertain" Bandcamp releases, Nov 2026)
-- Releases that match none of the label's works are kept too: they are on
-- Bandcamp but missing from MusicBrainz (is_matched = false).

with latest_run as (

    -- the newest run per Bandcamp page (a label can have several pages)
    select bandcamp_page, max(run_id) as run_id
    from {{ ref('bronze_bandcamp_label_items') }}
    group by 1

),

items as (

    -- the newest run per page, with names made comparable once, up front
    select distinct
        b.mili_label,
        b.item_title,
        nullif(b.item_artist, '') as item_artist,
        b.item_url,
        b.item_type,
        nullif(b.bandcamp_id, '') as bandcamp_id,
        b.fetched_at,
        {{ normalize_title('b.item_title') }} as item_title_norm,
        {{ core_title('b.item_title') }} as item_title_core,
        {{ normalize_artist("nullif(b.item_artist, '')") }} as item_artist_norm,
        -- the names on the page, split once here (see artist_listed below)
        list_transform(
            regexp_split_to_array(
                nullif(b.item_artist, ''),
                '\s*,\s*|\s+(&|/|\+|:|[xX]|(?i:feat\.?|featuring|ft\.|vs\.?|with))\s+'
            ),
            lambda name: regexp_replace({{ normalize_title('name') }}, '^the\s+', '')
        ) as item_artist_names
    from {{ ref('bronze_bandcamp_label_items') }} b
    join latest_run l
        on l.bandcamp_page = b.bandcamp_page
        and l.run_id = b.run_id

),

label_works as (

    select
        lw.mili_label,
        g.release_group_id as work_id,
        g.title as mb_title,
        g.release_group_json ->> '$.artist-credit[0].name' as mb_artist,
        {{ normalize_title('g.title') }} as mb_title_norm,
        {{ core_title('g.title') }} as mb_title_core,
        {{ normalize_artist("g.release_group_json ->> '$.artist-credit[0].name'") }} as mb_artist_norm,
        {{ normalize_artist('g.artist_credit') }} as mb_credit_norm,    -- the full credit, "Kode9 & The Spaceape"
        regexp_replace(
            {{ normalize_artist("g.release_group_json ->> '$.artist-credit[0].name'") }}, '^the\s+', ''
        ) as mb_artist_no_the
    from {{ ref('gold_label_works') }} lw
    join {{ ref('silver_mb_release_groups') }} g
        on g.release_group_id = lw.work_id

),

pairs as (

    -- every release compared with every work of the same label
    select
        i.mili_label,
        i.item_title,
        i.item_artist,
        i.item_url,
        i.item_type,
        i.bandcamp_id,
        i.fetched_at,
        w.work_id,
        w.mb_title,
        w.mb_artist,
        greatest(
            jaro_winkler_similarity(w.mb_title_norm, i.item_title_norm),
            jaro_winkler_similarity(w.mb_title_core, i.item_title_core)
        ) as title_similarity,
        case
            when i.item_artist_norm is not null
            then jaro_winkler_similarity(w.mb_artist_norm, i.item_artist_norm)
        end as artist_similarity,
        case
            when i.item_artist_norm is not null
            then coalesce(
                list_contains(i.item_artist_names, w.mb_artist_no_the)
                or starts_with(i.item_artist_norm || ' ', w.mb_artist_norm || ' ')
                or starts_with(w.mb_credit_norm || ' ', i.item_artist_norm || ' ')
                or regexp_replace(i.item_artist_norm, '^the\s+', '') = w.mb_artist_no_the,
                false
            )
        end as artist_listed
    from items i
    join label_works w
        on w.mili_label = i.mili_label

),

judged as (

    select
        *,
        case
            when artist_similarity is not null
                then (artist_similarity >= 0.90 or artist_listed) and title_similarity >= 0.92
            else title_similarity >= 0.95
        end as is_matched
    from pairs

),

best as (

    select
        *,
        row_number() over (
            partition by mili_label, item_url     -- a co-release can be on two labels' pages
            order by
                is_matched desc,                  -- a matching work first
                title_similarity + coalesce(artist_similarity, title_similarity) desc,
                work_id
        ) as candidate_rank
    from judged

)

select
    md5(mili_label || '|' || item_url) as match_id,
    mili_label,
    item_title,
    item_artist,
    item_url,
    item_type,
    bandcamp_id,      -- for Bandcamp's embedded player in the app
    work_id,
    mb_title,
    mb_artist,
    round(title_similarity, 3) as title_similarity,
    round(artist_similarity, 3) as artist_similarity,
    artist_listed,
    is_matched,
    fetched_at
from best
where candidate_rank = 1
