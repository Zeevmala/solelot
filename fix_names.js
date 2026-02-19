/**
 * Fix generic/verbose location names in locations.json
 *
 * Phase 1 (already applied):
 * - "רשות מקומית - מוקד איסוף" → "מוקד איסוף - [street]"
 * - "Collection Point" → "נקודת איסוף - [street or city]"
 * - "נקודת איסוף" (bare) → "נקודת איסוף - [city]"
 *
 * Phase 2 (this update):
 * - Remove dead entries (לא פעיל / בוטל / כפול / כפילות)
 * - Shorten verbose names containing "רשות מקומית" boilerplate
 * - Fix entries with city="Unknown"
 *
 * Usage: bun fix_names.js
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
    const parts = address.split(',');
    if (parts.length >= 2) {
        return parts.slice(0, -1).join(',').trim();
    }
    return address.trim();
}

// Extract city from address like "יהודה בורלא 31, תל אביב"
// Returns "תל אביב" (part after the last comma)
function extractCity(address) {
    if (!address || address === 'Unknown' || address === 'כתובת לא זמינה') {
        return null;
    }
    const parts = address.split(',');
    if (parts.length >= 2) {
        return parts[parts.length - 1].trim();
    }
    return null;
}

function main() {
    const raw = fs.readFileSync(INPUT_FILE, 'utf-8');
    const data = JSON.parse(raw);
    let locations = data.locations;

    // --- Part A: Remove dead entries ---
    const deadPatterns = ['לא פעיל', 'בוטל', 'כפול', 'כפילות'];
    const removed = [];
    locations = locations.filter(loc => {
        const name = loc.name || '';
        const isDead = deadPatterns.some(p => name.includes(p));
        if (isDead) {
            removed.push({ id: loc.id, name: loc.name });
        }
        return !isDead;
    });

    // --- Part B: Shorten verbose names ---
    let ruleA = 0; // Tel Aviv sanitation stations
    let ruleB = 0; // City-prefixed municipality
    let ruleC = 0; // Bare "רשות מקומית - מרכז איסוף"
    let ruleD = 0; // No-city-prefix "רשות מקומית - מוקד איסוף - [facility]"
    let phase1 = 0; // Original exact-match rules
    let unchanged = 0;

    for (const loc of locations) {
        const name = (loc.name || '').trim();

        // Rule A: Tel Aviv sanitation stations (9 entries)
        // "תל אביב - רשות מקומית - מרכז איסוף - מוקד איסוף - תחנת תברואה ..."
        // Note: one entry has missing space: "מוקד איסוף -תחנת תברואה"
        if (name.includes('מוקד איסוף') && name.includes('תחנת תברואה')) {
            const marker = 'תחנת תברואה';
            const idx = name.indexOf(marker);
            const suffix = name.substring(idx + marker.length).replace(/^[\s-]+/, '').trim();
            loc.name = suffix ? `מוקד איסוף - תחנת תברואה ${suffix}` : `מוקד איסוף - תחנת תברואה`;
            ruleA++;
            continue;
        }

        // Rule B: City-prefixed municipality (20 entries)
        // "[city] - רשות מקומית - מוקד איסוף - [facility]"
        if (name.includes(' - רשות מקומית - מוקד איסוף - ')) {
            const marker = ' - מוקד איסוף - ';
            const idx = name.lastIndexOf(marker);
            const facility = name.substring(idx + marker.length).trim();
            if (facility) {
                loc.name = `מוקד איסוף - ${facility}`;
            } else {
                const street = extractStreet(loc.address);
                loc.name = street ? `מוקד איסוף - ${street}` : `מוקד איסוף - ${loc.city || 'לא ידוע'}`;
            }
            ruleB++;
            continue;
        }

        // Rule C: Bare "רשות מקומית - מרכז איסוף" (23 entries)
        if (name === 'רשות מקומית - מרכז איסוף') {
            const street = extractStreet(loc.address);
            loc.name = street ? `מרכז איסוף - ${street}` : `מרכז איסוף - ${loc.city || 'לא ידוע'}`;
            ruleC++;
            continue;
        }

        // Rule D: No-city-prefix "רשות מקומית - מוקד איסוף - [facility]" (6 entries)
        if (name.startsWith('רשות מקומית - מוקד איסוף -') || name.startsWith('רשות מקומית - מוקד איסוף-')) {
            const marker = 'מוקד איסוף';
            const idx = name.indexOf(marker);
            const afterMarker = name.substring(idx + marker.length).replace(/^[\s-]+/, '').trim();
            if (afterMarker) {
                loc.name = `מוקד איסוף - ${afterMarker}`;
            } else {
                const street = extractStreet(loc.address);
                loc.name = street ? `מוקד איסוף - ${street}` : `מוקד איסוף - ${loc.city || 'לא ידוע'}`;
            }
            ruleD++;
            continue;
        }

        // Phase 1 rules (kept for re-runnability)
        if (name === 'רשות מקומית - מוקד איסוף') {
            const street = extractStreet(loc.address);
            loc.name = street ? `מוקד איסוף - ${street}` : `מוקד איסוף עירוני - ${loc.city || 'לא ידוע'}`;
            phase1++;
            continue;
        }
        if (name === 'Collection Point') {
            const street = extractStreet(loc.address);
            loc.name = street ? `נקודת איסוף - ${street}` : `נקודת איסוף - ${loc.city || 'לא ידוע'}`;
            phase1++;
            continue;
        }
        if (name === 'נקודת איסוף') {
            loc.name = `נקודת איסוף - ${loc.city || 'לא ידוע'}`;
            phase1++;
            continue;
        }

        unchanged++;
    }

    // --- Part C: Fix entries with city="Unknown" ---
    let cityFixed = 0;
    for (const loc of locations) {
        if (loc.city === 'Unknown') {
            const city = extractCity(loc.address);
            if (city && city !== 'Unknown') {
                loc.city = city;
                cityFixed++;
            }
        }
    }

    // Save
    data.locations = locations;
    fs.writeFileSync(INPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');

    // Summary
    console.log('--- Fix Summary ---');
    console.log(`Removed dead entries:       ${removed.length}`);
    if (removed.length > 0) {
        removed.forEach(r => console.log(`  - id=${r.id}: ${r.name}`));
    }
    console.log(`Rule A (sanitation):        ${ruleA}`);
    console.log(`Rule B (city-prefixed):     ${ruleB}`);
    console.log(`Rule C (bare מרכז איסוף):   ${ruleC}`);
    console.log(`Rule D (no-city prefix):    ${ruleD}`);
    console.log(`Phase 1 rules:              ${phase1}`);
    console.log(`City fixed:                 ${cityFixed}`);
    console.log(`Unchanged:                  ${unchanged}`);
    console.log(`Total remaining:            ${locations.length}`);
}

main();
