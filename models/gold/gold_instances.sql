-- GOLD: the INSTANCES of each work: one row per place a work lives on one of
-- our platforms.
--
-- Links come from these sources:
--   musicbrainz     links the MusicBrainz community has added
--   barcode_lookup  links we found by asking Apple, Deezer and Spotify directly,
--                   and that passed the match check in silver_platform_matches
--   title_search    Deezer links found by searching artist + title, that passed
--                   the stricter check in silver_deezer_title_matches
--   apple_title_search  Apple Music links found by searching artist + title, with
--                   the same strict check (silver_apple_title_matches)
--   bandcamp_page   releases listed on the label's own Bandcamp page, matched
--                   to a work in silver_bandcamp_label_matches
--   odesli          links from Odesli (song.link), starting from one link we
--                   already had, that passed the title check in silver_odesli_links
--   discogs_lookup  Discogs pages we found by looking up an edition, or searching
--                   by barcode or artist + title (silver_discogs_matches).
--                   The ready-made Discogs search links aren't instances: they
--                   only live in gold_works, as the last fallback.
-- If both sources give the same link, it appears once, with both sources listed.
--
-- Each link also says how it was matched ("methods", a bit more detailed than
-- the source: a barcode lookup can be on the exact barcode or on another one)
-- and how sure we are of it ("confidence", from seeds/match_confidence.csv).
--
-- Platforms that are only for DJ mixes (for_releases = false in the platforms
-- seed: Mixcloud) are left out: they never count as a release link.
--
-- A work can have several instances on the same platform, for example on the
-- label's Bandcamp page and on the artist's own Bandcamp page.

with musicbrainz_links as (

    select
        release_group_id as work_id,
        platform_id,
        url,
        relation_type,
        release_id,
        level,
        'musicbrainz' as source,
        'musicbrainz' as method
    from {{ ref('silver_mb_urls') }}
    where platform_id is not null

),

lookup_links as (

    select
        work_id,
        platform_id,
        url,
        null::varchar as relation_type,
        null::varchar as release_id,
        'album' as level,
        'barcode_lookup' as source,
        -- exact barcode, or another barcode with a similar title
        case matched_on when 'barcode' then 'barcode_exact' else 'barcode_other' end as method
    from {{ ref('silver_platform_matches') }}
    where is_accepted
      and url is not null

),

title_search_links as (

    select
        work_id,
        'deezer' as platform_id,
        url,
        null::varchar as relation_type,
        null::varchar as release_id,
        'album' as level,
        'title_search' as source,
        'title_search' as method
    from {{ ref('silver_deezer_title_matches') }}
    where is_accepted
      and url is not null

),

apple_title_search_links as (

    select
        work_id,
        'apple_music' as platform_id,
        url,
        null::varchar as relation_type,
        null::varchar as release_id,
        'album' as level,
        'apple_title_search' as source,
        'apple_title_search' as method
    from {{ ref('silver_apple_title_matches') }}
    where is_accepted
      and url is not null

),

bandcamp_page_links as (

    select
        work_id,
        'bandcamp' as platform_id,
        item_url as url,
        null::varchar as relation_type,
        null::varchar as release_id,
        'album' as level,
        'bandcamp_page' as source,
        'bandcamp_page' as method
    from {{ ref('silver_bandcamp_label_matches') }}
    where is_matched

),

odesli_links as (

    select
        work_id,
        platform_id,
        url,
        null::varchar as relation_type,
        null::varchar as release_id,
        'album' as level,
        'odesli' as source,
        'odesli' as method
    from {{ ref('silver_odesli_links') }}
    where is_accepted

),

discogs_lookup_links as (

    -- the main page (master), when the edition has one
    select
        work_id,
        'discogs' as platform_id,
        'https://www.discogs.com/master/' || master_id as url,
        null::varchar as relation_type,
        null::varchar as release_id,
        'album' as level,
        'discogs_lookup' as source,
        'discogs_' || method as method      -- release_lookup, barcode_search or title_search
    from {{ ref('silver_discogs_matches') }}
    where is_accepted
      and master_id is not null

    union all

    -- the edition page itself
    select
        work_id,
        'discogs' as platform_id,
        'https://www.discogs.com/release/' || release_id as url,
        null::varchar as relation_type,
        null::varchar as release_id,
        'edition' as level,
        'discogs_lookup' as source,
        'discogs_' || method as method      -- release_lookup, barcode_search or title_search
    from {{ ref('silver_discogs_matches') }}
    where is_accepted
      and release_id is not null

),

all_links as (

    select * from musicbrainz_links
    union all
    select * from lookup_links
    union all
    select * from title_search_links
    union all
    select * from apple_title_search_links
    union all
    select * from bandcamp_page_links
    union all
    select * from odesli_links
    union all
    select * from discogs_lookup_links

)

-- Confidence: how sure we are that the link really is this work, from 0 to 1.
-- Each way of matching has a confidence in seeds/match_confidence.csv. When
-- several sources give the same link, the link keeps the highest one.
select
    md5(l.work_id || '|' || l.url) as instance_id,
    l.work_id,
    l.platform_id,
    l.url,
    string_agg(distinct l.source, ', ' order by l.source) as sources,
    string_agg(distinct l.method, ', ' order by l.method) as methods,
    max(c.confidence) as confidence,
    string_agg(distinct l.relation_type, ', ') as relation_types,   -- e.g. "purchase for download, free streaming"
    count(distinct l.release_id) as editions_linked,
    bool_or(l.level = 'album') as linked_at_album_level
from all_links l
join {{ ref('platforms') }} p
    on p.platform_id = l.platform_id
    and p.for_releases
left join {{ ref('match_confidence') }} c
    on c.method = l.method
group by l.work_id, l.platform_id, l.url
