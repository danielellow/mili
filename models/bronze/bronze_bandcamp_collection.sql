-- BRONZE: every item on your saved Bandcamp collection page, exactly as read by
-- ingest/read_bandcamp_collection.py. One row per item per run.
-- Before the page has ever been read, this table is simply empty.

{% if raw_files_exist(var("raw_dir") ~ "/bandcamp_collection/*/items.jsonl") %}

select
    regexp_extract(filename, 'bandcamp_collection/([^/]+)/', 1) as run_id,
    list,               -- collection, wishlist or hidden
    item_type,          -- album, track or package
    bandcamp_id,
    band_id,
    title,
    artist,
    url,
    added_at,           -- when you bought it (empty for the wishlist)
    cover_url,
    fetched_at
from read_json(
    '{{ var("raw_dir") }}/bandcamp_collection/*/items.jsonl',
    format = 'newline_delimited',
    columns = {
        list: 'VARCHAR',
        item_type: 'VARCHAR',
        bandcamp_id: 'VARCHAR',
        band_id: 'VARCHAR',
        title: 'VARCHAR',
        artist: 'VARCHAR',
        url: 'VARCHAR',
        added_at: 'TIMESTAMPTZ',
        cover_url: 'VARCHAR',
        fetched_at: 'TIMESTAMPTZ'
    },
    filename = true
)

{% else %}

select
    null::varchar as run_id, null::varchar as list, null::varchar as item_type,
    null::varchar as bandcamp_id, null::varchar as band_id, null::varchar as title,
    null::varchar as artist, null::varchar as url, null::timestamptz as added_at,
    null::varchar as cover_url, null::timestamptz as fetched_at
limit 0

{% endif %}
