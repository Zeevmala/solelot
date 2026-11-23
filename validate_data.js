/**
 * Data quality validation for locations.json
 *
 * Run after ANY data change to catch issues before they reach users.
 * Usage: node validate_data.js
 *
 * Exit code: 0 = all pass, 1 = failures found
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'locations.json');

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

    function check(label, failures) {
        const status = failures.length === 0 ? 'PASS' : 'FAIL';
        const icon = failures.length === 0 ? '+' : 'X';
        console.log(`[${icon}] ${label}: ${failures.length === 0 ? 'OK' : failures.length + ' issues'}`);
        if (failures.length > 0) {
            totalFails += failures.length;
            failures.slice(0, 5).forEach(f => console.log(`    id=${f.id}: ${f.reason}`));
            if (failures.length > 5) {
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

    // 4. No dead entries (לא פעיל / בוטל / כפול / כפילות)
    const deadPatterns = ['לא פעיל', 'בוטל', 'כפול', 'כפילות'];
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

    // 14. Points far from the rest of their city (warning only - needs a human look).
    // A point more than 12 km from the middle of its city usually means the
    // coordinates or the city name are wrong. Regional councils are spread out,
    // so this prints a list instead of failing. Fix real errors in data_overrides.json.
    const byCity = {};
    for (const loc of locations) (byCity[loc.city] = byCity[loc.city] || []).push(loc);
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const toRad = deg => deg * Math.PI / 180;
    const distanceKm = (lat1, lng1, lat2, lng2) => {
        const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
        return 2 * 6371 * Math.asin(Math.sqrt(a));
    };
    const farPoints = [];
    for (const group of Object.values(byCity)) {
        if (group.length < 3) continue; // too few points to know where the city is
        const midLat = median(group.map(l => l.lat));
        const midLng = median(group.map(l => l.lng));
        for (const loc of group) {
            const km = distanceKm(midLat, midLng, loc.lat, loc.lng);
            if (km > 12) farPoints.push({ loc, km });
        }
    }
    farPoints.sort((a, b) => b.km - a.km);
    console.log(`[!] 14. Far from own city (warning): ${farPoints.length} to review`);
    farPoints.slice(0, 5).forEach(f => console.log(`    id=${f.loc.id}: ${f.km.toFixed(0)} km from ${f.loc.city} - "${f.loc.name}"`));

    // Summary
    console.log(`\n--- ${totalFails === 0 ? 'ALL CHECKS PASSED' : totalFails + ' TOTAL ISSUES'} (${locations.length} locations) ---`);
    process.exit(totalFails === 0 ? 0 : 1);
}

main();
