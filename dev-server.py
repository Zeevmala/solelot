"""Local dev server for the app: serves this folder with caching turned off.

Usage:  python dev-server.py [port]     (default port 8000)

Why not plain `python -m http.server`?
- It lets the browser cache files, so after an edit you can keep getting the
  old version (the service worker makes this worse).
- On Windows it guesses MIME types from the registry, which can serve `.js`
  as `text/plain` -- and browsers refuse to register `sw.js` with that type.

Binds to 127.0.0.1 only. To open it on a phone, use dev-https.ps1 (HTTPS tunnel).
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print(f'Serving {root} at http://localhost:{port}  (Ctrl+C to stop)', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
