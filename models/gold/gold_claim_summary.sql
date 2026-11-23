-- GOLD (analysis): how often each source agrees with MusicBrainz, per label
-- and fact. The first rows, "(all labels)", are the totals.
--
--   compared            works where both MusicBrainz and the source say something
--   agree               same (title, artist) or same year (release date)
--   partly              title only differs in brackets, or one artist name
--                       contains the other
--   disagree            different, or a different year
--   later / earlier     release dates only: the source's year is later or earlier
--   median_years_later  release dates only: for the later ones, how many years
--                       later (the middle value)
--
-- Who uploaded a release (uploaded_by) isn't a yes/no agreement, so it has its
-- own summary: gold_upload_summary.
--
-- When a source gave the same fact in two ways (e.g. Spotify's title from the
-- barcode lookup and from Odesli), only the most confident one is counted.

with ranked as (

    select
        *,
        row_number() over (
            partition by object_id, predicate, source
            order by confidence desc nulls last, method, value
        ) as preference
    from {{ ref('gold_claim_comparisons') }}
    where verdict is not null
      and predicate <> 'uploaded_by'

),

one_per_source as (

    select * from ranked where preference = 1

),

labelled as (

    select '(all labels)' as mili_label, x.*
    from one_per_source x

    union all

    select ol.mili_label, x.*
    from one_per_source x
    join {{ ref('gold_object_labels') }} ol
        on ol.object_id = x.object_id

)

select
    mili_label,
    predicate,
    source,
    count(*) as compared,
    count(*) filter (where verdict in ('same', 'same_year')) as agree,
    count(*) filter (where verdict in ('same_without_brackets', 'one_contains_the_other')) as partly,
    count(*) filter (where verdict in ('different', 'later', 'earlier')) as disagree,
    round(count(*) filter (where verdict in ('different', 'later', 'earlier')) / count(*), 3)
        as share_disagree,
    count(*) filter (where verdict = 'later') as later,
    count(*) filter (where verdict = 'earlier') as earlier,
    median(years_apart) filter (where verdict = 'later') as median_years_later
from labelled
group by mili_label, predicate, source
order by mili_label = '(all labels)' desc, mili_label, predicate, compared desc
