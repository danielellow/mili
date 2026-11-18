-- BRONZE: every answer from the barcode lookups (Apple, Deezer, Spotify),
-- exactly as saved by ingest/lookup_platforms_by_barcode.py.
-- Each line in the .jsonl files becomes one row.

select
    platform,                 -- apple, deezer or spotify
    work_id,
    barcode,                  -- the barcode of the final answer
    barcode_source,           -- musicbrainz, or deezer (second try); empty in the first test runs
    barcodes_tried,
    status,                   -- found, not_found or error
    url,
    fetched_at,
    response,                 -- the platform's full answer, still as JSON
    filename as file_path
from read_json(
    '{{ var("raw_dir") }}/barcode_lookups/*/*.jsonl',
    format = 'newline_delimited',
    columns = {
        platform: 'VARCHAR',
        work_id: 'VARCHAR',
        barcode: 'VARCHAR',
        barcode_source: 'VARCHAR',
        barcodes_tried: 'VARCHAR[]',
        status: 'VARCHAR',
        url: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ',
        response: 'JSON'
    },
    filename = true
)
