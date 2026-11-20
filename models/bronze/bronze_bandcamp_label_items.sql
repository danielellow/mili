-- BRONZE: every release listed on the labels' own Bandcamp pages, as saved by
-- ingest/fetch_bandcamp_label_pages.py. One row per release per run.
-- (Needs at least one run of that script, so the folder isn't empty.)

select
    regexp_extract(filename, 'bandcamp_label_pages/([^/]+)/', 1) as run_id,
    mili_label,
    bandcamp_page,
    item_title,
    item_artist,        -- empty when the page doesn't show an artist
    item_url,
    item_type,          -- album or track
    bandcamp_id,        -- Bandcamp's own ID, for its embedded player (may be empty)
    found_in,           -- page (shown directly) or hidden_list
    fetched_at
from read_json(
    '{{ var("raw_dir") }}/bandcamp_label_pages/*/items.jsonl',
    format = 'newline_delimited',
    columns = {
        mili_label: 'VARCHAR',
        bandcamp_page: 'VARCHAR',
        item_title: 'VARCHAR',
        item_artist: 'VARCHAR',
        item_url: 'VARCHAR',
        item_type: 'VARCHAR',
        bandcamp_id: 'VARCHAR',
        found_in: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ'
    },
    filename = true
)
