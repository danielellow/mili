-- BRONZE: every answer from Odesli, exactly as saved by ingest/lookup_odesli.py.
-- One row per work per run. (Needs at least one run, so the folder isn't empty.)

select
    work_id,
    start_platform,     -- the platform of the link we sent to Odesli
    start_url,
    status,             -- found, not_found or error
    fetched_at,
    response,           -- Odesli's full answer, still as JSON
    filename as file_path
from read_json(
    '{{ var("raw_dir") }}/odesli/*.jsonl',
    format = 'newline_delimited',
    columns = {
        work_id: 'VARCHAR',
        start_platform: 'VARCHAR',
        start_url: 'VARCHAR',
        status: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ',
        response: 'JSON'
    },
    filename = true
)
