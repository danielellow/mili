"""
mili, step 10: the details of the DJ mixes in seeds/mixes.csv.

You add a mix by pasting its link into seeds/mixes.csv, one link per line under
the first line. The other columns are optional; this script fills in the empty
commas dbt needs, so a line can be just the link. Then it asks the platform the
link is on what the mix is: its title, who uploaded it, the artwork, the date,
the length and the genres.

    SoundCloud   the public embed lookup (oEmbed), which needs no key:
                 https://soundcloud.com/oembed?format=json&url=<link>
                 It gives the title, the uploader and the artwork (no date or
                 length). SoundCloud's full API needs a paid Artist Pro account.
    Mixcloud     the public API, which needs no key: the link with
                 www.mixcloud.com changed to api.mixcloud.com
    NTS          the JSON NTS's own website reads (not documented, but public):
                 https://www.nts.live/api/v2/shows/<show>/episodes/<episode>
                 NTS archives every show on Mixcloud too: when the episode says
                 where, that Mixcloud page is looked up as well (for the length),
                 and the mix gets both links.

Answers are saved untouched, in
    data/raw/mixes/<run time>/lookups.jsonl
and read by dbt (bronze_mix_lookups). Links already looked up are skipped;
ones that failed are tried again next time. Only metadata is read, never audio,
and no tracklists.

Examples:
    python ingest/lookup_mixes.py                 (every new link in seeds/mixes.csv)
    python ingest/lookup_mixes.py --again         (look every link up again)
Then: dbt build
"""

import argparse
import csv
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SEED = PROJECT_ROOT / "seeds" / "mixes.csv"
RAW_ROOT = PROJECT_ROOT / "data" / "raw" / "mixes"
USER_AGENT = "mili/0.1 ( https://github.com/danielellow/mili )"
SECONDS_BETWEEN_CALLS = 1.0      # gentle: one question a second


def platform_of(url):
    host = (urlparse(url).hostname or "").lower()
    host = re.sub(r"^(www|m)\.", "", host)
    if host.endswith("soundcloud.com"):
        return "soundcloud"
    if host.endswith("mixcloud.com"):
        return "mixcloud"
    if host.endswith("nts.live"):
        return "nts"
    return None


def api_address(url, platform):
    """Where to ask about this link, or (None, why not)."""
    path = urlparse(url).path
    if platform == "mixcloud":
        parts = [p for p in path.split("/") if p]
        if len(parts) < 2:
            return None, "this is a Mixcloud profile, not a mix: open one mix and copy its link"
        return f"https://api.mixcloud.com/{parts[0]}/{parts[1]}/", None
    if platform == "nts":
        found = re.search(r"/shows/([^/]+)/episodes/([^/?#]+)", path)
        if not found:
            return None, "this is an NTS show, not an episode: open one episode and copy its link"
        return f"https://www.nts.live/api/v2/shows/{found.group(1)}/episodes/{found.group(2)}", None
    if platform == "soundcloud":
        return "https://soundcloud.com/oembed", None
    return None, "not a SoundCloud, Mixcloud or NTS link"


COLUMNS = ["mix_url", "artist", "title", "status", "added_on", "collages", "note"]


def tidy_seed():
    """Give every line all seven columns (dbt can't read a line that is only a
    link), and put the first line back if it's missing. Nothing else changes."""
    with open(SEED, encoding="utf-8", newline="") as f:
        rows = [row for row in csv.reader(f) if any(cell.strip() for cell in row)]
    header_missing = not rows or rows[0][:1] != ["mix_url"]
    body = rows if header_missing else rows[1:]
    tidy = [COLUMNS] + [[cell.strip() for cell in row[:len(COLUMNS)]] + [""] * (len(COLUMNS) - len(row)) for row in body]
    if tidy != rows:
        with open(SEED, "w", encoding="utf-8", newline="") as f:
            csv.writer(f, lineterminator="\n").writerows(tidy)
        print("Tidied seeds/mixes.csv (filled in the empty columns).")


def read_seed():
    if not SEED.exists():
        sys.exit(f"{SEED.relative_to(PROJECT_ROOT)} is missing.")
    tidy_seed()
    with open(SEED, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    links = []
    for row in rows:
        url = (row.get("mix_url") or "").strip()
        if url and not url.startswith("#") and url not in links:
            links.append(url)
    return links


def already_done():
    """Links with a good answer saved already."""
    done = set()
    for path in RAW_ROOT.glob("*/lookups.jsonl"):
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if record.get("ok") and not record.get("via"):
                    done.add(record["url"])
    return done


class Asker:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.last = 0.0

    def get(self, address, params=None):
        wait = SECONDS_BETWEEN_CALLS - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.last = time.monotonic()
        for attempt in range(3):
            try:
                response = self.session.get(address, params=params, timeout=20)
            except requests.RequestException as error:
                if attempt == 2:
                    raise
                time.sleep(3 * (attempt + 1))
                continue
            if response.status_code == 429 or response.status_code >= 500:
                time.sleep(10 * (attempt + 1))      # busy: wait and try again
                continue
            return response
        return response

    def full_link(self, url):
        """on.soundcloud.com/... short links lead to the real page."""
        if "on.soundcloud.com" in url:
            response = self.session.head(url, allow_redirects=True, timeout=20)
            return response.url.split("?")[0]
        return url


def look_up(asker, url, platform, via=None):
    address, why_not = api_address(url, platform)
    record = {
        "url": url,
        "platform": platform,
        "via": via,        # set when this was found through another link (an NTS episode's Mixcloud page)
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ok": False,
        "error": None,
        "response": None,
    }
    if not address:
        record["error"] = why_not
        return record
    params = {"format": "json", "url": url} if platform == "soundcloud" else None
    try:
        response = asker.get(address, params=params)
    except requests.RequestException as error:
        record["error"] = str(error)
        return record
    if response.status_code == 404:
        record["error"] = "not found (private, deleted, or the link has a typo)"
        return record
    if not response.ok:
        record["error"] = f"HTTP {response.status_code}"
        return record
    try:
        record["response"] = response.json()
        record["ok"] = True
    except ValueError:
        record["error"] = "the answer wasn't JSON"
    return record


def mixcloud_link_of(nts_answer):
    """The Mixcloud page an NTS episode names, if any."""
    candidates = [nts_answer.get("mixcloud")]
    candidates += [s.get("url") for s in nts_answer.get("audio_sources") or [] if isinstance(s, dict)]
    for link in candidates:
        if link and "mixcloud.com" in link:
            return link if link.startswith("http") else f"https://www.mixcloud.com{link}"
    return None


def main():
    parser = argparse.ArgumentParser(description="Look up the mixes in seeds/mixes.csv.")
    parser.add_argument("--again", action="store_true", help="look every link up again, not only new ones")
    args = parser.parse_args()

    links = read_seed()
    done = set() if args.again else already_done()
    todo = [url for url in links if url not in done]
    print(f"{len(links)} mixes in seeds/mixes.csv, {len(todo)} to look up.")
    if not todo:
        print("Nothing to do. Next: dbt build")
        return

    asker = Asker()
    run_dir = RAW_ROOT / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True, exist_ok=True)
    found = failed = 0
    try:
        with open(run_dir / "lookups.jsonl", "a", encoding="utf-8") as out:
            for url in todo:
                platform = platform_of(url)
                if platform == "soundcloud":
                    try:
                        url_to_ask = asker.full_link(url)
                    except requests.RequestException:
                        url_to_ask = url
                else:
                    url_to_ask = url
                record = look_up(asker, url_to_ask, platform)
                record["url"] = url                      # keep the link as written in the file
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()
                if record["ok"]:
                    found += 1
                    answer = record["response"]
                    title = answer.get("name") or answer.get("title") or "?"
                    print(f"   ✓ {platform}: {title}")
                    # an NTS episode: look up its Mixcloud page too
                    if platform == "nts":
                        mixcloud = mixcloud_link_of(answer)
                        if mixcloud:
                            extra = look_up(asker, mixcloud, "mixcloud", via=url)
                            out.write(json.dumps(extra, ensure_ascii=False) + "\n")
                            out.flush()
                            if extra["ok"]:
                                print(f"     + also on Mixcloud")
                else:
                    failed += 1
                    print(f"   ✗ {url}\n     {record['error']}")
    except KeyboardInterrupt:
        print("\nStopped. What was saved is kept; run the same command again to carry on.")

    print(f"\nFound {found}, not found {failed}.")
    print(f"Saved to {(run_dir / 'lookups.jsonl').relative_to(PROJECT_ROOT)}")
    print("Next: dbt build")


if __name__ == "__main__":
    main()
