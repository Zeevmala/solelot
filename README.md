# 🔋 Solelot - מפת מיחזור סוללות בישראל

[![Live Site](https://img.shields.io/badge/Live%20Site-zeevmala.github.io%2Fsolelot-00796B?style=flat-square)](https://zeevmala.github.io/solelot/)
[![Tests](https://img.shields.io/badge/Tests-passing-brightgreen?style=flat-square)](test.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

> **Find battery recycling points near you in Israel**

An interactive map showing **~4,200 battery recycling locations** across Israel — public collection points (shops, gas stations, municipal bins) plus the country's battery recycling plants.

🌐 **[Live Site → zeevmala.github.io/solelot](https://zeevmala.github.io/solelot/)**

---

## Features

- **Interactive Map** — Browse all recycling points on a Leaflet.js map with marker clustering
- **Search** — Find locations by name, address, or city with autocomplete suggestions
- **Navigation** — Get directions via Google Maps or Waze directly from any point
- **Location Details** — View address, hours, and distance from your position
- **Legend & Type Filter** — Collection points and recycling facilities use different pin shapes and colours; tap a legend row to show/hide a type
- **Nearest Point** — The locate button frames you together with the closest collection point
- **Multiple Basemaps** — Switch between street and light map styles
- **PWA** — Install as an app on your phone, works offline
- **Accessible** — Keyboard navigation, ARIA labels, screen reader support
- **Mobile Friendly** — Responsive design with bottom drawer sidebar on small screens

## Tech Stack

| | |
|---|---|
| **Frontend** | HTML, CSS, JavaScript (no frameworks) |
| **Maps** | [Leaflet.js](https://leafletjs.com/) + [MarkerCluster](https://github.com/Leaflet/Leaflet.markercluster) |
| **Tiles** | [OpenStreetMap](https://www.openstreetmap.org/) standard tiles (light = CSS-desaturated) |
| **Hosting** | GitHub Pages |
| **PWA** | Service Worker + Web App Manifest |

## Project Structure

```
├── index.html        # Page structure (Hebrew, RTL)
├── style.css         # Styling and responsive layout
├── app.js            # Map logic, search, markers, sidebar
├── locations.json    # ~4,200 locations (generated — do not edit by hand)
├── facilities.json   # Recycling plants (hand-curated, merged in by scraper.js)
├── data_overrides.json # Manual fixes to MAI data (wrong city / wrong coordinates)
├── sw.js             # Service worker for offline/PWA
├── manifest.json     # PWA manifest
├── scraper.js        # Builds locations.json from the MAI API + the two files above
├── validate_data.js  # Data quality checks (run after every data change)
├── test-scraper.js   # Scraper tests (node --test test-scraper.js)
└── icons/            # App icons (72px → 512px)
```

## Run Locally

No build tools needed — just open the files:

```bash
# Clone the repo
git clone https://github.com/Zeevmala/solelot.git
cd solelot

# Serve with any static server
npx serve .
# or
python -m http.server 8000
```

Then open `http://localhost:8000` (or whatever port your server uses).

## Testing

This project includes comprehensive **HTML-based tests** that run directly in the browser (no build tools needed).

### Running Tests Locally

1. **Unit Tests** — Pure functions and data validation
   - Open [`test.html`](test.html) in your browser
   - Shows **35 unit tests** covering:
     - `escapeHtml` (9 tests) — XSS protection, null handling, type coercion
     - `fuzzyMatch` (12 tests) — Fuzzy matching with Levenshtein distance
     - `getDistance` (3 tests) — Haversine formula accuracy
     - XSS edge cases (5 tests) — SVG, img, data URI escaping
     - `hoursFilter` (5 tests) — Filtering placeholder hours text
   - **Result:** All 35 passing

2. **Integration Tests** — Data integrity and template rendering
   - Open [`test-map.html`](test-map.html) in your browser
   - Shows **~60 integration tests** covering:
     - Data integrity (7 tests) — Validates all ~4,200 locations in `locations.json`
     - IDs and facilities (8 tests) — Unique ids, facilities present, one spelling per city
     - Popup template (12 tests) — Button styling, XSS protection, hours filtering
     - Sidebar template (6 tests) — Layout, navigation buttons, hours filtering
     - XSS protection (3 tests) — Script/image tag escaping
     - Navigation URLs (3 tests) — Google Maps and Waze format
     - Search filtering (8 tests) — City, name, fuzzy, empty query
     - Sidebar state machine (6 tests) — Show/hide/replace behavior
     - GPS distance (6 tests) — Distance integration in popup
     - Empty state logic (6 tests) — Show/hide empty state
     - PWA shortcut (6 tests) — `?action=nearest` handling
   - **Result:** All passing

3. **Data pipeline tests** — run in a terminal (Node 18+, nothing to install)
   ```bash
   node --test test-scraper.js   # 11 tests of the real scraper functions
   node validate_data.js         # 13 data-quality checks on locations.json
   ```

**Current Status:** All tests passing. Note the browser tests check *copies* of the `app.js` functions, so they must be kept in sync by hand.

### Why HTML-Based Tests?

- ✅ Tests run in a **real browser** (not a headless simulator)
- ✅ Can test **DOM manipulation, Leaflet.js, Service Worker APIs** that JSDOM can't handle
- ✅ **Zero build tools** — aligns with the no-npm philosophy
- ✅ **Fast feedback loop** — just refresh the page to re-run tests
- ✅ **Comprehensive coverage** — all pure functions and data flows tested

### Future: Vitest + CI/CD

When you're ready to add **automated CI/CD testing**, see the implementation plan in [`.claude/plans/lucky-knitting-tide.md`](.claude/plans/lucky-knitting-tide.md) for a hybrid strategy that keeps HTML tests and adds Vitest for GitHub Actions.

## Data

Location data is stored in `locations.json` with this structure:

```json
{
  "locations": [
    {
      "id": 1,
      "name": "סופר פארם - דיזנגוף סנטר",
      "address": "דיזנגוף 50, תל אביב",
      "city": "תל אביב",
      "lat": 32.0753,
      "lng": 34.7748,
      "type": "store",
      "hours": "08:00-22:00",
      "description": ""
    }
  ]
}
```

### Refreshing the data

```bash
node scraper.js        # fetch MAI, apply data_overrides.json, merge facilities.json
node validate_data.js  # must end with ALL CHECKS PASSED
```

- **Collection points** come from the [MAI](https://mai.org.il) map API (live map `5`, category `12` = batteries). Unnamed markers, markers MAI flags as inactive, and repeats are dropped.
- **Facilities** (`facilities.json`) are added by hand. Their pins mark the industrial zone, not the plant gate, and they are not public drop-off points.
- **`data_overrides.json`** holds per-id corrections for MAI records whose city or coordinates are wrong. Check 14 in `validate_data.js` lists new suspects after each refresh.

## License

MIT
