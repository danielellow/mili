-- GOLD (for the app): one row per label, with its picture, for the front page.
--
-- The picture is, in this order:
--   1. one you chose yourself in seeds/label_artwork.csv (a web address, or a
--      file in the site folder such as images/labels/4ad.png)
--   2. the label's own picture from its Bandcamp page (silver_label_artwork)
--   3. none: the site then shows the label's first letter
-- `position` in the same seed puts labels in your own order; labels without
-- one come after, A to Z.

with labels as (
    select distinct mili_label
    from {{ ref('labels') }}
),

objects_per_label as (
    select mili_label, count(*) as objects
    from {{ ref('gold_object_labels') }}
    group by mili_label
),

chosen as (
    select mili_label, nullif(trim(image), '') as image, position
    from {{ ref('label_artwork') }}
)

select
    l.mili_label as label,
    trim(regexp_replace(lower(l.mili_label), '[^a-z0-9]+', '-', 'g'), '-') as slug,
    coalesce(c.image, a.image_url) as image,
    case
        when c.image is not null then 'chosen by hand'
        when a.image_url is not null then 'bandcamp page'
    end as image_source,
    a.bandcamp_url,
    coalesce(o.objects, 0) as objects,
    c.position
from labels l
left join chosen c on c.mili_label = l.mili_label
left join {{ ref('silver_label_artwork') }} a on a.mili_label = l.mili_label
left join objects_per_label o on o.mili_label = l.mili_label
order by c.position nulls last, lower(l.mili_label)
