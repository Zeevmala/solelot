# Battery Recycling Map - Specification

## Requirements
- Display interactive map of Israel
- Show battery recycling locations with markers
- Click markers to see location details (name, address, hours)
- Mobile-friendly design
- Hebrew language support (RTL)

## Tech Stack
- **HTML** - Page structure
- **CSS** - Styling and responsive layout
- **JavaScript** - Interactivity and map logic
- **Leaflet.js** - Open-source map library (free, no API key needed)
- **CartoDB** - Light basemap tiles (default), with streets option

## Milestones

### M1: Basic Map with Dummy Data ✅
- [x] Set up project files (index.html, style.css, app.js)
- [x] Display map centered on Israel
- [x] Add 3-5 test markers with popups
- [x] Basic styling

### M2: Real Location Data ✅
- [x] Create locations data file (JSON)
- [x] Add all store locations (Superpharm, Shufersal, etc.)
- [x] Add recycling facilities (Batte-Re, RE-CAR, MILI)
- [x] Different marker icons by location type
- [x] Location details in popups

### M3: Search & Filters ✅
- [x] Filter by location type (stores vs facilities)
- [x] Search by city/area
- [x] "Find nearest" using user location
- [x] Mobile-responsive controls

### M4: UX & Polish ✅
- [x] Location detail sidebar
- [x] Redesigned popup cards
- [x] Navigation links (Google Maps / Waze) in popups and sidebar
- [x] Empty state with clear/retry when search has no results
- [x] Loading spinner overlay with error retry

### M5: PWA & Performance ✅
- [x] Service worker for offline support
- [x] PWA manifest (installable)
- [x] Marker clustering for ~3,900 locations
- [x] Multiple basemap options (light, streets)

### M6: Accessibility & Security ✅
- [x] ARIA labels and keyboard navigation
- [x] Skip links
- [x] XSS protection (HTML escaping on all location data)
- [x] Open Graph + Twitter Card meta tags

### M7: Testing ✅
- [x] Unit tests (pure functions) in `test.html`
- [x] Integration tests (map/UI) in `test-map.html`
- [x] 60 passing tests total

### M8: Report a Problem ✅
- [x] Google Form integration
- [x] Auto-filled location name in form
- [x] Report links in popups and sidebar
