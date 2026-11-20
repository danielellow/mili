"""
mili, step 5: read each label's own Bandcamp page.

MusicBrainz only knows some of the Bandcamp links. Every label on Bandcamp has
a page listing its releases (https://<label>.bandcamp.com/music). This script
reads every page in seeds/label_bandcamp_pages.csv (a label can have several).

For each label it:
  1. downloads the page and saves the HTML untouched, in
     data/raw/bandcamp_label_pages/<run time>/<label>.html
  2. pulls out the list of releases (title, artist, link) and saves it as
     data/raw/bandcamp_label_pages/<run time>/items.jsonl

Bandcamp shows the first releases directly in the page, and keeps the rest in
a hidden list inside the page ("data-client-items"). We read both.

Matching the releases to mili's works happens later, in dbt.

This is one request per label (about 20 in total), a few seconds apart.

Examples:
    python ingest/fetch_bandcamp_label_pages.py --label "AD 93"     (a quick test)
    python ingest/fetch_bandcamp_label_pages.py                     (all labels)
"""

import argparse
import csv
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SEED_FILE = PROJECT_ROOT / "seeds" / "label_bandcamp_pages.csv"
RAW_ROOT = PROJECT_ROOT / "data" / "raw" / "bandcamp_label_pages"
SECONDS_BETWEEN_LABELS = 3


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def clean_url(url, page_url):
    """Make a link absolute and drop the '?label=...&tab=music' tail."""
    absolute = urljoin(page_url, url)
    parts = urlsplit(absolute)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def read_seed():
    with open(SEED_FILE, newline="", encoding="utf-8-sig") as f:
        return [row for row in csv.DictReader(f) if (row.get("bandcamp_url") or "").strip()]


def parse_releases(html, page_url):
    """
    Pull the releases out of a Bandcamp /music page.
    Returns a list of dicts: title, artist (may be empty), url, type, found_in.
    """
    soup = BeautifulSoup(html, "html.parser")
    releases = {}

    # 1. The releases shown directly in the page
    for item in soup.select("li.music-grid-item"):
        link = item.find("a", href=True)
        title_tag = item.find(class_="title")
        if not link or not title_tag:
            continue
        artist_tag = title_tag.find(class_="artist-override")
        artist = artist_tag.get_text(" ", strip=True) if artist_tag else ""
        if artist_tag:
            artist_tag.extract()        # so it isn't counted as part of the title
        url = clean_url(link["href"], page_url)
        # e.g. data-item-id="album-1234567": Bandcamp's own ID, needed for its embedded player
        item_id = (item.get("data-item-id") or "").split("-")[-1]
        releases[url] = {
            "title": title_tag.get_text(" ", strip=True),
            "artist": artist,
            "url": url,
            "type": "track" if "/track/" in url else "album",
            "bandcamp_id": item_id if item_id.isdigit() else "",
            "found_in": "page",
        }

    # 2. The rest, from the hidden list inside the page
    grid = soup.find(id="music-grid")
    if grid and grid.get("data-client-items"):
        try:
            hidden = json.loads(grid["data-client-items"])
        except json.JSONDecodeError:
            hidden = []
        for entry in hidden:
            if not entry.get("page_url"):
                continue
            url = clean_url(entry["page_url"], page_url)
            releases.setdefault(url, {
                "title": (entry.get("title") or "").strip(),
                "artist": (entry.get("artist") or "").strip(),
                "url": url,
                "type": entry.get("type") or ("track" if "/track/" in url else "album"),
                "bandcamp_id": str(entry.get("id") or ""),
                "found_in": "hidden_list",
            })

    return list(releases.values())


def main():
    parser = argparse.ArgumentParser(description="Read each label's Bandcamp page.")
    parser.add_argument("--label", action="append", default=[],
                        help="only this mili label (can be used several times)")
    args = parser.parse_args()

    labels = read_seed()
    if args.label:
        wanted = {name.lower() for name in args.label}
        labels = [row for row in labels if row["mili_label"].lower() in wanted]
    if not labels:
        print("No labels with a bandcamp_url in seeds/label_bandcamp_pages.csv.")
        return

    run_dir = RAW_ROOT / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = (
        "Mozilla/5.0 (compatible; mili/0.1; +https://github.com/danielellow/mili)"
    )

    print(f"Reading {len(labels)} Bandcamp label pages into {run_dir.relative_to(PROJECT_ROOT)}\n")
    total = 0
    with open(run_dir / "items.jsonl", "w", encoding="utf-8") as out:
        for i, row in enumerate(labels, start=1):
            mili_label = row["mili_label"].strip()
            # Always read the /music page, where the full list of releases is.
            # (Works whether the seed has the main address or the /music address.)
            base_url = row["bandcamp_url"].strip().rstrip("/")
            if base_url.endswith("/music"):
                base_url = base_url[: -len("/music")]
            page_url = base_url + "/music"
            print(f"[{i}/{len(labels)}] {mili_label}: {page_url}")
            fetched_at = datetime.now(timezone.utc).isoformat()
            try:
                response = session.get(page_url, timeout=60)
            except requests.RequestException as error:
                print(f"   couldn't reach the page ({error.__class__.__name__}), skipping")
                continue
            if response.status_code != 200:
                print(f"   Bandcamp answered {response.status_code}, skipping")
                continue

            # Save the page untouched (the raw layer), named after its address,
            # since one label can have several pages (AD 93 and its old name Whities)
            page_name = slugify(urlsplit(row["bandcamp_url"].strip()).netloc)
            (run_dir / f"{page_name}.html").write_text(response.text, encoding="utf-8")

            releases = parse_releases(response.text, response.url)
            for release in releases:
                out.write(json.dumps({
                    "mili_label": mili_label,
                    "bandcamp_page": row["bandcamp_url"].strip(),
                    "item_title": release["title"],
                    "item_artist": release["artist"],
                    "item_url": release["url"],
                    "item_type": release["type"],
                    "bandcamp_id": release["bandcamp_id"],   # for Bandcamp's embedded player
                    "found_in": release["found_in"],
                    "fetched_at": fetched_at,
                }, ensure_ascii=False) + "\n")
            total += len(releases)

            if releases:
                print(f"   {len(releases)} releases")
            else:
                print("   no releases found in the page. Send me the saved .html file "
                      "so I can check how this page is built.")
            time.sleep(SECONDS_BETWEEN_LABELS)

    print(f"\nDone. {total} releases saved to {(run_dir / 'items.jsonl').relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
