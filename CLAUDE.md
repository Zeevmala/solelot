# Battery Recycling Map - Israel

## About Me
Learning to code - explain simply, break down steps

## Project
Interactive map for battery recycling locations in Israel

## Tech Stack
HTML, CSS, JavaScript + Leaflet.js for maps

## Locations to Include
- **Stores**: Superpharm, Shufersal, Office Depot, Home Center, Pelephone, Cellcom
- **Facilities**: Batte-Re (Dimona), RE-CAR (Arad), MILI

## Current Features
- Interactive Leaflet map centered on Israel (CartoDB Light default basemap)
- Custom SVG battery pin markers (green, uniform for all locations)
- Marker clustering for performance
- Search with autocomplete suggestions (city + location)
- GPS geolocation ("find my location" button, shows distance in popups)
- Navigation links (Google Maps / Waze) in popups and sidebar
- Location detail sidebar
- "Report a problem" link in popups/sidebar (Google Form)
- Empty state with clear/retry when search has no results
- PWA support (installable, offline via service worker)
- Multiple basemap options (light, streets)
- Accessibility (ARIA labels, keyboard navigation, skip links)
- Open Graph + Twitter Card meta tags for social sharing
- XSS protection (HTML escaping on all location data)
- Loading spinner overlay with error retry

## Nice to Have
- [x] Add `aria-label` to Leaflet marker/cluster divs (e.g. location name) — framework generates `role="button"` divs without accessible names
- [ ] Replace "רחובות" streets basemap with HERE Maps tiles — requires free API key from https://platform.here.com/sign-up (URL: `https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?style=explore.day&apiKey=KEY`)
- [ ] Add testing hooks (setup/teardown/beforeEach/afterEach) — only needed when implementing Phase 2 (Vitest) or testing async functions/Leaflet operations; current HTML tests don't require them since pure functions have no side effects

## File Structure
| File | Purpose |
|------|---------|
| `index.html` | Page structure (Hebrew, RTL) |
| `style.css` | All styling and responsive layout |
| `app.js` | Map logic, search, filters, markers, sidebar, etc. |
| `locations.json` | All recycling locations (name, address, city, lat/lng, type) |
| `scraper.js` | Script for collecting/updating location data |
| `sw.js` | Service worker for offline/PWA support |
| `manifest.json` | PWA manifest |
| `test.html` | Unit tests (pure function tests, runs in browser) |
| `test-map.html` | Integration tests (map/UI tests, runs in browser) |
| `CLAUDE.md` | Project instructions for Claude Code |
| `README.md` | Project documentation |
| `spec.md` | Project specification |
| `favicon.ico` | Browser tab icon |
| `.gitignore` | Git ignore rules |
| `icons/` | App icons in various sizes |

## Conventions
- UI text is in **Hebrew**
- Layout is **RTL** (right-to-left)
- No build tools - plain static files, no npm
- Location types: `store` (collection point) or `facility` (recycling plant)
- Data stored in `locations.json` under `{ "locations": [...] }`

## Architectural Insights & Known Issues

### Architecture — Do NOT Change
- No build tools. Plain HTML/CSS/JS. No npm, no bundler, no TypeScript. Keep it that way.
- `locations.json` schema: `{ "locations": [{ id, name, address, city, type, chain, lat, lng, hours }] }`.
- `type` must be exactly `"store"` or `"facility"`. Adding a third value requires updating `typeNames` in `app.js` AND adding a test.
- All UI strings are Hebrew. Layout is RTL. Do not add English UI text.
- `test.html` runs in-browser (open the file). Pure functions are copied verbatim from `app.js` — keep test copies in sync.
- **Bump `STATIC_CACHE` version in `sw.js` on every deploy** or returning users get stale assets.

### Known Bugs (Fix These)

**DEFERRED — Facility data**
`locations.json` has 0 entries with `"type": "facility"`. Spec lists Batte-Re (Dimona), RE-CAR (Arad), MILI.
Intentionally deferred — not a bug. When ready, add manually (MAI scraper API does not return them).

**~~HIGH — No `response.ok` check before JSON parse (`app.js` ~line 915)~~ FIXED**

**~~HIGH — Silent (0,0) coordinate fallback (`scraper.js` line 146)~~ FIXED**

**~~HIGH — Scraper has no HTTP status check, no timeout, no JSON try/catch (`scraper.js` lines 19–34)~~ FIXED**

**~~MEDIUM — `autocompleteInitialized` guard not reset on retry (`app.js` ~line 970)~~ FIXED**

**MEDIUM — Touch listeners never removed from sidebar (`app.js` lines 1016–1055)**
`touchstart/touchmove/touchend` accumulate on repeated calls. Use named functions
+ `removeEventListener`, or an `AbortController` signal.

**MEDIUM — `?action=nearest` PWA shortcut unimplemented (`manifest.json`)**
Add at `app.js` startup:
```js
if (new URLSearchParams(location.search).get('action') === 'nearest') { /* trigger geo */ }
```

**MEDIUM — `limitCacheSize()` not awaited in QuotaExceededError handler (`sw.js` ~line 132)**
Cache eviction is fire-and-forget; next write still hits quota. Restructure as `async/await`.

**LOW — `typeNames[location.type]` can be `undefined` (`app.js` ~line 961)**
Use `typeNames[location.type] || location.type` to guard aria-label.

**LOW — Inner fade-out timer not cancelled in `showNotification()` (`app.js` line 18)**
Rapid calls leave orphaned 300ms timers. Add a second `notificationDisplayTimeout` ref and
`clearTimeout` it at the top of `showNotification()`.

**LOW — No `showLoading()` on retry (`app.js` ~line 1067)**
Call `showLoading()` inside the retry click handler before `loadLocations()`.

### Anti-Patterns — Avoid
- Do NOT use `parseFloat(x) || 0` for coordinates. Zero looks valid but is wrong.
- Do NOT call `response.json()` without first checking `response.ok`.
- Do NOT add event listeners inside functions callable multiple times without a cleanup path.
- Do NOT add new `location.type` values without updating `typeNames` in `app.js` and tests.
- Do NOT forget to bump `STATIC_CACHE` version in `sw.js` after changing any cached file.

### Testing Notes
- `detectChain` is tested for only 5 of 13+ chains. Missing: Office Depot, Home Center,
  Pelephone, Cellcom, IKEA, Rami Levy, municipality, RE-CAR, Batte-Re, MILI.
- XSS tests only cover `<script>` and `<img>`. Missing: SVG onclick, `javascript:` URLs, `data:` URIs.
- No integration tests for: map init, search logic, GPS, sidebar state, `?action=nearest`.

### Data Integrity Notes
- `scraper.js` is a one-shot collector, not a live sync. Run it to refresh, then manually review output.
- After scraping: **filter out any entry with `lat === 0 || lng === 0`** before saving.
- Runtime bounds check (29–34°N, 34–36°E) in `app.js` is a safety net, not a substitute for clean source data.
- 66% of locations are `chain: "other"` — expected from MAI API data quality, not a bug.

### Spec Drift
- M2 (facility locations): **DEFERRED** — 0 facility entries in `locations.json` (intentional).
- M5 PWA shortcut (`?action=nearest`): **NOT MET** — manifest defines it, `app.js` ignores it.
- M1–M8 all other requirements: fully implemented and tested.
