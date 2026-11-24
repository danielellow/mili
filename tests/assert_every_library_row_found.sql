-- TEST (a warning, not an error): every row in seeds/library.csv should be
-- found in the catalogue. Rows listed here weren't found; see check_note in
-- silver_library for why. The rest of the build carries on either way.

{{ config(severity = 'warn') }}

select artist, title, link, check_note
from {{ ref('silver_library') }}
where object_id is null
