#!/usr/bin/env python3
"""
Static file server for local development.

`python3 -m http.server` works, but it lets the browser cache ES modules, which
means an edit to one module can silently fail to reload. This sends no-store on
everything so a refresh always picks up the current files.

    python3 serve.py [port]

Then open http://localhost:8123 — or /tests/ for the test suite.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quieter: only report anything that isn't a plain 200.
        if args and str(args[1]) != "200":
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    handler = partial(NoCacheHandler, directory="public")
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Graphia running at http://localhost:{port}")
        print(f"Tests at         http://localhost:{port}/tests/")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
