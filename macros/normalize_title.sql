{#
  A "macro" is a small reusable piece of SQL. This one makes titles comparable:
    "Metallur - EP"  ->  "metallur"
    "044 (Hilf Dir Selbst!)"  ->  "044 hilf dir selbst"
  It removes a trailing " - EP" / " - Single" (which Apple adds), makes
  everything lowercase, and turns punctuation into spaces.
#}
{% macro normalize_title(column) %}
    trim(
        regexp_replace(
            lower(regexp_replace({{ column }}, '\s+-\s+(EP|Single)$', '', 'i')),
            '[^\pL\pN]+', ' ', 'g'
        )
    )
{% endmacro %}
