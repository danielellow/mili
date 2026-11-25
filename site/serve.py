"""Show the mili site on your own computer.

    python site/serve.py          then open http://localhost:8000
    python site/serve.py 8001     the same, on another port

Like `python -m http.server`, but it tells the browser not to keep old copies
of the files, so after an update a normal reload shows the new version.
Stop it with Control+C.
"""

import functools
import http.server
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent


class NoOldCopies(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the Terminal quiet


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoOldCopies, directory=str(SITE))
    try:
        server = http.server.ThreadingHTTPServer(("localhost", port), handler)
    except OSError:
        sys.exit(f"Port {port} is already in use: another server is probably still running.\n"
                 f"Stop it with Control+C in its Terminal window, or use another port: python site/serve.py {port + 1}")
    print(f"mili is at http://localhost:{port}   (stop with Control+C)")
    with server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
