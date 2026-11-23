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
