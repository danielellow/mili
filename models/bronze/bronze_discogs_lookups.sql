-- BRONZE: every answer from Discogs, exactly as saved by ingest/lookup_discogs.py.
-- One row per work per run. (Needs at least one run, so the folder isn't empty.)

select
    work_id,
    method,             -- release_lookup, barcode_search or title_search
    queries_tried,
    status,             -- found, not_found or error
    fetched_at,
    response,           -- Discogs' full answer, still as JSON
    filename as file_path
from read_json(
    '{{ var("raw_dir") }}/discogs/*.jsonl',
    format = 'newline_delimited',
    columns = {
        work_id: 'VARCHAR',
        method: 'VARCHAR',
        queries_tried: 'VARCHAR[]',
        status: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ',
        response: 'JSON'
    },
    filename = true
)
