-- BRONZE: MusicBrainz's answer for each release, with its songs, as saved by
-- ingest/musicbrainz_fetch_tracks.py. One row per release per run.
-- Empty until the script has run.

{% if raw_files_exist(var("raw_dir") ~ "/musicbrainz/release_tracks/*/releases.jsonl") %}

select
    regexp_extract(filename, 'release_tracks/([^/]+)/', 1) as run_id,
    work_id,
    release_id,
    fetched_at,
    response        -- the release, untouched: its media (discs), and the tracks on each
from read_json(
    '{{ var("raw_dir") }}/musicbrainz/release_tracks/*/releases.jsonl',
    format = 'newline_delimited',
    columns = {
        work_id: 'VARCHAR',
        release_id: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ',
        response: 'JSON'
    },
    filename = true
)

{% else %}

select
    null::varchar as run_id,
    null::varchar as work_id,
    null::varchar as release_id,
    null::timestamptz as fetched_at,
    null::json as response
where false

{% endif %}
