-- SILVER: who each mix is by, linked to an artist page in mili.
-- One row per mix.
--
-- How the DJ is found, in this order:
--   1. given     you wrote the DJ(s) in seeds/mixes.csv ("A; B")
--   2. uploader  the SoundCloud or Mixcloud account is an artist mili knows
--                (not when it's a radio station or mix series: seeds/mix_stations.csv)
--   3. title     a piece of the title is an artist mili knows:
--                "Call Super - 12th March 2025"  ->  Call Super
--                "Soup To Nuts w/ Manara"         ->  Soup To Nuts, Manara
--                "RA.912 Tsvi"                    ->  Tsvi
--                The title is cut at " - ", " | ", ": " first, then each piece
--                at " w/ ", " b2b ", " & ", " x ", ", " and the like. A series
--                number at the start ("RA.912", "FACT 123", "#45") is also
--                tried without.
--   4. none      no one mili knows: the uploader is used (or, for a radio
--                station or NTS, the title's first piece that isn't the
--                station's own name, without " w/ …"), and gets a page of
--                their own for their mixes
--
-- "Knows" means an exact match of the cleaned name in silver_artist_names:
-- a MusicBrainz artist from the catalogue, or a Bandcamp-only artist.
-- A wrong guess is fixed by writing the DJ in seeds/mixes.csv.

with mixes as (

    select url_key, title, platform_title, artist_given, uploader, uploader_is_station
    from {{ ref('silver_mixes') }}

),

-- 1. the DJs you wrote, in order
given as (

    select
        url_key,
        trim(unnest(string_split(artist_given, ';'))) as name,
        unnest(generate_series(1, len(string_split(artist_given, ';')))) as position
    from mixes
    where artist_given is not null

),

-- 3. the pieces of the title
first_cut as (

    select
        url_key,
        unnest(regexp_split_to_array(coalesce(platform_title, title), '\s+[-–—|]\s+|:\s+')) as piece,
        unnest(generate_series(1, len(regexp_split_to_array(coalesce(platform_title, title), '\s+[-–—|]\s+|:\s+')))) as cut
    from mixes
    where artist_given is null

),

second_cut as (

    select
        url_key,
        cut,
        trim(piece) as whole,
        trim(unnest(regexp_split_to_array(piece, '(?i)\s+(?:w/|with|b2b|b3b|x|\+|&|and|feat\.?|ft\.?|pres\.?|presents)\s+|,\s+'))) as part,
        unnest(generate_series(1, len(regexp_split_to_array(piece, '(?i)\s+(?:w/|with|b2b|b3b|x|\+|&|and|feat\.?|ft\.?|pres\.?|presents)\s+|,\s+')))) as sub
    from first_cut

),

candidates as (

    -- 2. the uploader comes first
    select url_key, uploader as name, 0 as cut, 0 as sub, 'uploader' as found_by
    from mixes
    where artist_given is null and uploader is not null and not uploader_is_station

    union all

    -- 3. a whole piece ("Kode9 & The Spaceape") ...
    select distinct url_key, whole, cut, 0, 'title'
    from second_cut

    union all

    -- ... or a part of it ("Kode9")
    select url_key, part, cut, sub, 'title'
    from second_cut
    where part <> whole

    union all

    -- ... or the piece without a series number at the start ("RA.912 Tsvi" -> "Tsvi")
    select distinct url_key, regexp_replace(whole, '^#?[A-Za-z]{0,6}[.#]?\s?\d+[a-z]?[.:]?\s+', ''), cut, 99, 'title'
    from second_cut
    where regexp_matches(whole, '^#?[A-Za-z]{0,6}[.#]?\s?\d+[a-z]?[.:]?\s+\S')

),

matched as (

    select
        c.*,
        a.artist_id,
        a.name as known_name,
        -- a part only counts when its whole piece didn't match
        bool_or(c.sub = 0) over (partition by c.url_key, c.cut) as whole_matched
    from candidates c
    join {{ ref('silver_artist_names') }} a
        on a.name_key = {{ normalize_artist('c.name') }}
    where length({{ normalize_artist('c.name') }}) >= 2

),

found as (

    select
        url_key,
        list(artist_id order by cut, sub) as artist_ids,
        list(known_name order by cut, sub) as names,
        case when bool_or(found_by = 'uploader') then 'uploader' else 'title' end as found_by
    from (
        select distinct on (url_key, artist_id) *
        from matched
        where sub = 0 or not whole_matched
        order by url_key, artist_id, cut, sub
    )
    group by url_key

),

given_linked as (

    select
        g.url_key,
        list(coalesce(a.artist_id, 'name:' || replace({{ normalize_artist('g.name') }}, ' ', '-')) order by g.position) as artist_ids,
        list(g.name order by g.position) as names
    from given g
    left join {{ ref('silver_artist_names') }} a
        on a.name_key = {{ normalize_artist('g.name') }}
    where g.name <> ''
    group by g.url_key

),

fallback as (

    -- 4. no one mili knows
    select
        m.url_key,
        coalesce(
            case when not m.uploader_is_station then m.uploader end,
            nullif(trim(regexp_replace(
                -- the first piece that isn't the uploader's own name ("Boiler Room: Objekt")
                list_filter(
                    regexp_split_to_array(coalesce(m.platform_title, m.title), '\s+[-–—|]\s+|:\s+'),
                    lambda piece: {{ normalize_artist('piece') }} <> coalesce({{ normalize_artist('m.uploader') }}, '')
                )[1],
                '(?i)\s+(?:w/|with)\s+.*$', ''
            )), ''),
            m.uploader,
            'unknown'
        ) as name
    from mixes m

)

select
    m.url_key,
    case
        when gl.url_key is not null then 'given'
        when f.url_key is not null then f.found_by
        else 'none'
    end as found_by,
    -- the credit shown on the mix ("Call Super", "Kode9 & Burial")
    case
        when gl.url_key is not null then array_to_string(gl.names, ' & ')
        when f.url_key is not null then array_to_string(f.names, ' & ')
        else fb.name
    end as artist_credit,
    -- the artist pages it's on
    case
        when gl.url_key is not null then gl.artist_ids
        when f.url_key is not null then f.artist_ids
        else ['name:' || replace({{ normalize_artist('fb.name') }}, ' ', '-')]
    end as artist_ids
from mixes m
left join given_linked gl on gl.url_key = m.url_key
left join found f on f.url_key = m.url_key
left join fallback fb on fb.url_key = m.url_key
