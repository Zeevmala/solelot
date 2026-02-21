/**
 * Data quality validation for locations.json
 *
 * Run after ANY data change to catch issues before they reach users.
 * Usage: bun validate_data.js
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

    // Summary
    console.log(`\n--- ${totalFails === 0 ? 'ALL CHECKS PASSED' : totalFails + ' TOTAL ISSUES'} (${locations.length} locations) ---`);
    process.exit(totalFails === 0 ? 0 : 1);
}

main();
