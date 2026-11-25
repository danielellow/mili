-- BRONZE: every answer from Odesli for your Bandcamp collection
-- (ingest/lookup_odesli.py --library). One row per object per run.
-- Before that run, this table is simply empty.

{% if raw_files_exist(var("raw_dir") ~ "/odesli_library/*.jsonl") %}

select
    born_from,
    start_platform,
    start_url,
    status,             -- found, not_found or error
    fetched_at,
    response,
    filename as file_path
from read_json(
    '{{ var("raw_dir") }}/odesli_library/*.jsonl',
    format = 'newline_delimited',
    columns = {
        born_from: 'VARCHAR', start_platform: 'VARCHAR', start_url: 'VARCHAR',
        status: 'VARCHAR', fetched_at: 'TIMESTAMPTZ', response: 'JSON'
    },
    filename = true
)

{% else %}

select
    null::varchar as born_from, null::varchar as start_platform, null::varchar as start_url,
    null::varchar as status, null::timestamptz as fetched_at, null::json as response,
    null::varchar as file_path
limit 0

{% endif %}
