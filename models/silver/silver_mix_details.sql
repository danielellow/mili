-- SILVER: one row per mix link in seeds/mixes.csv, with what its platform said
-- about it (bronze_mix_lookups), read into plain columns.
--
--   SoundCloud (oEmbed)   title ("<title> by <uploader>"), uploader, artwork
--   Mixcloud (API)        title, uploader, artwork, upload date, length, tags
--   NTS (episode JSON)    title, artwork, broadcast date, genres, and where else
--                         it can be heard (usually its Mixcloud page, which is
--                         also looked up, for the length)
--
-- The newest good answer for each link is used. Links with no good answer yet
-- keep their last error in lookup_error.

with answers as (

    select
        *,
        row_number() over (partition by url, coalesce(via, '') order by fetched_at desc) as newest
    from {{ ref('bronze_mix_lookups') }}
    where ok

),

latest as (

    select * from answers where newest = 1 and via is null

),

via_mixcloud as (

    -- the Mixcloud page an NTS episode named, looked up for its length and artwork
    select
        via as nts_url,
        url as mixcloud_url,
        try_cast(response ->> '$.audio_length' as integer) as length_seconds
    from answers
    where newest = 1 and via is not null and platform = 'mixcloud'

),

last_errors as (

    select url, arg_max(error, fetched_at) as lookup_error
    from {{ ref('bronze_mix_lookups') }}
    where via is null
    group by url
    having not bool_or(ok)

),

read_out as (

    select
        l.url,
        l.platform,
        l.fetched_at as looked_up_at,
        case l.platform
            when 'soundcloud' then
                -- oEmbed says "Deep Mix by Someone": keep "Deep Mix"
                regexp_replace(
                    l.response ->> '$.title',
                    '\s+by\s+' || regexp_escape(coalesce(l.response ->> '$.author_name', '')) || '$',
                    ''
                )
            else l.response ->> '$.name'
        end as title,
        case l.platform
            when 'soundcloud' then l.response ->> '$.author_name'
            when 'mixcloud' then l.response ->> '$.user.name'
        end as uploader,
        case l.platform
            when 'soundcloud' then regexp_replace(l.response ->> '$.author_url', '^https?://(www\.)?soundcloud\.com/', '')
            when 'mixcloud' then l.response ->> '$.user.username'
            when 'nts' then l.response ->> '$.show_alias'
        end as uploader_key,        -- the account (or, for NTS, the show) the mix belongs to
        nullif(case l.platform
            -- SoundCloud's thumbnail is small: "-large.jpg" -> "-t500x500.jpg"
            when 'soundcloud' then replace(l.response ->> '$.thumbnail_url', '-large.', '-t500x500.')
            when 'mixcloud' then coalesce(
                l.response ->> '$.pictures.extra_large',
                l.response ->> '$.pictures.large',
                l.response ->> '$.pictures.medium'
            )
            when 'nts' then coalesce(
                l.response ->> '$.media.picture_large',
                l.response ->> '$.media.background_large'
            )
        end, '') as artwork_url,
        try_cast(case l.platform
            when 'mixcloud' then l.response ->> '$.created_time'
            when 'nts' then l.response ->> '$.broadcast'
        end as timestamptz)::date as mix_date,     -- broadcast (NTS) or upload (Mixcloud)
        coalesce(
            case l.platform when 'mixcloud' then try_cast(l.response ->> '$.audio_length' as integer) end,
            v.length_seconds
        ) as length_seconds,
        coalesce(case l.platform
            when 'mixcloud' then json_extract_string(l.response, '$.tags[*].name')
            when 'nts' then json_extract_string(l.response, '$.genres[*].value')
        end, []::varchar[]) as genres,
        -- other places it can be heard: an NTS episode's Mixcloud / SoundCloud pages
        case l.platform when 'nts' then list_distinct(list_filter(
            list_concat(
                json_extract_string(l.response, '$.audio_sources[*].url'),
                [l.response ->> '$.mixcloud']
            ),
            lambda u: u is not null and u like 'http%'
        )) else []::varchar[] end as other_links
    from latest l
    left join via_mixcloud v
        on v.nts_url = l.url

)

select * from read_out

union all by name

select
    e.url,
    null::varchar as platform,
    null::timestamptz as looked_up_at,
    null::varchar as title,
    null::varchar as uploader,
    null::varchar as uploader_key,
    null::varchar as artwork_url,
    null::date as mix_date,
    null::integer as length_seconds,
    []::varchar[] as genres,
    []::varchar[] as other_links,
    e.lookup_error
from last_errors e
