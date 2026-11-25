-- BRONZE: the label's own picture (its "band photo", usually the logo) from each
-- saved Bandcamp label page. The pages themselves are saved untouched by
-- ingest/fetch_bandcamp_label_pages.py as data/raw/bandcamp_label_pages/<run>/<page>.html.
--
-- A whole page is about a megabyte of HTML, so instead of keeping it in a table
-- this only keeps the two bits that can hold the picture:
--   band_photo_tag  the <img class="band-photo"> next to the label's bio
--   og_image_tag    the page's preview picture (<meta property="og:image">)
-- One row per saved page per run. Empty until a page has been saved.

{% if raw_files_exist(var("raw_dir") ~ "/bandcamp_label_pages/*/*.htm*") %}

select
    regexp_extract(filename, 'bandcamp_label_pages/([^/]+)/', 1) as run_id,
    regexp_extract(filename, '([^/]+)\.html?$', 1) as page_file,   -- e.g. ad93-bandcamp-com
    regexp_extract(content, '<img[^>]*band-photo[^>]*>') as band_photo_tag,
    regexp_extract(content, '<meta[^>]*og:image[^>]*>') as og_image_tag
from read_text('{{ var("raw_dir") }}/bandcamp_label_pages/*/*.htm*')

{% else %}

select
    null::varchar as run_id,
    null::varchar as page_file,
    null::varchar as band_photo_tag,
    null::varchar as og_image_tag
where false

{% endif %}
