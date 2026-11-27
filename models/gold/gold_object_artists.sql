-- GOLD: the artist pages each object belongs on. One row per object.
--
--   MusicBrainz works     every artist in the credit, by MusicBrainz ID, so
--                         "Kode9 & The Spaceape" is on both their pages
--   Bandcamp-only releases  the artist by name (silver_artist_names): a
--                         MusicBrainz artist's ID when the name is theirs,
--                         otherwise "name:<cleaned name>"
--   mixes                 the DJ(s) found in silver_mix_artists
--
-- An artist page in the app is everything that shares one of these keys, so a
-- DJ's mixes sit with their releases, and a Bandcamp-only release sits with the
-- artist's releases from MusicBrainz.

with musicbrainz as (

    select
        o.object_id,
        list_distinct(list_filter(
            json_extract_string(rg.release_group_json, '$.artist-credit[*].artist.id'),
            lambda a: a is not null
        )) as artist_ids,
        'musicbrainz' as found_by
    from {{ ref('gold_objects') }} o
    join {{ ref('silver_mb_release_groups') }} rg
        on rg.release_group_id = o.work_id

),

by_name as (

    select
        o.object_id,
        [a.artist_id] as artist_ids,
        'name' as found_by
    from {{ ref('gold_objects') }} o
    join {{ ref('silver_artist_names') }} a
        on a.name_key = {{ normalize_artist('o.artist_credit') }}
    where o.kind = 'release'
      and o.work_id is null

),

mixes as (

    select
        o.object_id,
        a.artist_ids,
        'mix_' || a.found_by as found_by
    from {{ ref('gold_objects') }} o
    join {{ ref('silver_mix_artists') }} a
        on o.born_from = 'link:' || a.url_key
    where o.kind = 'mix'

)

select object_id, artist_ids, found_by from musicbrainz
union all
select object_id, artist_ids, found_by from by_name
union all
select object_id, artist_ids, found_by from mixes
