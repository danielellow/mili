-- BRONZE: every answer from the Apple Music name search, exactly as saved by
-- ingest/search_apple_by_title.py. One row per work per search run.
-- Before the search has ever been run, this table is simply empty.

{% if raw_files_exist(var("raw_dir") ~ "/apple_title_search/*.jsonl") %}

select
    work_id,
    title,              -- the MusicBrainz title we searched for
    main_artist,        -- the MusicBrainz main artist we searched for
    has_barcode,
    unheard,            -- true if the work had no streaming link when we searched
    queries_tried,
    status,             -- found = Apple returned candidates (checked later), not_found, error
    fetched_at,
    response,           -- Apple's full answer, still as JSON
    filename as file_path
from read_json(
    '{{ var("raw_dir") }}/apple_title_search/*.jsonl',
    format = 'newline_delimited',
    columns = {
        work_id: 'VARCHAR',
        title: 'VARCHAR',
        main_artist: 'VARCHAR',
        has_barcode: 'BOOLEAN',
        unheard: 'BOOLEAN',
        queries_tried: 'VARCHAR[]',
        status: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ',
        response: 'JSON'
    },
    filename = true
)

{% else %}

select
    null::varchar as work_id, null::varchar as title, null::varchar as main_artist,
    null::boolean as has_barcode, null::boolean as unheard, null::varchar[] as queries_tried,
    null::varchar as status, null::timestamptz as fetched_at, null::json as response,
    null::varchar as file_path
limit 0

{% endif %}
