-- BRONZE: every answer from the Deezer artist + title search, exactly as saved
-- by ingest/search_deezer_by_title.py. One row per work per search run.
-- (Needs at least one search run, so the folder isn't empty.)

select
    work_id,
    title,              -- the MusicBrainz title we searched for
    main_artist,        -- the MusicBrainz main artist we searched for
    has_barcode,
    queries_tried,
    status,             -- found = Deezer returned candidates (checked later), not_found, error
    fetched_at,
    response,           -- Deezer's full answer, still as JSON
    filename as file_path
from read_json(
    '{{ var("raw_dir") }}/deezer_title_search/*.jsonl',
    format = 'newline_delimited',
    columns = {
        work_id: 'VARCHAR',
        title: 'VARCHAR',
        main_artist: 'VARCHAR',
        has_barcode: 'BOOLEAN',
        queries_tried: 'VARCHAR[]',
        status: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ',
        response: 'JSON'
    },
    filename = true
)
