/**
 * Fix generic location names in locations.json
 *
 * Renames:
 * 1. "רשות מקומית - מוקד איסוף" → "מוקד איסוף - [street from address]"
 * 2. "Collection Point" → "נקודת איסוף - [city]"  (fallback if still no address)
 * 3. "נקודת איסוף" (bare) → "נקודת איסוף - [city]"
 *
 * Run AFTER reverse_geocode.py has filled in missing addresses.
 * Usage: node fix_names.js
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'locations.json');

// Extract street portion from address like "יהודה בורלא 31, תל אביב"
// Returns "יהודה בורלא 31" (everything before the last comma = city)
function extractStreet(address) {
    if (!address || address === 'Unknown' || address === 'כתובת לא זמינה') {
        return null;
    }
    // Split by comma, take everything except the last part (city)
    const parts = address.split(',');
    if (parts.length >= 2) {
        return parts.slice(0, -1).join(',').trim();
    }
    // No comma — return the whole address
    return address.trim();
}

function main() {
    const raw = fs.readFileSync(INPUT_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const locations = data.locations;

    let municipalityFixed = 0;
    let collectionPointFixed = 0;
    let bareNekudaFixed = 0;
    let unchanged = 0;

    for (const loc of locations) {
        const name = (loc.name || '').trim();

        // Rule 1: "רשות מקומית - מוקד איסוף" → "מוקד איסוף - [street]"
        if (name === 'רשות מקומית - מוקד איסוף') {
            const street = extractStreet(loc.address);
            if (street) {
                loc.name = `מוקד איסוף - ${street}`;
                municipalityFixed++;
            } else {
                // No street available, use city
                loc.name = `מוקד איסוף עירוני - ${loc.city || 'לא ידוע'}`;
                municipalityFixed++;
            }
            continue;
        }

        // Rule 2: "Collection Point" → "נקודת איסוף - [street or city]"
        if (name === 'Collection Point') {
            const street = extractStreet(loc.address);
            if (street) {
                loc.name = `נקודת איסוף - ${street}`;
            } else {
                loc.name = `נקודת איסוף - ${loc.city || 'לא ידוע'}`;
            }
            collectionPointFixed++;
            continue;
        }

        // Rule 3: Bare "נקודת איסוף" → "נקודת איסוף - [city]"
        if (name === 'נקודת איסוף') {
            loc.name = `נקודת איסוף - ${loc.city || 'לא ידוע'}`;
            bareNekudaFixed++;
            continue;
        }

        unchanged++;
    }

    // Save
    fs.writeFileSync(INPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');

    // Summary
    console.log('--- Name Fix Summary ---');
    console.log(`Municipality renamed:       ${municipalityFixed}`);
    console.log(`Collection Point renamed:   ${collectionPointFixed}`);
    console.log(`Bare נקודת איסוף renamed:   ${bareNekudaFixed}`);
    console.log(`Unchanged:                  ${unchanged}`);
    console.log(`Total:                      ${locations.length}`);
}

main();
