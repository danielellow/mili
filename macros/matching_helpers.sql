{#
  More helpers for comparing names (see also normalize_title.sql).

  core_title: like normalize_title, but also drops anything in brackets,
  so editions compare as the same work:
      "Haw (Remastered)"        ->  "haw"
      "Boxer (Bonus Track Version)"  ->  "boxer"

  normalize_artist: like normalize_title, plus "Various Artists" in other
  languages counts as the same (Deezer answers in Swedish from Sweden:
  "Blandade Artister").
#}

{% macro core_title(column) %}
    {{ normalize_title("regexp_replace(" ~ column ~ ", '\\s*[\\(\\[][^\\)\\]]*[\\)\\]]', '', 'g')") }}
{% endmacro %}

{% macro normalize_artist(column) %}
    case
        when {{ normalize_title(column) }} in (
            'various artists', 'various', 'blandade artister',
            'verschiedene interpreten', 'artistes divers', 'varios artistas'
        ) then 'various artists'
        else {{ normalize_title(column) }}
    end
{% endmacro %}
