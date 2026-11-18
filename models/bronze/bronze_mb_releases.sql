-- BRONZE: every release exactly as MusicBrainz sent it.
--
-- DuckDB reads the raw JSON files straight from the data folder, so there is
-- no separate loading script. Each file is one "page" of up to 100 releases;
-- here we unpack the pages so we get one row per release.
-- Nothing is cleaned or removed. If a release was fetched in several runs,
-- it appears once per run (the silver layer keeps only the newest).

with pages as (

    select
        -- the run folder name, e.g. 20261118T100934Z
        regexp_extract(filename, 'label_releases/([^/]+)/', 1) as run_id,
        filename as file_path,
        label_name,
        label_mbid,
        mili_label,
        fetched_at,
        response.releases as releases
    from read_json(
        '{{ var("raw_dir") }}/musicbrainz/label_releases/*/*__offset-*.json',
        columns = {
            label_name: 'VARCHAR',
            label_mbid: 'VARCHAR',
            mili_label: 'VARCHAR',
            fetched_at: 'TIMESTAMPTZ',
            -- Tell DuckDB the shape up front: a "response" holding a list of
            -- releases, each kept as JSON. DuckDB then splits each page into
            -- releases while reading, instead of loading whole pages and
            -- splitting afterwards, which used far too much memory.
            response: 'STRUCT(releases JSON[])'
        },
        filename = true
    )

)

select
    run_id,
    file_path,
    label_name,
    label_mbid,
    mili_label,
    fetched_at,
    release ->> '$.id' as release_id,
    release as release_json      -- the whole release, still as JSON
from pages,
    -- turn the list of releases inside each page into separate rows
    unnest(releases) as t(release)
