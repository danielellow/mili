-- SILVER: one picture per label, from its Bandcamp page.
--
-- Bandcamp pictures live at https://f4.bcbits.com/img/<image id>_<size>.jpg.
-- We take the image ID from the band photo (or, failing that, from the page's
-- preview picture) and ask for size 16, which is 700 × 700.
-- Album covers have an "a" before the ID (img/a123…); a label's own picture
-- doesn't, so the pattern below only finds the label's picture.
--
-- A label with two pages (Numero Group) uses the page with the most releases.

with pages as (
    -- the seed lists each label's pages; the saved file is named after the page's address
    select
        mili_label,
        bandcamp_url,
        regexp_replace(
            lower(regexp_extract(bandcamp_url, 'https?://([^/]+)', 1)),
            '[^a-z0-9]+', '-', 'g') as page_file
    from {{ ref('label_bandcamp_pages') }}
),

newest as (
    -- the newest saved copy of each page
    select *
    from {{ ref('bronze_bandcamp_label_page_images') }}
    qualify row_number() over (partition by page_file order by run_id desc) = 1
),

found as (
    select
        page_file,
        coalesce(
            nullif(regexp_extract(band_photo_tag, '/img/([0-9]+)_[0-9]+\.(jpg|png|gif)', 1), ''),
            nullif(regexp_extract(og_image_tag, '/img/([0-9]+)_[0-9]+\.(jpg|png|gif)', 1), '')
        ) as image_id,
        case
            when regexp_matches(band_photo_tag, '/img/[0-9]+_') then 'band_photo'
            when regexp_matches(og_image_tag, '/img/[0-9]+_') then 'page_preview'
        end as found_in
    from newest
),

releases_per_page as (
    select bandcamp_page, count(*) as releases
    from {{ ref('bronze_bandcamp_label_items') }}
    group by bandcamp_page
)

select
    p.mili_label,
    p.bandcamp_url,
    f.image_id,
    'https://f4.bcbits.com/img/' || f.image_id || '_16.jpg' as image_url,
    f.found_in
from pages p
join found f
    on f.page_file = p.page_file
left join releases_per_page r
    on rtrim(r.bandcamp_page, '/') = rtrim(p.bandcamp_url, '/')
where f.image_id is not null
qualify row_number() over (partition by p.mili_label order by coalesce(r.releases, 0) desc, p.bandcamp_url) = 1
