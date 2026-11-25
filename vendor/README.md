# vendor

Third-party files served from this repository, so the page does not depend on a CDN. Copied unchanged; do not edit.

| Folder | Package | Version | From |
| --- | --- | --- | --- |
| `leaflet/` | Leaflet (BSD-2-Clause, see `leaflet/LICENSE`) | 1.9.4 | `https://unpkg.com/leaflet@1.9.4/dist/` |
| `markercluster/` | Leaflet.markercluster (MIT, see `markercluster/MIT-LICENCE.txt`) | 1.5.3 | `https://unpkg.com/leaflet.markercluster@1.5.3/dist/` |

To update: download the same files of the new version into the same folders, bump `STATIC_CACHE` in `sw.js`, then run `bash .factory/check.sh` and `node test-smoke.js`.
