-- SILVER: the mixes in seeds/mixes.csv, with what their platform said about
-- them (silver_mix_details) and the platform each link belongs to (found from
-- its web address, the same way as in silver_mb_urls).
--
-- In seeds/mixes.csv only mix_url is needed. The rest is optional:
--   artist     the DJ(s), when mili guesses wrong; several as "A; B"
--   title      a title of your own, instead of the platform's
--   status     collection (the default) or queue: every mix joins your library
--   added_on   when you added it, as 2026-11-27 (empty = the day it was looked up)
--   collages   your own groupings, separated by ";"
--   note       anything for yourself; it isn't used
--
-- A mix becomes a mili object once it has been looked up (ingest/lookup_mixes.py)
-- or has a title written in the file: ready says so. Links that couldn't be
-- looked up stay here with lookup_error, and out of the catalogue.
--
-- uploader_is_station: the uploader is a radio station or mix series
-- (seeds/mix_stations.csv), so the DJ is in the title, not the uploader.

with seed as (

    select
        trim(mix_url) as mix_url,
        nullif(trim(artist), '') as artist_given,
        nullif(trim(title), '') as title_given,
        coalesce(nullif(lower(trim(status)), ''), 'collection') as status,
        try_cast(nullif(trim(added_on), '') as date) as added_on_given,
        list_filter(
            list_transform(string_split(coalesce(collages, ''), ';'), lambda c: trim(c)),
            lambda c: c <> ''
        ) as collages,
        note
    from {{ ref('mixes') }}
    where nullif(trim(mix_url), '') is not null
      and not starts_with(trim(mix_url), '#')

),

with_platform as (

    select
        s.*,
        {{ normalize_url('s.mix_url') }} as url_key,
        d.platform_id,
        row_number() over (
            partition by s.mix_url
            order by length(d.domain) desc nulls last
        ) as best_match
    from seed s
    left join {{ ref('platform_domains') }} d
        on regexp_replace(lower(regexp_extract(s.mix_url, '^https?://([^/:?#]+)', 1)), '^(www|m)\.', '') = d.domain
        or ends_with(lower(regexp_extract(s.mix_url, '^https?://([^/:?#]+)', 1)), '.' || d.domain)

),

stations as (

    select distinct {{ normalize_artist('uploader') }} as uploader_key
    from {{ ref('mix_stations') }}

)

select
    p.url_key,
    p.mix_url as url,
    p.platform_id,                  -- soundcloud, mixcloud, nts … (empty if the site isn't in our list)
    coalesce(p.title_given, d.title, p.mix_url) as title,
    p.artist_given,                 -- the DJ(s) you wrote in the file, if any
    d.title as platform_title,
    d.uploader,                     -- the SoundCloud or Mixcloud account it's on
    coalesce(
        {{ normalize_artist('d.uploader') }} in (select uploader_key from stations)
        or p.platform_id = 'nts',
        false
    ) as uploader_is_station,
    d.uploader_key,
    d.artwork_url,
    d.mix_date,                     -- broadcast (NTS) or upload (Mixcloud) date
    d.length_seconds,
    d.genres,
    d.other_links,                  -- e.g. an NTS episode's Mixcloud page
    p.status,
    coalesce(p.added_on_given, d.looked_up_at::date) as added_on,
    p.collages,
    p.note,
    d.lookup_error,                 -- why it couldn't be looked up, if it couldn't
    d.looked_up_at is not null as looked_up,
    d.looked_up_at is not null or p.title_given is not null as ready
from with_platform p
left join {{ ref('silver_mix_details') }} d
    on d.url = p.mix_url
where p.best_match = 1
