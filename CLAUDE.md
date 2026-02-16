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
- [ ] Add `aria-label` to Leaflet marker/cluster divs (e.g. location name) — framework generates `role="button"` divs without accessible names
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
