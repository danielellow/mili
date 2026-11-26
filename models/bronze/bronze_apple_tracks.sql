-- BRONZE: Apple's answer for each album lookup, as saved by
-- ingest/lookup_apple_tracks.py. One row per release per run.
-- Empty until the script has run.

{% if raw_files_exist(var("raw_dir") ~ "/apple_tracks/*/albums.jsonl") %}

select
    regexp_extract(filename, 'apple_tracks/([^/]+)/', 1) as run_id,
    object_id,
    album_id,
    fetched_at,
    response        -- untouched: the album first, then one entry per song
from read_json(
    '{{ var("raw_dir") }}/apple_tracks/*/albums.jsonl',
    format = 'newline_delimited',
    columns = {
        object_id: 'VARCHAR',
        album_id: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ',
        response: 'JSON'
    },
    filename = true
)

{% else %}

select
    null::varchar as run_id,
    null::varchar as object_id,
    null::varchar as album_id,
    null::timestamptz as fetched_at,
    null::json as response
where false

{% endif %}
