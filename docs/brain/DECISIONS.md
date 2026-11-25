# Decisions

Decisions for this project, and why. Append; never edit an entry. To reverse one, add a new entry that names the one it replaces. Decisions that apply to every project live in the factory's `brain/DECISIONS.md`.

Format: `YYYY-MM-DD — decision. Why. (replaces YYYY-MM-DD, if it does)`

- 2026-11-25 — No build tools: plain HTML, CSS and JavaScript, no npm, no bundler. The site is one static page and its owner is learning to code; every extra tool is something to break. (recorded from `CLAUDE.md`)
- 2026-11-25 — No recycling facilities on the map. Batte-Re and RE-CAR were added and then removed at the owner's request; `facilities.json` stays empty and the app keeps support for the type. (recorded from `CLAUDE.md`)
- 2026-11-25 — `locations.json` is written only by `scraper.js`. Single-record fixes go in `data_overrides.json`. An earlier hand rebuild undid the name cleanup. (recorded from `CLAUDE.md`)
- 2026-11-25 — Colours come from `cartowolf/tokens.css`, which is copied from the factory's `design/` and never edited here. One source for every project's look. (recorded from `CLAUDE.md`)
- 2026-11-25 — The page is fixed to the light theme. The OpenStreetMap basemap is a light picture and the dark pin colours are made for a dark map. (recorded from `CLAUDE.md`)
- 2026-11-25 — The project is connected to the factory layout: `.factory/` gate, `docs/designs/`, `docs/brain/`. The gate uses Node's built-in test runner and the existing check scripts, so "no npm" still holds.
- 2026-11-25 — Work is organised as six team leads and one orchestrator, described in `docs/teams.md`. Leads audit in parallel and read-only; builds run one at a time; a fresh agent reviews. Parallel builds in one working tree race on `app.js`, `sw.js` and the cache version.
- 2026-11-25 — Points that share one exact coordinate but name different streets are removed by the scraper (162 points at this date). The source's geocoder puts unfound addresses at the city centre, and nobody can tell which of the stacked points is right; a missing point costs less than sending someone to the wrong place. Same street in two spellings, and a no-street group inside one village, are kept.
- 2026-11-25 — The map filter matches by substring first and falls back to near-spelling only when nothing matches, with the allowed difference scaled to the length of the text. Two letter edits on a four-letter city name matched hundreds of other places.
- 2026-11-25 — A failed service worker update must not install. The old worker and cache stay until every file of the new one is fetched; Leaflet is on the must-have list. Cost: a first visit while unpkg is down gets no offline copy until the next visit.
- 2026-11-25 — The page credits MAI as the data source in the map attribution, and the README says the data is not covered by the MIT licence. Whether MAI's terms allow republishing is not known from the repository and is the owner's question to settle.
