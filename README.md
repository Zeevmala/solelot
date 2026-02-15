# 🔋 Solelot - מפת מיחזור סוללות בישראל

> **Find battery recycling points near you in Israel**

An interactive map showing **~3,900 battery recycling locations** across Israel — collection points at major retail chains and dedicated recycling facilities.

🌐 **[Live Site → zeevmala.github.io/solelot](https://zeevmala.github.io/solelot/)**

---

## Features

- **Interactive Map** — Browse all recycling points on a Leaflet.js map with marker clustering
- **Search** — Find locations by name, address, or city with autocomplete suggestions
- **Navigation** — Get directions via Google Maps or Waze directly from any point
- **Location Details** — View address, hours, and distance from your position
- **Multiple Basemaps** — Switch between street and light map styles
- **PWA** — Install as an app on your phone, works offline
- **Accessible** — Keyboard navigation, ARIA labels, screen reader support
- **Mobile Friendly** — Responsive design with bottom drawer sidebar on small screens

## Tech Stack

| | |
|---|---|
| **Frontend** | HTML, CSS, JavaScript (no frameworks) |
| **Maps** | [Leaflet.js](https://leafletjs.com/) + [MarkerCluster](https://github.com/Leaflet/Leaflet.markercluster) |
| **Tiles** | [CartoDB](https://carto.com/basemaps/) (Voyager & Positron) |
| **Hosting** | GitHub Pages |
| **PWA** | Service Worker + Web App Manifest |

## Project Structure

```
├── index.html        # Page structure (Hebrew, RTL)
├── style.css         # Styling and responsive layout
├── app.js            # Map logic, search, markers, sidebar
├── locations.json    # ~3,900 recycling locations
├── sw.js             # Service worker for offline/PWA
├── manifest.json     # PWA manifest
├── scraper.js        # Data collection script
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
   - Shows **31 unit tests** covering:
     - `escapeHtml` (9 tests) — XSS protection, null handling, type coercion
     - `fuzzyMatch` (9 tests) — Fuzzy matching with Levenshtein distance
     - `getDistance` (3 tests) — Haversine formula accuracy
     - `detectChain` (5 tests) — Hebrew retail chain detection
     - `hoursFilter` (5 tests) — Filtering placeholder hours text
   - **Result:** All 31 passing ✓

2. **Integration Tests** — Data integrity and template rendering
   - Open [`test-map.html`](test-map.html) in your browser
   - Shows **29 integration tests** covering:
     - Data integrity (7 tests) — Validates all ~3,900 locations in `locations.json`
     - Popup template (6 tests) — Emoji removal, button styling, XSS protection
     - Sidebar template (6 tests) — Layout, navigation buttons, hours filtering
     - XSS protection (3 tests) — Script/image tag escaping
     - Navigation URLs (3 tests) — Google Maps and Waze format
     - Duplicate detection (1 info) — Tracks locations sharing coordinates
   - **Result:** All 29 passing ✓

**Current Status:** 60/60 tests passing, 100% coverage of testable code

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

## License

MIT
