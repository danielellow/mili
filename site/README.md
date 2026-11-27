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

## Searching

Press **/** (or ⌘K, or the + in the top bar) to open the search box
(`js/palette.js`). It's the only search box: it shows "go to" places, releases in
mili as you type, and "search everything", which opens the results page
(`#/search?q=…`) with the outside search (MusicBrainz, Apple Music, Deezer,
Discogs). Pasting a link opens that release if mili has it; if not, the box asks
Odesli (through the `search-outside` function) what it is and where else it can
be heard.

The box asks the `search_objects` function in Supabase as you type (see
`supabase/schema.sql`). The address and the publishable key come from
`data/supabase.json`, which the export writes from `.env`. The publishable key is
meant to be public: the database only lets it read. If Supabase doesn't answer,
the site searches in the browser instead, and the results page says so.

## The files

- `index.html`: the page frame (top bar, menu)
- `style.css`: the look
- `serve.py`: the local web server
- `js/app.js`: starts the app and picks the page from the address (`#/release/…`)
- `js/data.js`: loads `data/`, searches it, and asks Supabase for live search
- `js/ui.js`: small shared pieces (covers, rows, the coloured dots)
- `js/pages.js`: the pages: home (getting started), search results, release, artist, label, library, settings, guide
- `js/palette.js`: the search box that "/" opens
- `js/account.js`: signing in, and saving notes and collages in Supabase
- `js/notes.js`: the note on a release, mix or collage (the pencil)
- `js/collages.js`: collages: adding to them, and the collage page
- `about.md`: the "what is mili" page (#/about). Write it like a plain text
  file: an empty line starts a new paragraph, "# " makes a heading, "- " a list,
  [words](https://…) a link and **words** bold.
- `js/atlas.js`: the atlas (one object in the middle, three rings of things related to it)
- `js/theme.js`: dark or light, and the accent colour, kept in this browser
- `js/garden.js`: the garden (shape the ground, plant your library, tend the plants)
- `js/plants.js`: the garden's plants: 18 families, 108 species, and how each is drawn
- `icons/`: the dot icons and the logomark (`favicon.svg` is the logomark in orange, for the browser tab)

## Publishing your garden

The garden is kept in the browser you made it in. To show it on the published
site, press **save** in the garden, which downloads `garden.json`, and put that
file in `site/data/`. Visitors who haven't started their own garden see yours.

## Notes and collages

Signed in (the menu → sign in), you can write a note on any release, mix or
collage, and gather releases and mixes into collages. They're saved in Supabase
(`supabase/user_data.sql`), so they're the same on every device and on the
published site. Notes start private and collages start public; both can be
switched. Accounts are made in the Supabase dashboard: see `supabase/README.md`.
