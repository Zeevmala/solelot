# Launch readiness

Date: 2026-11-25. Source: six read-only audits (cartography/UX, web app, web platform, data pipeline, data quality, spatial data), merged by the orchestrator. Every item below was measured in an audit run; the numbers are from the data and code as of commit `eac0b0f`-era `master` (4,232 points).

## What "launch ready" means here

1. Search shows only what was searched for.
2. A pin is where its address says, or it is not on the map.
3. The page credits its data and map sources and the repository has a licence file.
4. A failed update cannot break a working offline copy.
5. One command (`bash .factory/check.sh`) says whether the above still holds.

## Findings that block launch

| # | Finding | Measured |
| --- | --- | --- |
| B1 | Picking a city shows other cities | חיפה: 138 own points, 532 shown; חדרה 42 → 303; לוד 11 → 1,172. Cause: the map filter allows 2 letter edits on any word. |
| B2 | Typed text leaves the map filtered by stale text | Type "חיפה": 2,402 points shown (the filter for "ח"). Enter does nothing. Clearing within 300 ms re-applies the old text. |
| B3 | Pins not at their address | 75 coordinates are shared by 183 points with different streets (geocoder fell back to a city centre). 12 more pins are 5–110 km from their address. "Nearest point" from central Tel Aviv, Jerusalem and Eilat returns such a pin. |
| B4 | One locality, several spellings | 16 localities (ירושלים 190 / ירשלים 8; נצרת עלית / נצרת עילית / נוף הגליל; …). Check 13 does not see them. |
| B5 | Dead records shown | "סניף נסגר", MAI's own "כפל" duplicates, a coordinate used as a name. |
| B6 | No credit to MAI on the page; README says MIT, no `LICENSE` file | — |

## Slices (tickets)

Each slice has an owner (see `docs/teams.md`), the files it may touch, and a check. Slices in different streams touch different files and may build at the same time; slices in one stream build in order. `sw.js` `STATIC_CACHE` is bumped once, at the end, by the orchestrator.

### Stream A: application (`app.js`, `index.html`, `test.html`, `test-map.html`), then `style.css`

- **A1 Search correctness** (web-app-lead). Substring match first; fuzzy match only when no point matches by substring, with tolerance scaled to query length (0 edits under 5 letters, 1 under 8, 2 from 8). Picking a city suggestion filters by `city === picked`. The map always reflects the text in the box: debounce always updates, clear/pick cancel the pending timer, Enter picks the first suggestion. Queries are normalised (Latin lower-case, ״→", ׳→', hyphen→space, קרית→קריית) with a short alias list (ת"א, תל אביב יפו, tel aviv, ראשל"צ, פ"ת, ב"ש, י-ם).
  Done when: picking חדרה shows exactly the חדרה points; typing "לוד" shows only points containing "לוד"; "ksp" equals "KSP"; "תל אביב יפו" offers תל אביב; in all four stale-text cases the marker count equals the matches for the visible text.
- **A2 `?action=nearest` runs after the data loads.** Done when: with mocked geolocation the toast starts "הנקודה הקרובה:".
- **A3 Failure states.** Success path restores the empty-state texts; legend hidden until data loads; if Leaflet did not load, show the error panel with a reload button instead of the endless skeleton.
- **A4 Load filter requires integer `id` and numeric `lat`/`lng`.** Done when: a string id with markup injects nothing.
- **A5 Credits and tiles.** Attribution shows the MAI credit next to OpenStreetMap. Tile layers set `crossOrigin: true` so the service worker can cache tiles. `twitter:card` becomes `summary` (the image is square).
- **A6 Phone polish** (carto-ux-lead, after A1–A5). Suggestion list spans the header width; toast fits (`max-content`, capped to the viewport); distances under 1 km in metres; sheet padding keeps the safe area; a `selected` state on the tapped pin, panned clear of the sheet; weights limited to 400/500/600 and no Hebrew in Plex Mono; disabled zoom button looks disabled; "נקודה אחת" for a count of one, "נקודות איסוף" as the one term.

### Stream B: data (`scraper.js`, `test-scraper.js`, `validate_data.js`, `data_overrides.json`)

- **B-1 Scraper hardening** (data-pipeline-lead). `כפל`, `נסגר` in the dead patterns; the city aliases from B4; strip `קיבוץ `/`מושב ` from city; address cleanup (house number 0, doubled number, city repeated); drop coordinate groups whose members have different streets, logging the ids; sort markers by id before building; warn on overrides that matched nothing; refuse to save under 90 % of the previous count without `--force`; strict coordinate parsing; decode HTML entities; atomic write; write `data_meta.json` (source, fetch time, counts). A small real raw fixture in `test-fixtures/` and tests for each rule.
- **B-2 Position checks** (spatial-data-lead). Replace check 14 with: 14a nearest same-city point > 5 km (regional councils exempt); 14b same coordinate, different streets; 14c lone city whose neighbours all share another city. Print every flag. Add a minimum-count check (fail under 1,000), numeric `lat`/`lng`, no markup in text fields, and a near-duplicate city spelling check with a list of known-distinct pairs. Confirm the 12 far pins against Nominatim and record them in `data_overrides.json` with the reason.
- **B-3 Refresh** (orchestrator). `node scraper.js` against the live API, then `node validate_data.js`; the data-quality-lead re-runs its profile on the result.

### Stream C: platform (`sw.js`, `manifest.json`, `.factory/`, `LICENSE`, `README.md`)

- **C1 Service worker update safety** (web-platform-lead). A failed precache rejects the install, so the old worker and cache stay. Leaflet files move to the critical list.
- **C2 Manifest.** Shortcut url `./?action=nearest`; icon purpose `any` (the icons have transparent margins).
- **C3 Gate.** `.factory/check.sh`: syntax check of every script, JSON validity, `node --test test-scraper.js`, `node validate_data.js`, the colour check, a site check (precache paths exist, no root-absolute paths, icon sizes match), the two browser test pages in headless Chrome, a check that the functions copied into the test pages equal the ones in `app.js`, and a cache-version check against the default branch.
- **C4 Repository.** `LICENSE` (MIT, as the README states); README corrected (check count, sample record, dead link, data credit); the three legacy scripts removed.

## Not in this design (owner decisions)

- Whether MAI's terms allow republishing its data. The page will credit MAI either way.
- 514 points (12 %) are schools and no record has opening hours. Say so in the popup, hide them, or leave them.
- About 200 points belong to chains that may have closed or rebranded (מגה 127, טויס אר אס 28).
- The like button records nothing. Keep, remove, or store.
- Desktop: a mouse click opens the sidebar, Enter opens the popup. Pick one.
- Serve Leaflet from the repository instead of unpkg.

## Blind spots

- A single fallback pin at a city centre cannot be told from a real point with this data. The stacked groups suggest there are more; a re-geocode would settle it.
- Position checks cannot see errors under 5 km.
- Map tiles on the real OpenStreetMap server were not seen in the audits (the audit sandbox blocked them).
