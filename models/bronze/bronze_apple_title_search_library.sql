-- BRONZE: every answer from the Apple Music search for your Bandcamp collection
-- (ingest/search_apple_by_title.py --library). One row per object per run.
-- Before that search has ever been run, this table is simply empty.

{% if raw_files_exist(var("raw_dir") ~ "/apple_title_search_library/*.jsonl") %}

select
    born_from,          -- the object's identity: "bandcamp:track:2294750051"
    item_type,          -- track or album
    title,
    artist,
    searched_as,        -- song (for tracks) or album
    queries_tried,
    status,             -- found = Apple returned candidates (checked later), not_found, error
    fetched_at,
    response,
    filename as file_path
from read_json(
    '{{ var("raw_dir") }}/apple_title_search_library/*.jsonl',
    format = 'newline_delimited',
    columns = {
        born_from: 'VARCHAR', item_type: 'VARCHAR', title: 'VARCHAR', artist: 'VARCHAR',
        searched_as: 'VARCHAR', queries_tried: 'VARCHAR[]', status: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ', response: 'JSON'
    },
    filename = true
)

{% else %}

select
    null::varchar as born_from, null::varchar as item_type, null::varchar as title,
    null::varchar as artist, null::varchar as searched_as, null::varchar[] as queries_tried,
    null::varchar as status, null::timestamptz as fetched_at, null::json as response,
    null::varchar as file_path
limit 0

{% endif %}
