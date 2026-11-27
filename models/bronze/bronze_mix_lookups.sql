-- BRONZE: what SoundCloud, Mixcloud and NTS said about each mix in
-- seeds/mixes.csv, as saved by ingest/lookup_mixes.py. One row per lookup.
-- Empty until the script has run.
--
--   url        the link as written in seeds/mixes.csv, or for a "via" row,
--              the Mixcloud page an NTS episode named
--   via        the NTS link it was found through (empty for links from the file)
--   ok         false when the platform didn't know the link (error says why)

{% if raw_files_exist(var("raw_dir") ~ "/mixes/*/lookups.jsonl") %}

select
    regexp_extract(filename, 'mixes/([^/]+)/', 1) as run_id,
    url,
    platform,
    via,
    fetched_at,
    ok,
    error,
    response        -- untouched
from read_json(
    '{{ var("raw_dir") }}/mixes/*/lookups.jsonl',
    format = 'newline_delimited',
    columns = {
        url: 'VARCHAR',
        platform: 'VARCHAR',
        via: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ',
        ok: 'BOOLEAN',
        error: 'VARCHAR',
        response: 'JSON'
    },
    filename = true
)

{% else %}

select
    null::varchar as run_id,
    null::varchar as url,
    null::varchar as platform,
    null::varchar as via,
    null::timestamptz as fetched_at,
    null::boolean as ok,
    null::varchar as error,
    null::json as response
where false

{% endif %}
