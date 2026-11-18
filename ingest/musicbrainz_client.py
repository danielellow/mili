"""
A small shared toolbox for talking to MusicBrainz, used by every mili script.

It takes care of three things, so the scripts themselves don't have to:
  1. Introducing mili politely: MusicBrainz asks every app for a name and a
     way to contact the person running it (your MB_CONTACT in .env).
  2. Keeping to about one request per second, as MusicBrainz asks.
  3. Waiting and trying again when MusicBrainz is busy, a little longer each
     time (5, 10, 20, 40 seconds), instead of stopping the whole run.

How a script uses it:
    from musicbrainz_client import MusicBrainz
    mb = MusicBrainz()
    answer = mb.get("label", {"query": 'label:"Warp"', "limit": 5})
    # answer is a Python dictionary, or None if MusicBrainz kept failing
"""

import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "https://musicbrainz.org/ws/2/"

SECONDS_BETWEEN_CALLS = 1.1  # MusicBrainz allows about one request per second
MAX_TRIES = 5                # how many times to try one request before giving up
LONGEST_WAIT = 60            # never wait more than this many seconds between tries

# Answers that mean "busy or a temporary problem, try again in a moment".
# Any other error (for example 400, "bad request") won't get better by waiting.
TRY_AGAIN_CODES = {429, 500, 502, 503, 504}


class MusicBrainz:
    """
    One connection to MusicBrainz. A 'class' just bundles together the things
    that belong to that connection: the introduction (User-Agent) and a clock
    that remembers when we last asked, so we never ask too fast.
    """

    def __init__(self):
        load_dotenv(PROJECT_ROOT / ".env")
        contact = os.getenv("MB_CONTACT", "").strip()
        if not contact:
            sys.exit(
                "MB_CONTACT is missing. Copy .env.example to .env and add your "
                "email or GitHub link after MB_CONTACT="
            )

        self.session = requests.Session()
        self.session.headers["User-Agent"] = f"mili/0.1 ( {contact} )"
        self.session.headers["Accept"] = "application/json"
        self.last_call = 0.0

    def wait_for_turn(self):
        """Pause just long enough to keep to one request per second."""
        since_last = time.monotonic() - self.last_call
        if since_last < SECONDS_BETWEEN_CALLS:
            time.sleep(SECONDS_BETWEEN_CALLS - since_last)
        self.last_call = time.monotonic()

    def get(self, endpoint, params):
        """
        Ask MusicBrainz one question. 'endpoint' is the kind of thing we ask
        about, for example "label" or "release". Returns the answer as a
        dictionary, or None if it kept failing.
        """
        url = BASE_URL + endpoint
        params = {**params, "fmt": "json"}  # always ask for JSON

        for attempt in range(1, MAX_TRIES + 1):
            self.wait_for_turn()
            suggested_wait = ""
            try:
                response = self.session.get(url, params=params, timeout=60)
                if response.status_code == 200:
                    return response.json()
                problem = f"MusicBrainz answered {response.status_code}"
                if response.status_code not in TRY_AGAIN_CODES:
                    print(f"   {problem}, which waiting won't fix. Skipping this request.")
                    return None
                # Sometimes MusicBrainz says how long to wait, in 'Retry-After'.
                suggested_wait = response.headers.get("Retry-After", "")
            except requests.RequestException as error:
                problem = f"connection problem ({error.__class__.__name__})"

            if attempt == MAX_TRIES:
                print(f"   {problem}. Giving up on this one for now.")
                return None

            if suggested_wait.isdigit():
                wait = int(suggested_wait)
            else:
                wait = 5 * 2 ** (attempt - 1)
            wait = max(2, min(wait, LONGEST_WAIT))
            print(f"   {problem}, waiting {wait} seconds before try {attempt + 1}...")
            time.sleep(wait)
