-- TEST: every confidence in seeds/match_confidence.csv should be between 0 and 1.
-- The test passes if this returns no rows.

select method, confidence
from {{ ref('match_confidence') }}
where confidence < 0 or confidence > 1
