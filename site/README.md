# mili: the website

This folder is the whole website: plain HTML, CSS and JavaScript, with no build
step. The data it shows is in `data/`, written by the export:

```
dbt build
python export/export_site_data.py
```

## Looking at it on your laptop

Browsers don't let a page read data files when it's opened straight from the
folder (double-clicking `index.html`), so start a small local web server:

```
cd ~/Documents/mili/site
python -m http.server 8000
```

Then open http://localhost:8000 in the browser. Stop the server with Ctrl+C.

## The files

- `index.html`: the page frame (top bar, search box)
- `style.css`: the look
- `js/app.js`: starts the app and picks the page from the address (`#/release/…`)
- `js/data.js`: loads `data/` and searches it
- `js/ui.js`: small shared pieces (covers, rows, the coloured dots)
- `js/pages.js`: the pages: home and search, release, artist, label, library
- `icons/`: the dot icons and the logomark (`favicon.svg` is the logomark in orange, for the browser tab)
