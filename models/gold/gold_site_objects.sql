-- GOLD (for the website): one row per object with everything the app shows,
-- ready to be written as JSON by export/export_site_data.py.
--
--   id, kind, title, artist, type, year, labels, cover, genres
--   artist_ids     the artist pages it belongs on (gold_object_artists):
--                  MusicBrainz IDs of every artist in the credit, so "same
--                  artist" also finds collaborations ("Kode9 & The Spaceape"
--                  relates to both Kode9 and The Spaceape); "name:…" for artists
--                  MusicBrainz doesn't know; a mix's DJ(s)
--   mix            for mixes: the date, the length in seconds, the uploader
--   bandcamp_page  the Bandcamp account the release is sold from ("ad93", "swirlpeople"):
--                  a label's or an artist's page. The atlas uses it to connect things
--                  from the same small label or artist that MusicBrainz doesn't know.
--   availability   where it can be heard: bandcamp_and_streaming,
--                  streaming_only, bandcamp_only, or elsewhere (only YouTube,
--                  SoundCloud ...), or nowhere (no listen links); "mix" for mixes
--   listen         the row of listen links, in the platforms' order
--   buy            the buy menu (Bandcamp, Discogs)
--   versions       the versions page section ("2 versions · Wind (Deluxe Version)")
--
-- The release facts come from MusicBrainz (or the label's own Bandcamp page,
-- or the mix you added), plus links. For releases MusicBrainz doesn't know,
-- the year, label and type come from Apple Music (gold_release_details), and
-- only where nothing else says them. The other titles and dates the platforms
-- gave us (gold_claims) stay in the analysis.

with labels as (

    select object_id, list(mili_label order by mili_label) as labels
    from {{ ref('gold_object_labels') }}
    group by 1

),

mixes as (

    select
        'link:' || url_key as born_from,
        {'date': mix_date::varchar, 'length': length_seconds, 'uploader': uploader} as mix
    from {{ ref('silver_mixes') }}

),

listen as (

    select
        object_id,
        list(
            {'platform': platform_id, 'name': display_name, 'url': url, 'version': version_label}
            order by menu_order
        ) as listen,
        bool_or(platform_id = 'bandcamp') as on_bandcamp,
        -- "https://ad93.bandcamp.com/album/haw" -> "ad93" (a custom domain stays whole)
        max(case when platform_id = 'bandcamp' then
            coalesce(
                nullif(regexp_extract(url, '^https?://([^./]+)\.bandcamp\.com', 1), ''),
                regexp_replace(lower(regexp_extract(url, '^https?://([^/:?#]+)', 1)), '^www\.', '')
            )
        end) as bandcamp_page,
        -- the subscription streaming services (not YouTube or SoundCloud uploads)
        bool_or(platform_id in (
            'apple_music', 'youtube_music', 'tidal', 'qobuz', 'deezer',
            'spotify', 'amazon_music', 'pandora'
        )) as on_streaming
    from {{ ref('gold_listen_options') }}
    group by 1

),

buy as (

    select
        object_id,
        list(
            {'platform': platform_id, 'name': display_name, 'url': url, 'kind': link_kind}
            order by menu_order
        ) as buy
    from {{ ref('gold_buy_options') }}
    group by 1

),

versions as (

    select
        object_id,
        list(
            {'title': display_title, 'label': version_label, 'platforms': platforms, 'main': is_main}
            order by is_main desc, platforms desc, display_title
        ) as versions,
        count(*) as versions_total
    from {{ ref('gold_object_versions') }}
    where not maybe_another_release
    group by 1

)

select
    o.object_id as id,
    o.kind,                                         -- release or mix
    o.title,
    o.artist_credit as artist,
    coalesce(a.artist_ids, []::varchar[]) as artist_ids,
    coalesce(o.work_type, d.type) as type,          -- album, ep, single ... or empty
    coalesce(o.first_release_year, d.year) as year,
    coalesce(lb.labels, case when d.label is not null then [d.label] end, []::varchar[]) as labels,
    o.cover_url as cover,
    coalesce(string_split(o.top_genres, ', '), []::varchar[]) as genres,
    li.bandcamp_page,
    case
        when o.kind = 'mix' then 'mix'
        when li.object_id is null then 'nowhere'
        when li.on_bandcamp and li.on_streaming then 'bandcamp_and_streaming'
        when li.on_streaming then 'streaming_only'
        when li.on_bandcamp then 'bandcamp_only'
        else 'elsewhere'
    end as availability,
    coalesce(v.versions_total, 0) as versions_total,
    coalesce(li.listen, []) as listen,
    coalesce(b.buy, []) as buy,
    coalesce(v.versions, []) as versions,
    mx.mix
from {{ ref('gold_objects') }} o
left join labels lb on lb.object_id = o.object_id
left join {{ ref('gold_release_details') }} d on d.object_id = o.object_id
left join {{ ref('gold_object_artists') }} a on a.object_id = o.object_id
left join mixes mx on mx.born_from = o.born_from
left join listen li on li.object_id = o.object_id
left join buy b on b.object_id = o.object_id
left join versions v on v.object_id = o.object_id
