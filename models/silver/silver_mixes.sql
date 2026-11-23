-- SILVER: the mixes added by hand in seeds/mixes.csv, with the platform each
-- link belongs to (NTS, Mixcloud, SoundCloud ...), found from its web address
-- the same way as in silver_mb_urls.

with mixes as (

    select
        *,
        {{ normalize_url('mix_url') }} as url_key,
        regexp_replace(
            lower(regexp_extract(mix_url, '^https?://([^/:?#]+)', 1)), '^www\.', ''
        ) as domain
    from {{ ref('mixes') }}

),

matched as (

    -- the most specific (longest) matching domain wins
    select
        m.*,
        d.platform_id,
        row_number() over (
            partition by m.url_key
            order by length(d.domain) desc nulls last
        ) as best_match
    from mixes m
    left join {{ ref('platform_domains') }} d
        on m.domain = d.domain
        or ends_with(m.domain, '.' || d.domain)

)

select
    url_key,
    mix_url as url,
    platform_id,        -- empty if the site isn't in our platform list
    title,
    artist,             -- the DJ, host or show
    artwork_url,
    notes
from matched
where best_match = 1
