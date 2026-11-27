/**
 * Data quality validation for locations.json
 *
 * Run after ANY data change to catch issues before they reach users.
 * Usage: node validate_data.js [path]
 *   path: another file to check instead of locations.json. test-validate.js uses it to run
 *         every check on generated fixtures (node --test test-validate.js)
 *
 * Exit code: 0 = all pass, 1 = failures found
 */

const fs = require('fs');
const path = require('path');
// Shared with the scraper so the two cannot disagree on what "inactive" or "same street" means.
// Requiring scraper.js runs nothing: it only calls its main() when executed directly.
const {
    isMarkedInactive, isSchool, streetKey, sameStreet, shopChain,
    withoutRepeatedParts, withoutBoilerplate, ARABIC_SCRIPT, PARCEL_NUMBER
} = require('./scraper.js');

const INPUT_FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'locations.json');

// Check 21: city names one letter apart that really are different places.
// A pair that is one place spelled two ways must NOT be added here - fix it in scraper.js (CITY_ALIASES).
const KNOWN_DISTINCT_CITIES = [
    ['אורה', 'אושה'], ['אורנית', 'קורנית'], ['אילון', 'אילות'], ['אילון', 'אלון'], ['אילות', 'אילת'],
    ['אילת', 'גילת'], ['אילת', 'שילת'], ['אלונים', 'אמונים'], ['אליקים', 'אפיקים'], ['אלעד', 'גלעד'],
    ['אשחר', 'שחר'], ['ברורים', 'דרורים'], ['גדרה', 'חדרה'], ['גורן', 'צורן'], ['גיאה', 'גיתה'],
    ['גילת', 'שילת'], ['גנות', 'גרנות'], ['גנות', 'כנות'], ['גנות', 'מנות'], ['חגור', 'יגור'],
    ['חופית', 'נופית'], ['חורשים', 'חרשים'], ['חצב', 'חצבה'], ['חרות', 'שחרות'], ['טירה', 'טמרה'],
    ['כנות', 'מנות'], ['כפר כמא', 'כפר כנא'], ['מגדל', 'מגל'], ['מירון', 'עירון'], ['משמרת', 'שמרת'],
    ['נגבה', 'רגבה'], ['עומר', 'עופר'], ['עופר', 'עופרה'], ['עופר', 'צופר'], ['צופים', 'צוקים'],
    ['קדימה', 'קדמה'], ['שדרות', 'שחרות'], ['שומרה', 'שומריה'], ['שלומי', 'שלומית'],
    ['אורות', 'דורות'], ['גונן', 'גורן'], ['חגור', 'חצור'], ['חולית', 'חופית'], ['כרמיה', 'כרמים'], ['שפיים', 'שפירים']
];

// Check 24: one city name is another plus a word, and the two really are different places.
// A pair that is one place under two names must NOT be added here - fix it in scraper.js (CITY_ALIASES)
// or, for a single record, in data_overrides.json.
const KNOWN_DISTINCT_CITY_PAIRS = [
    ['אורה', 'באר אורה'], ['גנות', 'גנות הדר'], ['גשר', 'גשר הזיו'], ['גת', 'קריית גת'], ["ג'וליס", "כפר ג'וליס"],
    ['זוהר', 'נווה זוהר'], ['חצבה', 'עין חצבה'], ['חצור', 'חצור הגלילית'], ['חרות', 'בית חרות'],
    ['יבנה', 'גן יבנה'], ['יבנה', 'קבוצת יבנה'], ['מגדל', 'מגדל העמק'], ['מודיעין', 'מודיעין עילית'],
    ['ניצן', 'שדה ניצן'], ['פקיעין', 'פקיעין החדשה'], ['שחר', 'טל שחר'], ['שריד', 'עין שריד']
];

// Position warnings (14a-14d) that a person has already looked at, per check, with the date and what was
// found. A listed id is left out of that one check's list and counted on one line, so each run shows only
// what is new. An id here hides nothing from the other checks. Delete an entry when MAI moves or drops the point.
// A wrong pin does not belong here: exclude it in data_overrides.json.
const REVIEWED_OK = {
    '14a': {
        // 2026-11-26 spatial audit: fuel stations at a junction or on a road, filed under the nearest town
        345243: 'צומת סעד', 345548: 'כפר כנא, on the road', 345750: 'כפר כנא, on the road',
        345565: 'כפר מורן entrance', 344036: 'רמלה, on the road', 344557: 'עין יהב, on the road',
        344053: 'דרך כפר חסידים', 343966: 'יד נתן entrance', 345445: 'צומת כברי'
        // 343333 מחנה רמון was here; the owner left it out (2026-11-27, data_overrides.json)
    },
    '14b': {
        // 2026-11-26 spatial audit: places with no street in one small village, kept by the scraper on purpose
        344450: 'עין קניה', 344451: 'עין קניה', 344452: 'עין קניה', 344453: 'עין קניה',
        346488: 'באר גנים', 346489: 'באר גנים'
    },
    '14c': {
        // 2026-11-26 spatial audit: a real small place next to a bigger town
        342579: 'גן נווה', 344195: 'צומת גבעת ברנר', 344693: 'גליל ים', 344739: "דגניה א'",
        345308: 'נווה מונסון', 346221: 'גן חיים', 346456: 'גבעת אלה',
        // 2026-11-26: open question - address ביג רגבה, pin and city חוצות המפרץ, 19 km apart; Nominatim cannot tell
        347326: 'קולומביה'
    },
    '14d': {
        // 2026-11-26: two different streets that sameStreet treats as one (it is forgiving on purpose)
        342694: 'פנקס / פנחס רוזן', 342941: 'הרב ניסים / הטייסים', 343357: 'הטייסים / ניסים אלוני',
        342945: 'הרצל רוזנבלום / הרצל', 347527: 'שלום אש / דרך השלום', 345461: 'פולג 9 / מתחם פולג',
        345128: 'אלונים / צומת קיבוץ אלונים',
        // 2026-11-26: long roads, house numbers far apart
        343360: 'דרך מנחם בגין', 343526: "שד' ירושלים", 343550: "שד' ירושלים", 343631: 'דרך נמיר',
        346034: 'שדרות רוקח', 344015: 'הרצל, רחובות', 345311: 'בן גוריון, נתניה', 344950: 'שדרות ההגנה, חיפה',
        344707: 'אזור תעשייה, קצרין',
        // 2026-11-26: Nominatim puts the pin on its own street (149 m and 0 m)
        344430: 'הזרם, קדימה', 346308: 'בן גוריון, אשקלון',
        // 2026-11-26: open question - pin next to ביג פאשן, which fits its name "קניון עד הלום", but the
        // address is היהלומים 2, 4.2 km away, where 7 other points are; Nominatim cannot tell
        346318: 'קשת טעמים'
    }
};
const isReviewed = (check, id) => Object.prototype.hasOwnProperty.call(REVIEWED_OK[check], id);
// The one line that counts what a check left out because of REVIEWED_OK
function printReviewed(count, what = '') {
    if (count > 0) console.log(`    + ${count}${what} reviewed earlier (REVIEWED_OK in validate_data.js), not listed`);
}

// True when two different strings are one edit apart (one letter added, removed or replaced)
function oneEditApart(a, b) {
    if (a === b || Math.abs(a.length - b.length) > 1) return false;
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let end = 0;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    return Math.max(a.length, b.length) - start - end <= 1;
}

function extractStreet(address) {
    if (!address) return null;
    const parts = address.split(',');
    return parts.length >= 2 ? parts.slice(0, -1).join(',').trim() : address.trim();
}

function main() {
    const raw = fs.readFileSync(INPUT_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const locations = data.locations;

    let totalFails = 0;

    function check(label, failures, showAll = false) {
        const status = failures.length === 0 ? 'PASS' : 'FAIL';
        const icon = failures.length === 0 ? '+' : 'X';
        console.log(`[${icon}] ${label}: ${failures.length === 0 ? 'OK' : failures.length + ' issues'}`);
        if (failures.length > 0) {
            totalFails += failures.length;
            failures.slice(0, showAll ? failures.length : 5).forEach(f => console.log(`    id=${f.id}: ${f.reason}`));
            if (failures.length > 5 && !showAll) {
                console.log(`    ... and ${failures.length - 5} more`);
            }
        }
    }

    // 1. No duplicate name+city
    const nameCityCount = {};
    for (const loc of locations) {
        const key = `${loc.name}\0${loc.city}`;
        nameCityCount[key] = (nameCityCount[key] || 0) + 1;
    }
    const dupNameCity = locations.filter(l => nameCityCount[`${l.name}\0${l.city}`] > 1)
        .map(l => ({ id: l.id, reason: `"${l.name}" in ${l.city} (x${nameCityCount[`${l.name}\0${l.city}`]})` }));
    // Dedupe the report (show each pair once)
    const seenPairs = new Set();
    const dedupedReport = dupNameCity.filter(d => {
        if (seenPairs.has(d.reason)) return false;
        seenPairs.add(d.reason);
        return true;
    });
    check('1. No duplicate name+city', dedupedReport);

    // 2. No address="Unknown"
    check('2. No unknown addresses', locations
        .filter(l => l.address === 'Unknown' || l.address === 'כתובת לא זמינה' || !l.address)
        .map(l => ({ id: l.id, reason: `addr="${l.address}"` })));

    // 3. No city="Unknown"
    check('3. No unknown cities', locations
        .filter(l => l.city === 'Unknown' || !l.city)
        .map(l => ({ id: l.id, reason: `city="${l.city}"` })));

    // 4. No dead entries. Same rule as the scraper (isMarkedInactive): לא פעיל / בוטל / כפילות / נסגר anywhere,
    // כפול / כפל only as whole words, so a real name such as "מכפלה" is not flagged.
    check('4. No dead/inactive entries', locations
        .filter(l => isMarkedInactive(String(l.name || '')))
        .map(l => ({ id: l.id, reason: `"${l.name}"` })));

    // 5. No "רשות מקומית" boilerplate in names
    check('5. No רשות מקומית boilerplate', locations
        .filter(l => (l.name || '').includes('רשות מקומית'))
        .map(l => ({ id: l.id, reason: `"${l.name}"` })));

    // 6. No English-only names ("Collection Point")
    check('6. No "Collection Point" names', locations
        .filter(l => l.name === 'Collection Point')
        .map(l => ({ id: l.id, reason: `"${l.name}"` })));

    // 7. Coordinates within Israel bounds (29-34°N, 34-36°E)
    check('7. Coordinates in Israel bounds', locations
        .filter(l => !(l.lat >= 29 && l.lat <= 34 && l.lng >= 34 && l.lng <= 36))
        .map(l => ({ id: l.id, reason: `(${l.lat}, ${l.lng})` })));

    // 8. Type is "store" or "facility"
    check('8. Valid type values', locations
        .filter(l => !['store', 'facility'].includes(l.type))
        .map(l => ({ id: l.id, reason: `type="${l.type}"` })));

    // 9. All required fields present
    const required = ['id', 'name', 'address', 'city', 'type', 'lat', 'lng'];
    const missingFields = [];
    for (const loc of locations) {
        for (const field of required) {
            if (loc[field] === undefined || loc[field] === null || loc[field] === '') {
                missingFields.push({ id: loc.id, reason: `missing "${field}"` });
            }
        }
    }
    check('9. All required fields present', missingFields);

    // 10. Name is not identical to street-part of address
    check('10. Name != bare street address', locations
        .filter(l => {
            const street = extractStreet(l.address);
            return street && l.name === street;
        })
        .map(l => ({ id: l.id, reason: `name="${l.name}" = street from addr` })));

    // 11. Every id is a unique positive whole number
    const idCount = {};
    for (const loc of locations) idCount[loc.id] = (idCount[loc.id] || 0) + 1;
    check('11. Unique numeric ids', locations
        .filter(l => !Number.isInteger(l.id) || l.id <= 0 || idCount[l.id] > 1)
        .map(l => ({ id: l.id, reason: `id used ${idCount[l.id]} time(s)` })));

    // 12. Every facility from facilities.json made it into locations.json
    const facilitiesFile = path.join(__dirname, 'facilities.json');
    const expectedFacilities = fs.existsSync(facilitiesFile)
        ? JSON.parse(fs.readFileSync(facilitiesFile, 'utf-8')).locations
        : [];
    check('12. All facilities present', expectedFacilities
        .filter(f => !locations.some(l => l.id === f.id && l.type === 'facility' && l.description))
        .map(f => ({ id: f.id, reason: `"${f.name}" missing from locations.json` })));

    // 13. One spelling per city (variants split a city in two in the search box)
    const variantGroups = {};
    for (const loc of locations) {
        const key = (loc.city || '').replace(/[-\u05be\s"'\u05f3]/g, '').replace(/\u05d9\u05d9/g, '\u05d9').replace(/\u05d5\u05d5/g, '\u05d5');
        (variantGroups[key] = variantGroups[key] || new Set()).add(loc.city);
    }
    // These pairs look alike but are different places
    const KNOWN_DISTINCT = [['אילון', 'איילון'], ['צוקי ים', 'צוקים']];
    const isKnownDistinct = set => KNOWN_DISTINCT.some(pair => set.size === pair.length && pair.every(name => set.has(name)));
    check('13. One spelling per city', Object.values(variantGroups)
        .filter(set => set.size > 1 && !isKnownDistinct(set))
        .map(set => ({ id: '-', reason: [...set].join(' / ') })));

    // 14. Position warnings - each needs a human look, so they print a list and do not fail.
    // CRS note: input is WGS84 lat/lng in degrees; every distance below is a great-circle
    // (haversine, sphere R = 6371 km) distance in km - never a difference in degrees.
    // Confirm a flag with a reverse geocode, then fix it in data_overrides.json.
    const byCity = {};
    for (const loc of locations) (byCity[loc.city] = byCity[loc.city] || []).push(loc);
    const toRad = deg => deg * Math.PI / 180;
    const distanceKm = (a, b) => {
        const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
        return 2 * 6371 * Math.asin(Math.sqrt(h));
    };

    // 14a. More than 5 km from every other point of its own city.
    // Cannot see: errors under 5 km, cities with one point, regional councils (names starting מועצה אזורית
    // and the list below - spread out by nature), and two wrong points of one city that sit next to each other.
    const ISOLATED_KM = 5;
    // Regional councils that appear in the data without the "מועצה אזורית" prefix
    const COUNCIL_NAMES = ['משגב', 'מרום הגליל', 'גזר', 'אילות', 'באר טוביה', 'גוש עציון', 'לכיש'];
    const isCouncil = city => city.startsWith('מועצה אזורית') || COUNCIL_NAMES.includes(city);
    const isolated = [];
    for (const [city, group] of Object.entries(byCity)) {
        if (group.length < 2 || isCouncil(city)) continue;
        for (const loc of group) {
            const nearest = Math.min(...group.filter(o => o !== loc).map(o => distanceKm(loc, o)));
            if (nearest > ISOLATED_KM) isolated.push({ loc, nearest });
        }
    }
    isolated.sort((a, b) => b.nearest - a.nearest);
    const isolatedNew = isolated.filter(f => !isReviewed('14a', f.loc.id));
    console.log(`[!] 14a. Over ${ISOLATED_KM} km from every other point of its city (warning): ${isolatedNew.length} to review`);
    isolatedNew.forEach(f => console.log(`    id=${f.loc.id}: ${f.nearest.toFixed(1)} km - ${f.loc.city} - "${f.loc.name}"`));
    printReviewed(isolated.length - isolatedNew.length);

    // 14b. One coordinate shared by points on different streets (the geocoder fell back to a city or street centre).
    // The street is the first part of the address, compared with the scraper's streetKey. An address that is
    // only the city name has no street and contradicts nobody. Two spellings of one street count as one street:
    // the comparison is the scraper's own sameStreet, so the two files cannot disagree about what a street is.
    // Cannot see: a fallback pin that only one point uses, or a group whose members all name the same street.
    // May flag wrongly: two place names at one real spot ("בית ספר א'" and "מתנ"ס"), because the address
    // does not say which part is a street.
    const streetOf = l => {
        const first = String(l.address || '').split(',')[0].trim();
        return first === l.city ? '' : streetKey(first);
    };
    const differentStreets = group => {
        const streets = [...new Set(group.map(streetOf).filter(Boolean))];
        return streets.some(a => streets.some(b => !sameStreet(a, b)));
    };
    const byCoord = {};
    for (const loc of locations) (byCoord[`${loc.lat}, ${loc.lng}`] = byCoord[`${loc.lat}, ${loc.lng}`] || []).push(loc);
    // A group is left out only when every member is in REVIEWED_OK: a new point at a reviewed spot shows the group again.
    const stackedAll = Object.entries(byCoord)
        .filter(([, group]) => group.length > 1 && differentStreets(group))
        .sort((a, b) => b[1].length - a[1].length);
    const stacked = stackedAll.filter(([, group]) => !group.every(l => isReviewed('14b', l.id)));
    const stackedPoints = stacked.reduce((sum, [, group]) => sum + group.length, 0);
    console.log(`[!] 14b. Same coordinate, different streets (warning): ${stackedPoints} points in ${stacked.length} groups to review`);
    for (const [coord, group] of stacked) {
        group.forEach(l => console.log(`    id=${l.id}: group (${coord}) x${group.length} - ${l.city} - "${l.name}"`));
    }
    const reviewedGroups = stackedAll.length - stacked.length;
    printReviewed(reviewedGroups, reviewedGroups === 1 ? ' group' : ' groups');

    // 14c. The only point of its city, sitting inside another city: at least 4 of its 5 nearest points
    // are within 1 km and share one other city. Usually a wrong city name on a correct pin.
    // Cannot see: cities with 2+ points, and lone points in places with fewer than 4 other points within 1 km.
    const embedded = [];
    for (const group of Object.values(byCity)) {
        if (group.length !== 1) continue;
        const loc = group[0];
        const near = locations.filter(o => o !== loc)
            .map(o => ({ city: o.city, km: distanceKm(loc, o) }))
            .sort((a, b) => a.km - b.km).slice(0, 5).filter(n => n.km <= 1);
        const votes = {};
        near.forEach(n => { votes[n.city] = (votes[n.city] || 0) + 1; });
        const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] >= 4) embedded.push({ loc, host: top[0], votes: top[1] });
    }
    const embeddedNew = embedded.filter(f => !isReviewed('14c', f.loc.id));
    console.log(`[!] 14c. Only point of its city, inside another city (warning): ${embeddedNew.length} to review`);
    embeddedNew.forEach(f => console.log(`    id=${f.loc.id}: ${f.votes} of 5 nearest are ${f.host} - ${f.loc.city} - "${f.loc.name}"`));
    printReviewed(embedded.length - embeddedNew.length);

    // 14d. One street in one city, but the nearest other point on that street is more than 1.5 km away.
    // A shop address with a house number names one building, and two shops on one street are rarely that far
    // apart, so one of the pins is often in the wrong place (MAI's geocoder picked a same-named street elsewhere).
    // The street is the first part of the address, compared with the scraper's streetKey and sameStreet
    // (house numbers, street words and quotes do not count). Only a point with a house number is flagged:
    // a street name with no number can be anywhere along it. A road number ("כביש 4") is not a house number.
    // Cannot see: a street with one point in its city, a point with no house number, errors under 1.5 km.
    // May flag wrongly: long roads, and two different streets that sameStreet treats as one ("הרצל" / "הרצל רוזנבלום").
    const SAME_STREET_FAR_KM = 1.5;
    const firstPart = l => {
        const first = String(l.address || '').split(',')[0].trim();
        return first === l.city ? '' : first;
    };
    const farOnStreet = [];
    let withNumber = 0;
    let withoutMate = 0;
    for (const group of Object.values(byCity)) {
        const keyed = group.map(l => ({ l, first: firstPart(l), key: streetKey(firstPart(l)) })).filter(p => p.key);
        for (const p of keyed) {
            if (!/\d/.test(p.first.replace(/כביש \d+/g, ''))) continue;
            withNumber++;
            const mates = keyed.filter(o => o !== p && sameStreet(p.key, o.key))
                .map(o => ({ id: o.l.id, km: distanceKm(p.l, o.l) })).sort((a, b) => a.km - b.km);
            if (mates.length === 0) withoutMate++;
            else if (mates[0].km > SAME_STREET_FAR_KM) farOnStreet.push({ loc: p.l, mate: mates[0] });
        }
    }
    farOnStreet.sort((a, b) => b.mate.km - a.mate.km);
    const farOnStreetNew = farOnStreet.filter(f => !isReviewed('14d', f.loc.id));
    console.log(`[!] 14d. Same street, nearest other point on it over ${SAME_STREET_FAR_KM} km away (warning): ${farOnStreetNew.length} to review`);
    farOnStreetNew.forEach(f => console.log(`    id=${f.loc.id}: ${f.mate.km.toFixed(1)} km from id=${f.mate.id} on the same street - ${f.loc.city} - "${f.loc.address}"`));
    printReviewed(farOnStreet.length - farOnStreetNew.length);
    console.log(`    cannot see: ${withoutMate} of ${withNumber} points with a house number have no other point on their street in their city`);

    // 15. At least 1,000 locations (the scraper has the same floor; a short file means the source broke)
    check('15. At least 1,000 locations', locations.length >= 1000 ? []
        : [{ id: '-', reason: `only ${locations.length} locations` }]);

    // 16. lat and lng are real numbers. Check 7 alone lets the string "32.1" through, because >= converts it.
    // (A string or fractional id is caught by check 11.)
    check('16. lat/lng are finite numbers', locations
        .filter(l => typeof l.lat !== 'number' || typeof l.lng !== 'number' || !Number.isFinite(l.lat) || !Number.isFinite(l.lng))
        .map(l => ({ id: l.id, reason: `lat=${JSON.stringify(l.lat)} lng=${JSON.stringify(l.lng)}` })));

    // 17. No markup in the text users read: < or > or an HTML entity (&amp; &#39; &#x27;)
    const markup = /[<>]|&\w+;|&#\d+;|&#x[0-9a-f]+;/i;
    const markupFails = [];
    for (const loc of locations) {
        for (const field of ['name', 'address', 'city']) {
            if (markup.test(String(loc[field] || ''))) markupFails.push({ id: loc.id, reason: `${field}="${loc[field]}"` });
        }
    }
    check('17. No markup in name/address/city', markupFails);

    // 18. A name must not contain a coordinate-like number (a digit, a dot, 4+ digits)
    check('18. No coordinates in names', locations
        .filter(l => /\d+\.\d{4,}/.test(String(l.name || '')))
        .map(l => ({ id: l.id, reason: `"${l.name}"` })));

    // 19. Name is not the whole address (check 10 covers the street part only)
    check('19. Name != full address', locations
        .filter(l => l.name && l.name === l.address)
        .map(l => ({ id: l.id, reason: `name = address = "${l.name}"` })));

    // 20. Ids 1-99 belong to facilities.json, everything else is a store with id 100 or more
    const facilityIds = new Set(expectedFacilities.map(f => f.id));
    const idRangeFails = [];
    for (const loc of locations) {
        if (loc.type === 'facility') {
            if (!facilityIds.has(loc.id)) idRangeFails.push({ id: loc.id, reason: `facility "${loc.name}" is not in facilities.json` });
            if (!(loc.id >= 1 && loc.id <= 99)) idRangeFails.push({ id: loc.id, reason: 'facility id outside 1-99' });
        } else if (!(loc.id >= 100)) {
            idRangeFails.push({ id: loc.id, reason: `"${loc.type}" id below 100` });
        }
    }
    check('20. Facility ids 1-99 from facilities.json, store ids 100+', idRangeFails);

    // 21. No two city names one letter apart (one place spelled two ways splits it in the search box).
    // Names shorter than 4 letters on both sides are skipped; real different places go in KNOWN_DISTINCT_CITIES.
    // Cannot see: spellings two or more letters apart.
    const letterCount = name => (name.match(/\p{L}/gu) || []).length;
    const isDistinctPair = (a, b) => KNOWN_DISTINCT_CITIES.some(pair => pair.includes(a) && pair.includes(b));
    const cityNames = Object.keys(byCity).filter(Boolean).sort();
    const nearSpellings = [];
    for (let i = 0; i < cityNames.length; i++) {
        for (let j = i + 1; j < cityNames.length; j++) {
            const a = cityNames[i], b = cityNames[j];
            if (oneEditApart(a, b) && (letterCount(a) >= 4 || letterCount(b) >= 4) && !isDistinctPair(a, b)) {
                nearSpellings.push({ id: '-', reason: `${a} (${byCity[a].length}) / ${b} (${byCity[b].length})` });
            }
        }
    }
    check('21. No city names one letter apart', nearSpellings, true);

    // 22. No schools (owner's decision: a bin inside a school is not open to the public).
    // Same rule as the scraper (isSchool), so the two cannot disagree.
    check('22. No school points', locations
        .filter(l => isSchool(String(l.name || '')))
        .map(l => ({ id: l.id, reason: `"${l.name}"` })));

    // 23. A city name is made of Hebrew words: no digit, Latin letter, bracket or dot, and no word of
    // one bare letter ("גבעת ח ן"). A letter with a geresh ("דגניה א'") or after a hyphen ("א-זרקא") is fine.
    // These are typing slips in the source; fix them in scraper.js (CITY_ALIASES) or data_overrides.json.
    const malformedCity = city => /[0-9A-Za-z()[\].]/.test(city) || city.split(/\s+/).some(word => /^\p{L}$/u.test(word));
    check('23. City names are well formed', Object.keys(byCity).filter(malformedCity).sort()
        .map(city => ({ id: byCity[city][0].id, reason: `city="${city}" (${byCity[city].length})` })), true);

    // 24. One city name is another plus a word in front or behind ("סילבר" / "כפר סילבר",
    // "משגב" / "מועצה אזורית משגב"): often one place under two names, which splits it in the search box.
    // A warning, because many such pairs are two real places; those go in KNOWN_DISTINCT_CITY_PAIRS.
    // Junctions and roads used as a city ("צומת גבים" next to "גבים") are listed on purpose: they wait
    // for the owner's decision.
    // Cannot see: two names for one place that do not share whole words.
    const isDistinctCityPair = (a, b) => KNOWN_DISTINCT_CITY_PAIRS.some(pair => pair.includes(a) && pair.includes(b));
    const nested = [];
    for (const a of cityNames) {
        for (const b of cityNames) {
            if (a !== b && (b.startsWith(a + ' ') || b.endsWith(' ' + a)) && !isDistinctCityPair(a, b)) {
                nested.push(`${a} (${byCity[a].length}) / ${b} (${byCity[b].length})`);
            }
        }
    }
    console.log(`[!] 24. One city name inside another (warning): ${nested.length} pairs to review`);
    nested.forEach(pair => console.log(`    ${pair}`));

    // 25. One shop listed twice: the same chain (the scraper's shopChain, so "רמי לוי - תקשורת" is "רמי לוי")
    // at the same address, under 100 m apart. The scraper merges such pairs up to 50 m (dropSameShop);
    // a pair 50-100 m apart goes in data_overrides.json (exclude the higher id).
    // The address is compared without spaces, punctuation and quotes, and with double yod/vav as one.
    // Municipal points are not a chain and are not compared. Cannot see: one shop under two addresses.
    const SAME_SHOP_KM = 0.1;
    const plainAddress = address => String(address || '').replace(/[\s"'׳״.,\-]/g, '').replace(/יי/g, 'י').replace(/וו/g, 'ו');
    const shopsByKey = {};
    for (const loc of locations) {
        const chain = shopChain(String(loc.name || ''));
        if (chain) (shopsByKey[chain + '\0' + plainAddress(loc.address)] = shopsByKey[chain + '\0' + plainAddress(loc.address)] || []).push(loc);
    }
    const sameShop = [];
    for (const group of Object.values(shopsByKey)) {
        group.sort((a, b) => a.id - b.id);
        group.forEach((loc, i) => {
            const first = group.slice(0, i).find(other => distanceKm(loc, other) < SAME_SHOP_KM);
            if (first) sameShop.push({ id: loc.id, reason: `same shop as id=${first.id}, ${Math.round(distanceKm(loc, first) * 1000)} m - "${loc.name}" - ${loc.address}` });
        });
    }
    check('25. One shop listed once', sameShop, true);

    // 26-30. Leftovers in the text users read. Each uses the scraper's own clean-up function or pattern,
    // so a failure means the scraper missed a case: fix the rule in scraper.js, not the data.
    const nameOf = l => String(l.name || '');
    // 26. No part of a name repeats an earlier part ("חשמלית - חשמלית - מקס שיין 9")
    check('26. No repeated part in a name', locations
        .filter(l => withoutRepeatedParts(nameOf(l)) !== nameOf(l))
        .map(l => ({ id: l.id, reason: `"${l.name}"` })));
    // 27. No company form in a name ("שופרסל סטוק בע"מ")
    check('27. No בע"מ in names', locations
        .filter(l => /בע["'״]{1,2}מ/.test(nameOf(l)))
        .map(l => ({ id: l.id, reason: `"${l.name}"` })));
    // 28. No Arabic script and no land-registry parcel number ("10262/31") in a name or address
    const arabic = new RegExp(ARABIC_SCRIPT.source);
    const parcel = new RegExp(PARCEL_NUMBER.source);
    check('28. No Arabic script or parcel numbers', locations
        .filter(l => [nameOf(l), String(l.address || '')].some(text => arabic.test(text) || parcel.test(text)))
        .map(l => ({ id: l.id, reason: `"${l.name}" | "${l.address}"` })));
    // 29. A name does not end in a hyphen (a separator with nothing after it)
    check('29. No name ending in "-"', locations
        .filter(l => /-\s*$/.test(nameOf(l)))
        .map(l => ({ id: l.id, reason: `"${l.name}"` })));
    // 30. No municipal boilerplate after the "מוקד איסוף - " prefix ("מוקד איסוף - עיריית רמת גן - מוקד איסוף עירוני - ...")
    const PREFIX = 'מוקד איסוף - ';
    check('30. No boilerplate after the מוקד איסוף prefix', locations
        .filter(l => nameOf(l).startsWith(PREFIX) && withoutBoilerplate(nameOf(l).slice(PREFIX.length)) !== nameOf(l).slice(PREFIX.length))
        .map(l => ({ id: l.id, reason: `"${l.name}"` })));

    // 31. kind, when present, is one of the three the page knows. A point the scraper cannot classify
    // (no business name) has no kind key at all.
    const KINDS = ['fuel', 'shop', 'municipal'];
    check('31. Valid kind values', locations
        .filter(l => 'kind' in l && !KINDS.includes(l.kind))
        .map(l => ({ id: l.id, reason: `kind="${l.kind}"` })));
    // 32. At least 95 % of collection points have a kind (99.3 % on 2026-11-27). Fewer means MAI changed
    // its business names or categories and the scraper rules in pointKind no longer fit.
    const stores = locations.filter(l => l.type === 'store');
    const withKind = stores.filter(l => KINDS.includes(l.kind)).length;
    check('32. At least 95 % of points have a kind', withKind >= 0.95 * stores.length ? []
        : [{ id: '-', reason: `only ${withKind} of ${stores.length} collection points (${(100 * withKind / stores.length).toFixed(1)} %) have a kind` }]);

    // Summary
    console.log(`\n--- ${totalFails === 0 ? 'ALL CHECKS PASSED' : totalFails + ' TOTAL ISSUES'} (${locations.length} locations) ---`);
    process.exit(totalFails === 0 ? 0 : 1);
}

main();
