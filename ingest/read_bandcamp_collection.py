"""
mili, step 9: read your Bandcamp collection into your library.

Bandcamp has no open way to read a fan's collection, and it blocks automated
visits, so this works from the page saved in your own browser:
  1. open https://bandcamp.com/<your username>
  2. click "view all" and scroll to the bottom, until every item has loaded
  3. File > Save Page As... > "Webpage, Complete"
then run this script on the saved .htm/.html file.

For every item on the page it notes:
  list           collection, wishlist or hidden
  item_type      album, track, or package (a physical item)
  bandcamp_id    Bandcamp's own ID for the item
  title, artist  as shown ("by Fergus Jones & Thomas Bush" -> "Fergus Jones & Thomas Bush")
  url            the Bandcamp page the item links to
  added_at       when you bought it (or added it to your wishlist). Bandcamp keeps
                 this as a number in each item's "data-token": "1792252741:..." is
                 the time in seconds since 1970, here 17 Oct 2026 15:59 UTC.
  cover_url      the cover image on Bandcamp

It saves a copy of the page, untouched, and the items, one per line, in:
    data/raw/bandcamp_collection/<run time>/collection.html
    data/raw/bandcamp_collection/<run time>/items.jsonl

Matching the items to mili's objects happens later, in dbt
(silver_bandcamp_collection). Run `dbt build` afterwards.

Example:
    python ingest/read_bandcamp_collection.py --file ~/Downloads/"seldomdaniel's collection _ Bandcamp.html"
"""

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from bs4 import BeautifulSoup

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_ROOT = PROJECT_ROOT / "data" / "raw" / "bandcamp_collection"

# the three grids on a fan page, and what we call them
LISTS = {"collection-items": "collection", "wishlist-items": "wishlist", "hidden-items": "hidden"}


def clean_url(url):
    """Drop the '?...' tail (tracking bits) from a link."""
    if not url:
        return None
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def text_of(element):
    """The visible text of an element, without the hidden '(gift given)' note."""
    if element is None:
        return None
    element = BeautifulSoup(str(element), "html.parser")
    for span in element.select("span"):
        span.extract()
    return re.sub(r"\s+", " ", element.get_text(" ", strip=True)) or None


def added_at(token):
    """'1792252741:1474636154:a::' -> '2026-10-17T15:59:01+00:00' (or None)."""
    first = (token or "").split(":")[0]
    if not first.isdigit():
        return None
    return datetime.fromtimestamp(int(first), timezone.utc).isoformat()


def cover_url(item):
    """Bandcamp's image for the item. The saved page points at a local copy
    ('..._files/a1434871924_16.jpg'); the number is Bandcamp's image ID."""
    img = item.select_one("img.collection-item-art")
    if img is None:
        return None
    for attribute in ("src", "data-original"):
        match = re.search(r"a(\d+)_\d+\.jpg", img.get(attribute) or "")
        if match:
            return f"https://f4.bcbits.com/img/a{match.group(1)}_16.jpg"
    return None


def read_items(html):
    soup = BeautifulSoup(html, "html.parser")
    items = []
    for grid_id, list_name in LISTS.items():
        grid = soup.find(id=grid_id)
        if grid is None:
            continue
        for li in grid.select("li.collection-item-container"):
            details = li.select_one(".collection-title-details")
            link = details.select_one("a.item-link") if details else None
            artist = text_of(details.select_one(".collection-item-artist")) if details else None
            items.append({
                "list": list_name,
                "item_type": li.get("data-itemtype"),
                "bandcamp_id": li.get("data-itemid"),
                "band_id": li.get("data-bandid"),
                "title": text_of(details.select_one(".collection-item-title")) if details else li.get("data-title"),
                "artist": re.sub(r"^by\s+", "", artist) if artist else None,
                "url": clean_url(link.get("href")) if link else None,
                "added_at": added_at(li.get("data-token")),
                "cover_url": cover_url(li),
            })
    return items


def main():
    parser = argparse.ArgumentParser(description="Read a saved Bandcamp collection page into mili.")
    parser.add_argument("--file", required=True, help="the saved collection page (.htm or .html)")
    args = parser.parse_args()

    source = Path(args.file).expanduser()
    if not source.exists():
        sys.exit(f"Can't find {source}. Check the path (drag the file into the terminal to paste it).")

    html = source.read_text(encoding="utf-8", errors="replace")
    items = read_items(html)
    if not items:
        sys.exit("No collection items found. Was the page saved after scrolling to the bottom, "
                 "with 'Webpage, Complete'?")

    run_dir = RAW_ROOT / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, run_dir / "collection.html")
    fetched_at = datetime.now(timezone.utc).isoformat()
    with open(run_dir / "items.jsonl", "w", encoding="utf-8") as out:
        for item in items:
            item["fetched_at"] = fetched_at
            out.write(json.dumps(item, ensure_ascii=False) + "\n")

    counts = {}
    for item in items:
        counts[item["list"]] = counts.get(item["list"], 0) + 1
    print("Found " + ", ".join(f"{n} {name}" for name, n in counts.items()) + " items.")
    dated = [i["added_at"] for i in items if i["added_at"]]
    if dated:
        print(f"Dates from {min(dated)[:10]} to {max(dated)[:10]}.")
    print(f"Saved to {run_dir.relative_to(PROJECT_ROOT)}/")
    print("Next: dbt build (the items are matched to mili's objects there).")


if __name__ == "__main__":
    main()
