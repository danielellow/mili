-- GOLD (analysis): every claim from another source compared with what
-- MusicBrainz says about the same work. One row per claim.
--
-- verdict, by predicate:
--   title         same                    the same after cleaning (case, punctuation, " - EP")
--                 same_without_brackets   only differs in brackets: "Haw" vs "Haw (Remastered)"
--                 one_contains_the_other  usually how a platform writes titles:
--                                         YouTube's "Album - On Hold", or
--                                         "Radiohead - Hail to the Thief (Full Album)"
--                 different
--   artist        same                    also when only spaces or dots differ ("F·F·S" vs "FFS"),
--                                         or "&" vs "and" ("Stephen Malkmus and the Jicks")
--                 one_contains_the_other  usually a collaboration: "Kode9" vs "Kode9 & The Spaceape"
--                 different
--   release_date  same_year
--                 later                   the source dates it later than the first release
--                                         (often a reissue or a remaster)
--                 earlier
--   uploaded_by   who uploaded it (YouTube, YouTube Music, SoundCloud), checked in this order:
--                 the_artist              the uploader's name contains the artist, or the
--                                         other way round (also YouTube's automatic
--                                         "Artist - Topic" channels), also when written
--                                         without spaces ("Flyinglotus", "viagraboys")
--                 the_label               the uploader's name contains one of the object's
--                                         labels ("Warp Records" for Warp), also without
--                                         spaces ("warprecords")
--                 youtube_automatic       YouTube's own automatic channels ("YouTube")
--                 someone_else            anyone else: often a fan's account
--   years_apart   source year minus MusicBrainz year (release dates only)
--
-- Discogs dates belong to the edition we found (scope = edition), so a later
-- Discogs year usually just means that edition is a reissue. The platforms'
-- dates (scope = platform) are the date shown to listeners.

with musicbrainz as (

    select object_id, predicate, value as mb_value
    from {{ ref('gold_claims') }}
    where source = 'musicbrainz'
      and method = 'origin'

),

others as (

    select *
    from {{ ref('gold_claims') }}
    where method <> 'origin'

),

label_keys as (

    -- each object's labels, written the way a channel name would contain them:
    -- "Domino Recording Co." -> "domino", "Merge Records" -> "merge"
    select
        ol.object_id,
        regexp_replace(
            {{ normalize_title('ol.mili_label') }},
            '\s+(records|recordings|recording co|intl|group|tv)$', ''
        ) as label_key,
        replace({{ normalize_title('ol.mili_label') }}, ' ', '') as label_full_no_spaces
    from {{ ref('gold_object_labels') }} ol

),

compared as (

    select
        c.claim_id,
        c.object_id,
        c.predicate,
        c.source,
        c.method,
        c.scope,
        c.confidence,
        m.mb_value,
        c.value,
        try_cast(left(m.mb_value, 4) as integer) as mb_year,
        try_cast(left(c.value, 4) as integer) as source_year,
        -- artist names made comparable once; "and" is dropped as a word, so
        -- "&" (which cleaning turns into a space) and "and" compare the same
        trim(regexp_replace({{ normalize_artist('c.value') }}, '\s*\band\b\s*', ' ', 'g')) as value_artist,
        trim(regexp_replace({{ normalize_artist('m.mb_value') }}, '\s*\band\b\s*', ' ', 'g')) as mb_artist,
        exists (
            select 1 from label_keys k
            where k.object_id = c.object_id
              and length(k.label_key) >= 2
              and (
                  regexp_matches({{ normalize_title('c.value') }}, '\b' || k.label_key || '\b')
                  -- without spaces: "xlrecordings", "warprecords" (short keys like "xl"
                  -- only count as the whole label name, so "pixl" isn't XL)
                  or contains(replace({{ normalize_title('c.value') }}, ' ', ''), k.label_full_no_spaces)
                  or (length(replace(k.label_key, ' ', '')) >= 4
                      and contains(replace({{ normalize_title('c.value') }}, ' ', ''), replace(k.label_key, ' ', '')))
              )
        ) as names_a_label
    from others c
    -- uploaded_by is compared with the MusicBrainz artist
    join musicbrainz m
        on m.object_id = c.object_id
        and m.predicate = case c.predicate when 'uploaded_by' then 'artist' else c.predicate end

)

select
    claim_id,
    object_id,
    predicate,
    source,
    method,
    scope,
    confidence,
    mb_value,
    value,
    case predicate
        when 'title' then
            case
                when {{ normalize_title('value') }} = {{ normalize_title('mb_value') }} then 'same'
                when {{ core_title('value') }} = {{ core_title('mb_value') }} then 'same_without_brackets'
                when length({{ normalize_title('mb_value') }}) >= 3
                     and (contains({{ normalize_title('value') }}, {{ normalize_title('mb_value') }})
                          or contains({{ normalize_title('mb_value') }}, {{ normalize_title('value') }}))
                    then 'one_contains_the_other'
                else 'different'
            end
        when 'artist' then
            case
                when value_artist = mb_artist
                  or replace(value_artist, ' ', '') = replace(mb_artist, ' ', '') then 'same'
                when contains(value_artist, mb_artist)
                  or contains(mb_artist, value_artist)
                    then 'one_contains_the_other'
                else 'different'
            end
        when 'release_date' then
            case
                when source_year is null or mb_year is null or source_year < 1900 then null
                when source_year = mb_year then 'same_year'
                when source_year > mb_year then 'later'
                else 'earlier'
            end
        when 'uploaded_by' then
            case
                when mb_artist <> 'various artists'
                     and (contains(value_artist, mb_artist)
                          or contains(mb_artist, value_artist)
                          -- without spaces, for names of 4+ letters: "Flyinglotus"
                          or (length(replace(mb_artist, ' ', '')) >= 4
                              and contains(replace(value_artist, ' ', ''), replace(mb_artist, ' ', ''))))
                    then 'the_artist'
                when names_a_label then 'the_label'
                when lower(trim(value)) = 'youtube' then 'youtube_automatic'
                else 'someone_else'
            end
    end as verdict,
    case when predicate = 'release_date' then source_year - mb_year end as years_apart
from compared
