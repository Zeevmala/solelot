/**
 * MAI Battery Recycling Locations Scraper
 *
 * Builds locations.json from two sources:
 *   1. The MAI (mai.org.il) map API  -> collection points (type "store")
 *   2. facilities.json (hand-curated) -> recycling plants  (type "facility")
 * and applies the manual corrections in data_overrides.json.
 *
 * Usage:
 *   node scraper.js                     fetch live data from MAI
 *   node scraper.js --input raw.json    rebuild from a saved API response
 *
 * After running, always run:  node validate_data.js
 *
 * --- How the MAI API is shaped (checked November 2026) ---
 * - Every marker has a map_id. Map "5" is the live public map. Map "2" is an
 *   old map whose markers have no names, so we ignore it.
 * - "category" is a comma-separated list. "12" means "accepts batteries".
 * - "address" is always null. The real address lives in custom_field_data:
 *   city, street, house_number, neighborhood, business_name.
 * - "title" is HTML ("name<br><span>address</span>"), so we never use it
 *   when the structured fields exist.
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'https://mai.org.il/wp-json/wpgmza/v1/markers';
const OUTPUT_FILE = path.join(__dirname, 'locations.json');
const FACILITIES_FILE = path.join(__dirname, 'facilities.json');
const OVERRIDES_FILE = path.join(__dirname, 'data_overrides.json');
const RAW_FILE = path.join(__dirname, 'raw_markers.json');

const LIVE_MAP_ID = '5';
const BATTERY_CATEGORY = '12';
const FETCH_TIMEOUT_MS = 60000;

// Israel bounding box (same numbers as app.js and validate_data.js)
const BOUNDS = { minLat: 29, maxLat: 34, minLng: 34, maxLng: 36 };

// MAI marks retired points inside the name instead of deleting them
const DEAD_PATTERNS = ['לא פעיל', 'בוטל', 'כפול', 'כפילות'];

// Order matters: the first match wins, so specific names come first.
const CHAIN_PATTERNS = [
    ['superpharm', ['סופר-פארם', 'סופר פארם', 'סופרפארם']],
    ['shufersal', ['שופרסל']],
    ['office_depot', ['אופיס דיפו']],
    ['home_center', ['הום סנטר']],
    ['pelephone', ['פלאפון']],
    ['cellcom', ['סלקום']],
    ['rami_levy', ['רמי לוי']],
    ['big_electric', ['ביג אלקטריק']],
    ['medton', ['מדטון']],
    ['bug', ['באג']],
    ['ikea', ['איקאה']],
    ['mega', ['מגה']],
    ['gas_station', ['תחנת דלק']],
    ['school', ['בית ספר', 'ביה"ס', 'בי"ס']],
    ['municipality', ['רשות מקומית', 'מוקד איסוף', 'מרכז איסוף', 'עיריית', 'מועצה']]
];

function determineChain(name) {
    for (const [chain, keywords] of CHAIN_PATTERNS) {
        if (keywords.some(k => name.includes(k))) return chain;
    }
    return 'other';
}

// MAI and OpenStreetMap spell some cities differently. One spelling per city,
// otherwise the same city shows up twice in search suggestions.
const CITY_ALIASES = {
    'תל אביב-יפו': 'תל אביב',
    'תל אביב יפו': 'תל אביב',
    'פתח תקוה': 'פתח תקווה',
    'בת-ים': 'בת ים',
    'בת- ים': 'בת ים',
    'עוספיה': 'עוספייה',
    'ברור חייל': 'ברור חיל',
    'פנחס לבון 18 נתניה': 'נתניה'
};

function normalizeCity(city) {
    let tidy = clean(city)
        .replace(/[\u05be\u2013\u2014]/g, '-') // Hebrew maqaf and long dashes -> hyphen
        .replace(/^תל-אביב/, 'תל אביב');
    // "מועצה אזורית לכיש - שדה דוד" -> "שדה דוד" (the town, not the council)
    const parts = tidy.split(HYPHEN_SEPARATOR);
    if (parts.length > 1) tidy = clean(parts[parts.length - 1]);
    tidy = tidy
        .replace(/^(מועצה מקומית|מ\.מ\.)\s+/, '')
        .replace(/^קרית /, 'קריית '); // official spelling has two yods
    return CITY_ALIASES[tidy] || tidy;
}

// A hyphen used as a separator has a space on at least one side ("א - ב", "א -ב").
// A hyphen inside a word ("סופר-פארם") is left alone.
const HYPHEN_SEPARATOR = /\s+-\s*|\s*-\s+/;

// "תל אביב - רשות מקומית - מרכז איסוף - תחנת תברואה" -> "מוקד איסוף - תחנת תברואה"
// The boilerplate parts say nothing about the place, so only the rest is kept.
const MUNICIPAL_BOILERPLATE = ['רשות מקומית', 'מוקד איסוף', 'מרכז איסוף', 'אחראי לפינוי פסולת'];
function municipalName(rawName, city, fallback) {
    const parts = [];
    for (const part of rawName.split(HYPHEN_SEPARATOR).map(clean)) {
        if (!part || part === city || MUNICIPAL_BOILERPLATE.includes(part) || parts.includes(part)) continue;
        parts.push(part);
    }
    return 'מוקד איסוף - ' + (parts.join(' - ') || fallback || city);
}

// Collapse whitespace and drop stray separators at the ends
function clean(value) {
    return String(value == null ? '' : value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s,.\-]+|[\s,.]+$/g, '')
        .trim();
}

// custom_field_data is [{ name, value }, ...] -> { city, street, ... }
function customFields(marker) {
    const fields = {};
    const list = Array.isArray(marker.custom_field_data) ? marker.custom_field_data : [];
    for (const field of list) {
        if (field && field.name) fields[field.name] = clean(field.value);
    }
    return fields;
}

// Coordinates rounded to ~1 m, used to recognise "the same spot"
function coordKey(lat, lng) {
    return lat.toFixed(5) + ',' + lng.toFixed(5);
}

async function fetchMarkers() {
    console.log('Fetching data from MAI API...');
    const response = await fetch(API_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; battery-map-scraper)' }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error('Invalid JSON: ' + e.message);
    }
}

/**
 * Turn one MAI marker into our location format.
 * Returns { location } on success or { skip: 'reason' } so the caller can
 * count why markers were dropped (nothing is dropped silently).
 * cityByCoord: Map of coordKey -> city, used when MAI has no city field.
 * overrides:   manual corrections from data_overrides.json, keyed by marker id.
 */
function transformMarker(marker, cityByCoord, overrides = {}) {
    if (!marker || typeof marker !== 'object') return { skip: 'not an object' };
    if (String(marker.map_id) !== LIVE_MAP_ID) return { skip: 'old map' };

    const categories = String(marker.category || '').split(',').map(c => c.trim());
    if (!categories.includes(BATTERY_CATEGORY)) return { skip: 'not a battery point' };

    // No "|| 0" fallback here: a missing coordinate must be rejected, not become 0
    const lat = parseFloat(marker.lat);
    const lng = parseFloat(marker.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { skip: 'bad coordinates' };
    if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) {
        return { skip: 'outside Israel bounds' };
    }

    const override = overrides[String(marker.id)] || {};
    if (override.exclude) return { skip: 'excluded by data_overrides.json' };

    const fields = customFields(marker);
    const titleParts = String(marker.title || '').split(/<br\s*\/?>/i);
    const rawName = fields.business_name || clean(titleParts[0]);
    if (!rawName) return { skip: 'no name' };
    if (DEAD_PATTERNS.some(p => rawName.includes(p))) return { skip: 'marked inactive by MAI' };

    // A marker with no structured fields has "street" or "street, city" as its title
    const hasFields = Boolean(fields.business_name);
    let titleBits = [...new Set(rawName.split(',').map(clean).filter(Boolean))];
    const titleCity = !hasFields && titleBits.length > 1 ? titleBits[titleBits.length - 1] : '';
    titleBits = titleBits.filter(bit => bit !== titleCity);

    const city = normalizeCity(override.city || fields.city || titleCity || cityByCoord.get(coordKey(lat, lng)) || '');
    if (!city) return { skip: 'no city' };

    const street = hasFields
        ? [fields.street, fields.house_number].filter(Boolean).join(' ')
        : titleBits.join(', ');
    const place = fields.neighborhood || '';

    let name;
    if (!hasFields) {
        name = 'נקודת איסוף - ' + street;
    } else if (MUNICIPAL_BOILERPLATE.some(b => rawName.includes(b))) {
        name = municipalName(rawName, city, place || street);
    } else {
        name = rawName;
    }

    // Leave out address parts that only repeat the name
    const addressParts = [];
    if (street && street !== name) addressParts.push(street);
    if (place && place !== name && !street.includes(place)) addressParts.push(place);
    addressParts.push(city);

    return {
        location: {
            id: parseInt(marker.id, 10),
            name: name.substring(0, 200),
            address: addressParts.join(', ').substring(0, 300),
            city: city,
            type: 'store',
            chain: determineChain(rawName),
            lat: lat,
            lng: lng,
            hours: 'בדוק באתר' // MAI does not publish opening hours
        },
        // Kept only while building; removed before saving
        detail: place || street
    };
}

// Two entries with the same name in the same city are confusing in search.
// Add the street/place to tell them apart; drop exact repeats.
function disambiguate(entries) {
    const byNameCity = new Map();
    for (const entry of entries) {
        const key = entry.location.name + '\0' + entry.location.city;
        if (!byNameCity.has(key)) byNameCity.set(key, []);
        byNameCity.get(key).push(entry);
    }

    const result = [];
    let renamed = 0;
    let dropped = 0;
    for (const group of byNameCity.values()) {
        if (group.length === 1) {
            result.push(group[0]);
            continue;
        }
        const seen = new Set();
        for (const entry of group) {
            const loc = entry.location;
            if (entry.detail && !loc.name.includes(entry.detail)) {
                loc.name = (loc.name + ' - ' + entry.detail).substring(0, 200);
                renamed++;
            }
            if (seen.has(loc.name)) {
                dropped++; // same name, same city, same street = same point listed twice
                continue;
            }
            seen.add(loc.name);
            result.push(entry);
        }
    }
    return { entries: result, renamed, dropped };
}

function loadFacilities() {
    if (!fs.existsSync(FACILITIES_FILE)) {
        console.warn('facilities.json not found - no facilities will be added');
        return [];
    }
    const data = JSON.parse(fs.readFileSync(FACILITIES_FILE, 'utf8'));
    return data.locations.map(f => ({ ...f, type: 'facility' }));
}

function loadOverrides() {
    if (!fs.existsSync(OVERRIDES_FILE)) return {};
    return JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')).overrides || {};
}

// Cities from the previous run, for the few markers MAI publishes without one
function loadCityCache() {
    const cache = new Map();
    if (!fs.existsSync(OUTPUT_FILE)) return cache;
    try {
        const previous = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')).locations;
        for (const loc of previous) {
            if (loc.city && loc.city !== 'Unknown') cache.set(coordKey(loc.lat, loc.lng), loc.city);
        }
    } catch (e) {
        console.warn('Could not read previous locations.json: ' + e.message);
    }
    return cache;
}

function buildLocations(markers, cityByCoord, overrides = {}) {
    const skipped = {};
    const entries = [];
    for (const marker of markers) {
        const result = transformMarker(marker, cityByCoord, overrides);
        if (result.skip) {
            skipped[result.skip] = (skipped[result.skip] || 0) + 1;
        } else {
            entries.push(result);
        }
    }

    // Same name at the same coordinates = MAI listed one point twice
    const seenSpot = new Set();
    let sameSpot = 0;
    const unique = entries.filter(entry => {
        const loc = entry.location;
        const key = loc.name + '\0' + coordKey(loc.lat, loc.lng);
        if (seenSpot.has(key)) { sameSpot++; return false; }
        seenSpot.add(key);
        return true;
    });

    const { entries: named, renamed, dropped } = disambiguate(unique);
    const locations = named.map(entry => entry.location).sort((a, b) => a.id - b.id);

    return { locations, skipped, stats: { sameSpot, renamed, dropped } };
}

async function main() {
    const inputIndex = process.argv.indexOf('--input');
    let data;
    if (inputIndex !== -1 && process.argv[inputIndex + 1]) {
        data = JSON.parse(fs.readFileSync(process.argv[inputIndex + 1], 'utf8'));
        console.log('Loaded saved API response from ' + process.argv[inputIndex + 1]);
    } else {
        data = await fetchMarkers();
        fs.writeFileSync(RAW_FILE, JSON.stringify(data), 'utf8');
        console.log('Saved raw response to raw_markers.json');
    }

    const markers = Array.isArray(data) ? data : (data && data.markers);
    if (!Array.isArray(markers) || markers.length === 0) {
        throw new Error('No markers in response: ' + JSON.stringify(data).substring(0, 300));
    }
    console.log('Fetched ' + markers.length + ' markers');

    const { locations: stores, skipped, stats } = buildLocations(markers, loadCityCache(), loadOverrides());
    console.log('Skipped:', skipped);
    console.log('Duplicates removed: ' + (stats.sameSpot + stats.dropped) + ', names disambiguated: ' + stats.renamed);

    // Refuse to overwrite good data with a broken response (e.g. API schema change)
    if (stores.length < 1000) {
        throw new Error('Only ' + stores.length + ' collection points parsed - the API format may have changed. locations.json was NOT changed.');
    }

    const facilities = loadFacilities();
    const usedIds = new Set(stores.map(s => s.id));
    for (const facility of facilities) {
        if (usedIds.has(facility.id)) throw new Error('facilities.json id ' + facility.id + ' collides with a MAI id');
    }

    const locations = [...facilities, ...stores];
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ locations }, null, 2) + '\n', 'utf8');
    console.log('Saved ' + locations.length + ' locations (' + stores.length + ' collection points, ' + facilities.length + ' facilities)');

    const chains = {};
    locations.forEach(loc => { chains[loc.chain] = (chains[loc.chain] || 0) + 1; });
    console.log('By chain:', chains);
}

if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}

module.exports = { transformMarker, buildLocations, determineChain, normalizeCity, municipalName, clean };
