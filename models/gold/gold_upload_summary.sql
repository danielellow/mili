-- GOLD (analysis): who uploaded the releases we found on YouTube, YouTube Music
-- and SoundCloud, per label and platform. The first rows, "(all labels)", are
-- the totals. (See gold_claim_comparisons for how each uploader is sorted.)
--
--   uploads             releases with an uploader name on that platform
--   by_artist           the artist's own account (or YouTube's "Artist - Topic")
--   by_label            the label's account
--   youtube_automatic   YouTube's own automatic channels
--   someone_else        anyone else, often a fan
--   share_someone_else  someone_else / uploads

with uploads as (

    select object_id, source, verdict
    from {{ ref('gold_claim_comparisons') }}
    where predicate = 'uploaded_by'

),

labelled as (

    select '(all labels)' as mili_label, u.*
    from uploads u

    union all

    select ol.mili_label, u.*
    from uploads u
    join {{ ref('gold_object_labels') }} ol
        on ol.object_id = u.object_id

)

select
    mili_label,
    source,
    count(*) as uploads,
    count(*) filter (where verdict = 'the_artist') as by_artist,
    count(*) filter (where verdict = 'the_label') as by_label,
    count(*) filter (where verdict = 'youtube_automatic') as youtube_automatic,
    count(*) filter (where verdict = 'someone_else') as someone_else,
    round(count(*) filter (where verdict = 'someone_else') / count(*), 3) as share_someone_else
from labelled
group by mili_label, source
order by mili_label = '(all labels)' desc, mili_label, source
