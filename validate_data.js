/**
 * Data quality validation for locations.json
 *
 * Run after ANY data change to catch issues before they reach users.
 * Usage: node validate_data.js [path]
 *   path: another file to check instead of locations.json (used to test the checks on small fixtures)
 *
 * Exit code: 0 = all pass, 1 = failures found
 */

const fs = require('fs');
const path = require('path');

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
    ['קדימה', 'קדמה'], ['קיבוץ מגל', 'קיבוץ מגן'], ['שדרות', 'שחרות'], ['שומרה', 'שומריה'], ['שלומי', 'שלומית']
];

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

    // 4. No dead entries (לא פעיל / בוטל / כפול / כפילות / כפל / נסגר)
    const deadPatterns = ['לא פעיל', 'בוטל', 'כפול', 'כפילות', 'כפל', 'נסגר'];
    check('4. No dead/inactive entries', locations
        .filter(l => deadPatterns.some(p => (l.name || '').includes(p)))
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
    const required = ['id', 'name', 'address', 'city', 'type', 'chain', 'lat', 'lng'];
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
    // Cannot see: errors under 5 km, cities with one point, regional councils (מועצה אזורית, spread out by nature),
    // and two wrong points of one city that sit next to each other.
    const ISOLATED_KM = 5;
    const isolated = [];
    for (const [city, group] of Object.entries(byCity)) {
        if (group.length < 2 || city.startsWith('מועצה אזורית')) continue;
        for (const loc of group) {
            const nearest = Math.min(...group.filter(o => o !== loc).map(o => distanceKm(loc, o)));
            if (nearest > ISOLATED_KM) isolated.push({ loc, nearest });
        }
    }
    isolated.sort((a, b) => b.nearest - a.nearest);
    console.log(`[!] 14a. Over ${ISOLATED_KM} km from every other point of its city (warning): ${isolated.length} to review`);
    isolated.forEach(f => console.log(`    id=${f.loc.id}: ${f.nearest.toFixed(1)} km - ${f.loc.city} - "${f.loc.name}"`));

    // 14b. One coordinate shared by points on different streets (the geocoder fell back to a city or street centre).
    // Cannot see: a fallback pin that only one point uses, or a group whose members all name the same street.
    const streetKey = l => String(l.address || '').split(',')[0].replace(/[\d"'׳״.\-]/g, '').replace(/\s+/g, ' ').trim();
    const byCoord = {};
    for (const loc of locations) (byCoord[`${loc.lat}, ${loc.lng}`] = byCoord[`${loc.lat}, ${loc.lng}`] || []).push(loc);
    const stacked = Object.entries(byCoord)
        .filter(([, group]) => group.length > 1 && new Set(group.map(streetKey)).size > 1)
        .sort((a, b) => b[1].length - a[1].length);
    const stackedPoints = stacked.reduce((sum, [, group]) => sum + group.length, 0);
    console.log(`[!] 14b. Same coordinate, different streets (warning): ${stackedPoints} points in ${stacked.length} groups to review`);
    for (const [coord, group] of stacked) {
        group.forEach(l => console.log(`    id=${l.id}: group (${coord}) x${group.length} - ${l.city} - "${l.name}"`));
    }

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
    console.log(`[!] 14c. Only point of its city, inside another city (warning): ${embedded.length} to review`);
    embedded.forEach(f => console.log(`    id=${f.loc.id}: ${f.votes} of 5 nearest are ${f.host} - ${f.loc.city} - "${f.loc.name}"`));

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

    // Summary
    console.log(`\n--- ${totalFails === 0 ? 'ALL CHECKS PASSED' : totalFails + ' TOTAL ISSUES'} (${locations.length} locations) ---`);
    process.exit(totalFails === 0 ? 0 : 1);
}

main();
