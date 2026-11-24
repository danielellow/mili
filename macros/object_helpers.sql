{#
  Helpers for mili's own objects (see gold_objects.sql).

  normalize_url: makes two ways of writing the same link compare as equal,
  so they become one "url key":
      "https://www.AD93.bandcamp.com/album/haw/"            ->  "ad93.bandcamp.com/album/haw"
      "https://tsvi.bandcamp.com/album/haw?label=1&tab=music" ->  "tsvi.bandcamp.com/album/haw"
  It drops "https://", "www.", a slash at the end and anything after "?" or
  "#" (tracking codes). YouTube keeps its "?v=...", because that part says
  which video it is.

  mili_id: turns a piece of text into mili's short ID. It uses a "hash": a
  calculation that turns any text into a fixed-length code. The same text
  always gives the same code, so an object keeps its ID every time dbt
  rebuilds the tables. We keep the first 12 characters, e.g. "3f9a2c81d0be".

  discogs_search_url: a ready-made Discogs search for artist + title, for
  releases where we found no Discogs page.
#}

{% macro normalize_url(column) %}
    regexp_replace(
        regexp_replace(
            lower(
                case
                    when regexp_matches({{ column }}, 'youtube\.com|youtu\.be')
                        then split_part({{ column }}, '#', 1)
                    else split_part(split_part({{ column }}, '#', 1), '?', 1)
                end
            ),
            '^https?://(www\.)?', ''
        ),
        '/+$', ''
    )
{% endmacro %}

{#
  link_match_key: a key that stays the same for different ways of writing a
  link to the same release, so a link pasted from the browser can be matched
  to a link we found:
      "https://open.spotify.com/intl-de/album/4aB?si=x"  and
      "https://open.spotify.com/album/4aB"               ->  "spotify.com/4aB"
      "https://music.apple.com/gb/album/wind/1611"      and
      "https://music.apple.com/album/1611"              ->  "apple.com/1611"
      "https://www.discogs.com/master/9-Gigi-Masin-Wind" ->  "discogs/master/9"
  Most platforms: the site's main domain plus the last part of the address
  (the release's ID on that platform). Bandcamp, YouTube, SoundCloud, Mixcloud
  and NTS: the whole cleaned link, because there the address itself is the name.
#}
{% macro link_match_key(column) %}
    case
        when regexp_matches(lower({{ column }}), 'discogs\.com/[^/]*/?(master|release)/\d+')
            then 'discogs/' || regexp_extract(lower({{ column }}), '(master|release)/(\d+)', 1)
                 || '/' || regexp_extract(lower({{ column }}), '(master|release)/(\d+)', 2)
        when regexp_matches(lower({{ column }}), 'musicbrainz\.org/(release-group|release)/[0-9a-f-]{36}')
            then 'musicbrainz/' || regexp_extract(lower({{ column }}), '(release-group|release)/([0-9a-f-]{36})', 1)
                 || '/' || regexp_extract(lower({{ column }}), '(release-group|release)/([0-9a-f-]{36})', 2)
        when regexp_matches(lower({{ column }}), 'bandcamp\.com|youtube\.com|youtu\.be|soundcloud\.com|mixcloud\.com|nts\.live')
            then {{ normalize_url(column) }}
        else regexp_extract(regexp_extract({{ normalize_url(column) }}, '^([^/]+)', 1), '([^.]+\.[^.]+)$', 1)
             || '/' || regexp_extract({{ normalize_url(column) }}, '([^/]+)$', 1)
    end
{% endmacro %}

{% macro mili_id(column) %}
    left(sha256({{ column }}), 12)
{% endmacro %}

{% macro discogs_search_url(artist, title) %}
    'https://www.discogs.com/search/?q='
        || url_encode(regexp_replace(
            -- "Various Artists" only gets in the way of a search
            case
                when {{ normalize_artist(artist) }} = 'various artists' then {{ title }}
                else concat_ws(' ', {{ artist }}, {{ title }})
            end,
            '\p{Cf}', '', 'g'      -- invisible characters some names carry
        ))
        || '&type=all'
{% endmacro %}

{#
  raw_files_exist: true if at least one raw file matches the pattern. A bronze
  model can use it to stay empty (instead of failing) before its script has
  ever been run, so `dbt build` works in any order.
#}
{% macro raw_files_exist(pattern) %}
    {% if execute %}
        {% set result = run_query("select count(*) from glob('" ~ pattern ~ "')") %}
        {{ return(result.columns[0].values()[0] > 0) }}
    {% else %}
        {{ return(true) }}
    {% endif %}
{% endmacro %}
