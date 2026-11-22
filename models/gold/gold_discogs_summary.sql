-- GOLD (analysis): per label, where each work's Discogs link comes from.
--   master_from_musicbrainz   MusicBrainz already links the main Discogs page
--   master_from_lookup        we found the main page on Discogs
--   edition_only              we only know one edition's page (no main page)
--   search_only               no page found: the app offers a Discogs search

select
    lw.mili_label,
    count(*) as works,
    count(*) filter (where w.discogs_page_type = 'master' and w.discogs_link_source = 'musicbrainz')
        as master_from_musicbrainz,
    count(*) filter (where w.discogs_page_type = 'master' and w.discogs_link_source = 'discogs_lookup')
        as master_from_lookup,
    count(*) filter (where w.discogs_page_type = 'release') as edition_only,
    count(*) filter (where w.discogs_page_type = 'search') as search_only,
    round(count(*) filter (where w.discogs_page_type <> 'search') / count(*), 3)
        as share_with_discogs_page
from {{ ref('gold_label_works') }} lw
join {{ ref('gold_works') }} w
    on w.work_id = lw.work_id
group by 1
order by share_with_discogs_page desc
