# From good to great

Date: 2026-11-26. Source: a second round of six read-only expert reviews (cartography/UX, interaction, platform, data pipeline, data quality, spatial data), run on the branch after `launch-readiness.md` was built. Every item was measured in a review run. The owner asked to take the map "from 80 to 100% ready for launch".

## Scores from the reviews

| Area | Now | With the top tickets |
| --- | --- | --- |
| Cartography and mobile UX | 78 | 93 |
| Interaction | 68 | 88 |
| Platform, performance, sharing | 82 | 94 |
| Data pipeline | 78 | 92 |
| Data as text on a phone | 78 | 92 |
| Position quality | 78 | 90 |

## What "great" means here

A person on a phone, outdoors, holding a bag of batteries, gets to the nearest real point and presses navigate in two taps and under 15 seconds. Then:

1. What they typed finds what they meant ("אבן גבירול תל אביב", "haifa", "אייס").
2. The pin is where the address is.
3. The link they send a friend opens the same point and shows a proper picture in WhatsApp.
4. A data refresh cannot change the map without saying what changed.

## What the reviews found

| # | Finding | Measured |
| --- | --- | --- |
| G1 | "Nearest" ends on a 4-second toast, not on the point | 3–4 taps to navigate; in Jerusalem and Mitzpe Ramon the nearest pin is inside a cluster; in Tel Aviv the user dot covers it |
| G2 | The locate button is an unlabelled 44 px icon in the top corner | third in a stack under +/− and layers |
| G3 | An address typed as "street city" finds nothing | 339 of 400 such queries return zero |
| G4 | "אייס" returns 1,120 points instead of 36 | the יי→י fold turns it into "איס", which is inside "איסוף" |
| G5 | Nothing can be shared or bookmarked; Back leaves the site | no `history` use in `app.js` |
| G6 | 14 pins are in another town or street than their address; 3 points are listed twice under two cities | each confirmed with Nominatim; 1.9–10 km off |
| G7 | City names hide towns | מודיעין עילית, ביתר עילית, באקה אל-גרבייה have points but no city entry; 11 wrong cities, 10 spelling variants |
| G8 | A refresh can move or swap hundreds of points and every check stays green | 200 points moved 500 m: `ALL CHECKS PASSED` |
| G9 | The WhatsApp preview is a small square icon with black corners; home-screen icons are not maskable | no 1200×630 image in the repository |
| G10 | A returning visitor gets a new version one visit late | the new worker precaches through the browser's HTTP cache |

## Slices

Three streams. Data builds in its own working copy at the same time as the application (no shared files). Platform builds after the application, because both touch `index.html`, `app.js` and `sw.js`. `STATIC_CACHE` is bumped once per merge by the orchestrator.

### Stream D: data (`scraper.js`, `validate_data.js`, their tests, `data_overrides.json`)

- **D1 Refresh safety.** The scraper prints and saves what changed (added, removed, moved over 100 m, renamed, city changed) and refuses to save, without `--force`, when removed + moved is over 5 % or when over 10 % of the overrides match nothing.
- **D2 No dependence on the previous file.** 25 city overrides replace the coordinate cache; the same raw input gives the same output with or without an old `locations.json`.
- **D3 Schools.** Three false drops come back (a fuel station "near the school", "opposite the school", a street named חטיבת); three schools still shown go.
- **D4 City names.** 11 overrides, 10 aliases, a trailing-bracket rule, and two validator checks (malformed city fails; "X / כפר X" pairs warn).
- **D5 Wrong pins.** 17 excludes; warning 14d (one street in one city, points over 1.5 km apart); a reviewed-and-fine list so that a warning means "new".
- **D6 One shop listed twice.** Same chain, 50 m or less, same street: keep the lower id. Different house numbers are never merged.
- **D7 Names and addresses.** Repeated segments, "בע"מ", Arabic-script and parcel-number leftovers, the city twice, the "רחוב" prefix.

### Stream A: application (`app.js`, `style.css`, `index.html` body, test pages, `test-smoke.js`)

- **A1 The selected point is drawn on its own layer** above the clusters. `zoomToShowLayer` and its workaround go (the weak spot recorded in DECISIONS on 2026-11-25).
- **A2 Nearest ends on the point.** One tap on locate opens the sheet of the nearest point with the navigate buttons, the pin selected and above the sheet. The user dot cannot be tapped. A second tap re-centres.
- **A3 Search.** Words in any order across name, address and city; a doubled י/ו in the typed text is not folded into a shorter word; near-spelling city rows only when no city contains the text; English names for the large cities; the suggestion row shows the address.
- **A4 A point and a city have a URL** (`?id=`, `?city=`); Back closes the sheet; a reload keeps the place.
- **A5 Location failures** lead to the search box; no flight to an empty map when nothing is within 30 km.
- **A6 One details surface.** Click, Enter and a suggestion pick all open the sidebar/sheet; the pin popup goes.
- **A7 The locate button** is a labelled pill, "הנקודה הקרובה אליי", bottom right; +/− are hidden on touch phones.
- **A8 The sheet.** Name, then distance ("בקו אווירי") and address on one line, then filled navigate buttons, then two labelled feedback buttons ("הנקודה קיימת", "דיווח על בעיה").
- **A9 Pins.** Cluster radius 70 / 55 / 48 / 20 px (zoom ≤ 9 / ≤ 13 / ≤ 15 / 16+), larger hit areas, selected pin 1.4×.
- **A10 Text and icons.** No emoji; neutral Hebrew; the placeholder says what can be typed; four small defects (text under the clear button, a unit that wraps away from its number, the Leaflet prefix, the clipped user popup).
- **A11 Basemap.** `saturate(0.3)` instead of full greyscale, so the sea reads as sea.
- **A12 "עודכן <date>"** in the attribution, from `data_meta.json`.

### Stream P: platform (`index.html` head, `manifest.json`, `sw.js`, `icons/`, `README.md`)

- **P1** A 1200×630 share image and a title that says what the page is.
- **P2** A maskable icon, an opaque Apple touch icon, the SVG favicon.
- **P3** The new worker fetches with `cache: 'reload'`; a page nobody has touched yet reloads itself when the new worker takes over.
- **P4** README opens with a screenshot; the test pages are `noindex`; CSP `img-src` narrowed, `base-uri` and `form-action` added.

## Not in this design (owner decisions)

- ~~Show "also takes small / large electrical items"~~ Decided 2026-11-26: no. The map is strictly for batteries.
- ~~A point kind as a label or filter~~ Decided 2026-11-27: one line in the sheet, no filter. `kind` replaces `chain`.
- Drop the unused `hours` and `chain` fields. Changes the data format.
- A weekly scheduled refresh on GitHub. Needs a workflow file added by a person.
- ~~Points inside an air force base, police headquarters and a pre-army academy~~ Decided 2026-11-27: left out, like schools.
- ~~A message for chains that are not in MAI's list~~ Decided 2026-11-27: say so plainly.
- ~~Which navigate button is the main one~~ Decided 2026-11-27: both equal, both filled.

## Blind spots

- 1,965 of 3,627 points have no other point on their street in their city; warning 14d cannot see them.
- The accuracy sample (33 matched addresses) says about 1 in 30 numbered addresses is kilometres off; it says nothing about points with no house number or about villages.
- The phone keyboard over the suggestion list and iOS safe areas were not seen (headless Chromium).
- The WhatsApp preview can be checked only after deploy.
