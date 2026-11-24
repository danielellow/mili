-- SILVER: which VERSION of a work each link is, read from the title the
-- platform shows. One row per work and link.
--
-- mili has three levels:
--   object     the work, "Wind" (gold_objects)
--   version    a form the work comes in: "Wind", "Wind (Deluxe Version)", a remaster
--   instance   where a version lives: Spotify, Bandcamp ... (gold_object_instances)
--
-- How a link's version is found:
--   1. Take the title that came with the link (from the barcode lookup, Odesli,
--      the label's Bandcamp page, Discogs, or the MusicBrainz edition it's on).
--      If several sources gave a title for the same link, the most confident wins.
--   2. If the title, without brackets, still contains the work's title, the
--      text in brackets that the work's own title doesn't have is the version:
--          "Wind (Deluxe Version)"                     -> Deluxe Version
--          "Selected Ambient Works 85-92 (Remastered)" -> Remastered
--   3. Brackets that only describe the upload are ignored: a year on its own,
--      "Full Album", "Official Audio", "EP", "Single (Version)", "Explicit",
--      sound formats ("24 Bit"), YouTube's "Topic", a label's name
--      ("International Anthem"), catalogue numbers ("IA11", also "IA11 Version"),
--      artist credits ("feat. Loraine James"), formats on their own ("Vinyl",
--      "CD"), soundtrack descriptions ("Original Motion Picture Soundtrack")
--      and brackets with only numbers or symbols ("~37").
--   4. No version text = the standard version (version_key '').
--
-- maybe_another_release: a version called live, remix(es), rework, demo(s),
-- instrumental(s), acoustic, dub or karaoke is usually a work of its own, not
-- a version.
-- If one turns up here, the link was probably matched to the wrong work (one
-- title contains the other). These links are kept, but marked, so the page can
-- leave them out and the AI judge can look at them.
--
-- version_key makes different wordings of the same version equal, so
-- "Deluxe Version" and "Deluxe Edition" are one version ("deluxe"), and
-- "Remastered", "Remaster" and "Digitally Remastered" are one too ("remaster").

with link_titles as (

    select work_id, url, platform_title as title,
           case matched_on when 'barcode' then 'barcode_exact' else 'barcode_other' end as method
    from {{ ref('silver_platform_matches') }}
    where is_accepted and url is not null

    union all

    select work_id, url, deezer_title as title, 'title_search' as method
    from {{ ref('silver_deezer_title_matches') }}
    where is_accepted and url is not null

    union all

    select work_id, url, platform_title as title, 'odesli' as method
    from {{ ref('silver_odesli_links') }}
    where is_accepted

    union all

    select work_id, item_url as url, item_title as title, 'bandcamp_page' as method
    from {{ ref('silver_bandcamp_label_matches') }}
    where is_matched

    union all

    select work_id, 'https://www.discogs.com/release/' || release_id as url, discogs_title as title,
           'discogs_' || method as method
    from {{ ref('silver_discogs_matches') }}
    where is_accepted and release_id is not null

    union all

    -- links MusicBrainz puts on one edition: that edition's title
    select u.release_group_id as work_id, u.url, r.title, 'musicbrainz' as method
    from {{ ref('silver_mb_urls') }} u
    join {{ ref('silver_mb_releases') }} r
        on r.release_id = u.release_id
    where u.level = 'edition'

),

best as (

    select
        l.work_id,
        {{ normalize_url('l.url') }} as url_key,
        l.title,
        row_number() over (
            partition by l.work_id, {{ normalize_url('l.url') }}
            order by c.confidence desc nulls last, l.title
        ) as preference
    from link_titles l
    left join {{ ref('match_confidence') }} c
        on c.method = l.method
    where nullif(trim(l.title), '') is not null

),

label_names as (

    -- every seed label's name, written the way a title's brackets would hold it
    select list(distinct n) as names
    from (
        select {{ normalize_title('mili_label') }} as n from {{ ref('labels') }}
        union
        select {{ normalize_title('label_name') }} as n from {{ ref('labels') }}
    )

),

parts as (

    select
        b.work_id,
        b.url_key,
        b.title,
        -- "Album - Wind" and "Gigi Masin - Wind (1986)" still contain "Wind"
        contains({{ core_title('b.title') }}, {{ core_title('g.title') }}) as same_work_title,
        -- the text inside each pair of brackets, keeping only real versions
        list_filter(
            list_transform(
                regexp_extract_all(b.title, '[\(\[]([^\)\]]+)[\)\]]', 1),
                -- sound formats are dropped from the text: "24 Bit Remaster" -> "Remaster"
                lambda p: trim(regexp_replace(
                    p, '\b(16|24|32)[ -]?bit\b|\bhi[ -]?res\b|\b\d+([.,]\d+)? ?khz\b', ' ', 'gi'
                ))
            ),
            lambda p:
                {{ normalize_title('p') }} <> ''
                -- not a bracket the work's own title has: "044 (Hilf dir selbst!)"
                and not list_contains(
                    list_transform(
                        regexp_extract_all(g.title, '[\(\[]([^\)\]]+)[\)\]]', 1),
                        lambda q: {{ normalize_title('q') }}
                    ),
                    {{ normalize_title('p') }}
                )
                -- not a description of the upload
                and not regexp_matches(
                    {{ normalize_title('p') }},
                    '^(\d+|album|ep|lp|single|single version|hd|hq|audio|explicit|clean|mixed|topic|vinyl|cd|cassette|tape|digital)$'
                )
                and not regexp_matches(
                    {{ normalize_title('p') }},
                    'full (album|ep|lp)|official|lyric|visuali|stream|soundtrack|original (motion picture|score|television|cast)|music from the (motion picture|film)|\bost\b'
                )
                -- not an artist credit: "feat. Loraine James", "with Sam Gendel"
                and not regexp_matches({{ normalize_title('p') }}, '^(feat|featuring|ft|with|prod|produced by)\b')
                -- not a label's name
                and not list_contains(ln.names, {{ normalize_title('p') }})
                -- not a catalogue number: a few letters and a few digits ("IA11",
                -- "WARP 30", "AD93-011"), but "Vol. 2" or "Part 1" stay, since those
                -- name another work
                and not (
                    regexp_matches(
                        trim(regexp_replace({{ normalize_title('p') }}, '\s*\b(edition|version|ed)\b\s*', ' ', 'g')),
                        '^[a-z]{1,6}\d{0,3} ?\d{1,5}[a-z]?$'
                    )
                    and not regexp_matches({{ normalize_title('p') }}, '^(vol|volume|part|pt|no|chapter|book|act|op)\b')
                )
        ) as all_parts
    from best b
    join {{ ref('silver_mb_release_groups') }} g
        on g.release_group_id = b.work_id
    cross join label_names ln
    where b.preference = 1

),

versions as (

    select
        *,
        case when same_work_title then all_parts else []::varchar[] end as version_parts
    from parts

)

select
    work_id,
    url_key,
    title as title_seen,
    array_to_string(version_parts, ', ') as version_label,     -- '' = the standard version
    array_to_string(
        list_sort(list_filter(
            list_transform(
                version_parts,
                lambda p: trim(regexp_replace(
                    regexp_replace(
                        regexp_replace({{ normalize_title('p') }}, 'remastered', 'remaster', 'g'),
                        '\b(edition|version|ed|the|digitally)\b', ' ', 'g'
                    ),
                    '\s+', ' ', 'g'
                ))
            ),
            lambda k: k <> ''
        )),
        ' + '
    ) as version_key,                                          -- '' = the standard version
    coalesce(list_bool_or(list_transform(
        version_parts,
        lambda p: regexp_matches(
            {{ normalize_title('p') }},
            '\b(live|remix|remixes|remixed|rework|reworks|reworked|demo|demos|instrumental|instrumentals|acoustic|dub|dubs|karaoke|acapella|a cappella)\b'
        )
    )), false) as maybe_another_release
from versions
