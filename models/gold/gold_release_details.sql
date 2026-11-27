-- GOLD (for the website): the year, label and kind of release, from Apple
-- Music, for releases MusicBrainz doesn't know (mostly your Bandcamp purchases,
-- and releases from a label's own Bandcamp page). One row per object.
-- MusicBrainz's facts always come first: these only fill what's empty
-- (gold_site_objects).
--
-- Nothing new is asked for: both answers were already saved, untouched.
--   1. the album lookup (lookup_apple_tracks.py): Apple's entry for the album
--      itself, the first result in each answer
--   2. the name search (search_apple_by_title.py): the match we accepted
--      (silver_apple_library_matches)
-- For each fact the album lookup comes first, then the name search.
--
--   year    from Apple's release date
--   label   Apple has no label field, but the copyright line names who put the
--           release out: "℗ 2026 FELT" -> FELT, "℗ 2025 Warp Records Limited
--           under exclusive licence to …" -> Warp Records. Left empty when the
--           line only names the artist ("℗ 2026 Fergus Jones"): that's
--           self-released, not a label. When it's one of mili's own labels
--           ("Warp Records" for Warp), mili's name for it is used.
--   type    from the album's name on Apple: "Untitled - EP" -> ep,
--           "… - Single" -> single, otherwise album. Only used when gold_objects
--           doesn't know the type (a song bought on its own stays a track).

with album_lookups as (

    select
        n.object_id,
        nullif(left(r ->> '$.releaseDate', 10), '') as release_date,
        nullif(r ->> '$.copyright', '') as copyright,
        nullif(r ->> '$.collectionName', '') as album_title,
        1 as preference
    from (
        select *
        from {{ ref('bronze_apple_tracks') }}
        qualify row_number() over (partition by object_id order by fetched_at desc) = 1
    ) n,
        unnest(json_extract(n.response, '$.results[*]')) as t(r)
    where r ->> '$.wrapperType' = 'collection'

),

name_search as (

    select
        o.object_id,
        m.apple_release_date as release_date,
        m.apple_copyright as copyright,
        m.apple_album_title as album_title,
        2 as preference
    from {{ ref('silver_apple_library_matches') }} m
    join {{ ref('gold_objects') }} o
        on o.born_from = m.born_from
    where m.is_accepted

),

answers as (

    select * from album_lookups
    union all by name
    select * from name_search

),

picked as (

    -- each fact from the best answer that has it
    select
        object_id,
        arg_min(release_date, preference) filter (where release_date is not null) as release_date,
        arg_min(copyright, preference) filter (where copyright is not null) as copyright,
        arg_min(album_title, preference) filter (where album_title is not null) as album_title
    from answers
    group by 1

),

holders as (

    select
        p.*,
        o.artist_credit,
        o.work_type,
        -- who the copyright line names, step by step:
        --   1. the ℗ or © and the year(s) in front: "℗ 2026 FELT Records Ltd. under …" -> "FELT Records Ltd. under …"
        --   2. everything from a comma or "under", "licensed", "distributed" …: -> "FELT Records Ltd."
        --   3. a company ending: -> "FELT Records"
        nullif(trim(
            regexp_replace(
                regexp_replace(
                    regexp_replace(
                        p.copyright,
                        '^[\s℗©Ⓟⓒ&]*(\([pc]\)[\s&]*)*(\d{4}(\s*[-–,/]\s*\d{4})*\s*[,.]?\s*)?', '', 'i'),
                    '\s*(,|;|\||\bunder\b|\blicen[cs]e[ds]?\b|\bdistributed\b|\bmarketed\b|\bmanufactured\b|\ball rights\b|\bexclusive|\ba division\b).*$', '', 'i'),
                '\s+(ltd|limited|llc|inc|gmbh|ab|bv|b\.v|s\.a|sarl|pty)\.?$', '', 'i'),
            ' ,'), '') as holder
    from picked p
    join {{ ref('gold_objects') }} o
        on o.object_id = p.object_id
    where o.kind = 'release'
      and o.identity_source <> 'musicbrainz'

),

named as (

    select
        object_id,
        release_date,
        try_cast(left(release_date, 4) as integer) as year,
        case
            when holder is null or length(holder) < 2 or length(holder) > 60 then null
            when regexp_matches(holder, '^[\d\s]+$') then null
            -- a sentence, not a name ("The copyright in this sound recording is owned by …")
            when regexp_matches(holder, '(?i)copyright|reserved|sound recording|owned by') then null
            -- only the artist's own name (or part of it): self-released
            --   (whole words: "Fergus Jones" is part of "Fergus Jones & Thomas Bush")
            when contains(' ' || {{ normalize_artist('artist_credit') }} || ' ', ' ' || {{ normalize_artist('holder') }} || ' ')
              or contains(' ' || {{ normalize_artist('holder') }} || ' ', ' ' || {{ normalize_artist('artist_credit') }} || ' ')
                then null
            else holder
        end as label,
        case
            when work_type is not null then null
            when regexp_matches(album_title, '\s[-–]\s*EP$', 'i') then 'ep'
            when regexp_matches(album_title, '\s[-–]\s*Single$', 'i') then 'single'
            when album_title is not null then 'album'
        end as type,
        copyright,              -- as Apple wrote it, to check the label against
        album_title
    from holders

),

mili_labels as (

    -- mili's labels, compared without "Records", "Recordings", "Intl." …
    select
        label,
        regexp_replace({{ normalize_title('label') }}, '\s+(records?|recordings?|recording co|recording company|music|intl|international)$', '') as label_key
    from {{ ref('gold_labels') }}
    qualify row_number() over (partition by label_key order by position) = 1

)

select
    n.object_id,
    n.release_date,
    n.year,
    coalesce(m.label, n.label) as label,
    n.type,
    n.copyright,              -- as Apple wrote it, to check the label against
    n.album_title
from named n
left join mili_labels m
    on m.label_key = regexp_replace({{ normalize_title('n.label') }}, '\s+(records?|recordings?|recording co|recording company|music|intl|international)$', '')
