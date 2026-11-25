# mili: the website

This folder is the whole website: plain HTML, CSS and JavaScript, with no build
step. The data it shows is in `data/`, written by the export. Supabase holds the
same tables, for live search:

```
dbt build
python export/export_site_data.py
python export/load_supabase.py
```

## Looking at it on your laptop

Browsers don't let a page read data files when it's opened straight from the
folder (double-clicking `index.html`), so start a small local web server, from
the `mili` folder:

```
python site/serve.py
```

Then open http://localhost:8000 in the browser. Stop the server with Control+C.
It tells the browser not to keep old copies of the files, so after an update a
normal reload shows the new version.

## On the internet

`.github/workflows/pages.yml` publishes this folder on GitHub Pages every time a
change to it is pushed: https://danielellow.github.io/mili/

## Live search

The search box asks the `search_objects` function in Supabase as you type (see
`supabase/schema.sql`). The address and the publishable key come from
`data/supabase.json`, which the export writes from `.env`. The publishable key is
meant to be public: the database only lets it read. If Supabase doesn't answer,
the site searches in the browser instead, and says so under the search box.

## The files

- `index.html`: the page frame (top bar, menu)
- `style.css`: the look
- `serve.py`: the local web server
- `js/app.js`: starts the app and picks the page from the address (`#/release/…`)
- `js/data.js`: loads `data/`, searches it, and asks Supabase for live search
- `js/ui.js`: small shared pieces (covers, rows, the coloured dots)
- `js/pages.js`: the pages: home and search, release, artist, label, library, settings
- `js/atlas.js`: the atlas (one object in the middle, three rings of things related to it)
- `js/theme.js`: dark or light, and the accent colour, kept in this browser
- `icons/`: the dot icons and the logomark (`favicon.svg` is the logomark in orange, for the browser tab)
