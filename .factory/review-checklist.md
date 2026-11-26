# Review checklist (static Leaflet map, Hebrew, RTL)

A violation of any item is a blocking finding.

- Coordinates: Leaflet takes `[lat, lng]`; GeoJSON and most other APIs take `[lng, lat]`. Any conversion happens at a named boundary, never inline.
- Distances are computed geodesically (`getDistance`, haversine), never by subtracting or averaging raw degrees.
- No `parseFloat(x) || 0` for coordinates. A missing or bad coordinate drops the record; it never becomes 0.
- Location data placed in an HTML string goes through `escapeHtml()`. Text given to `setAttribute()` or `textContent` is plain text and is never passed through `escapeHtml()`.
- No inline `onclick` in template strings. Use `data-*` attributes and event delegation.
- `response.ok` is checked before `response.json()`.
- Colours come only from `cartowolf/tokens.css` (`var(--cw-...)`). No hex or rgb colour in `style.css`, `app.js` or `index.html`, and no edit to `cartowolf/tokens.css` in this repo.
- UI text is Hebrew and renders correctly right-to-left. No English UI text.
- `locations.json` is never edited by hand. Data fixes go in `data_overrides.json`, facilities in `facilities.json`, rules in `scraper.js`.
- `STATIC_CACHE` in `sw.js` is bumped when a file the service worker caches changed, and every path in its precache list exists and works under `/solelot/`.
- No new dependency and no build tool: no `package.json`, no npm, no bundler, no TypeScript.
- A function copied into `test.html` or `test-map.html` is identical to the one in `app.js`.
