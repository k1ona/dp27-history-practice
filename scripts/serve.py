#!/usr/bin/env python3
"""Serve site/ locally for testing (http://127.0.0.1:PORT/).

Avoids http.server's reverse-DNS lookup at start-up, which can hang on some networks.
Usage: python scripts/serve.py [PORT]
"""
import functools
import http.server
import socketserver
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".js": "text/javascript", ".json": "application/json"}

    def log_message(self, *args):
        pass

    def end_headers(self):
        if self.path.split("?")[0].endswith(("sw.js", "precache-manifest.json")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True
    # The page loads about 20 JavaScript modules at once. With the default listen queue of 5, the operating system
    # resets some of those connections when the server is busy, one module fails, and the app never starts.
    request_queue_size = 128


def make_server(port: int) -> Server:
    return Server(("127.0.0.1", port), functools.partial(Handler, directory=str(SITE)))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    with make_server(port) as httpd:
        print(f"Serving {SITE} at http://127.0.0.1:{port}/", flush=True)
        httpd.serve_forever()
