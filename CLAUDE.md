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
- Interactive Leaflet map centered on Israel
- Custom SVG battery pin markers (green = collection points, red = facilities)
- Marker clustering for performance
- Search with autocomplete suggestions
- "Find nearest" via GPS geolocation
- Navigation links (Google Maps / Waze) in popups
- Location detail sidebar
- PWA support (installable, offline via service worker)
- Multiple basemap options (streets, light, satellite)
- Accessibility (ARIA labels, keyboard navigation, skip links)
- Loading spinner overlay

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
| `icons/` | App icons in various sizes |

## Conventions
- UI text is in **Hebrew**
- Layout is **RTL** (right-to-left)
- No build tools - plain static files, no npm
- Location types: `store` (collection point) or `facility` (recycling plant)
- Data stored in `locations.json` under `{ "locations": [...] }`
