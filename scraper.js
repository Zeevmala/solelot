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
 *   node scraper.js --force             save even if many points disappeared
 *
 * It writes locations.json and data_meta.json (where the data came from, when,
 * and how many markers were kept, skipped and dropped).
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

// All the files the scraper reads and writes live in one folder.
// The tests pass a temporary folder, so they never touch the real data.
function filesIn(dir) {
    return {
        output: path.join(dir, 'locations.json'),
        meta: path.join(dir, 'data_meta.json'),
        facilities: path.join(dir, 'facilities.json'),
        overrides: path.join(dir, 'data_overrides.json'),
        raw: path.join(dir, 'raw_markers.json')
    };
}

const LIVE_MAP_ID = '5';
const BATTERY_CATEGORY = '12';
const FETCH_TIMEOUT_MS = 60000;

// Refuse to save when fewer points than this parse (the API format probably changed)
const MIN_POINTS = 1000;
// Refuse to save when the new file has under 90 % of the points of the previous one
const MIN_SHARE_OF_PREVIOUS = 0.9;
// Two records with the same name, city and street closer than this are one point listed twice
const SAME_PLACE_METERS = 100;

// Israel bounding box (same numbers as app.js and validate_data.js)
const BOUNDS = { minLat: 29, maxLat: 34, minLng: 34, maxLng: 36 };

// MAI marks retired points inside the name instead of deleting them
// ("סניף נסגר" = branch closed, "כפילות" / "כפל" / "כפול" = duplicate record).
const DEAD_PATTERNS = ['לא פעיל', 'בוטל', 'כפילות', 'נסגר'];
// These two are short and also sit inside ordinary words ("מכפולת", "מכפלה"),
// so they count only as a whole word.
const DEAD_WORDS = ['כפול', 'כפל'];

function isMarkedInactive(name) {
    if (DEAD_PATTERNS.some(p => name.includes(p))) return true;
    return DEAD_WORDS.some(word => new RegExp('(^|[^א-ת])' + word + '($|[^א-ת])').test(name));
}

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
    'פנחס לבון 18 נתניה': 'נתניה',
    // Spelling mistakes and old names found in the November 2026 audit
    'ירשלים': 'ירושלים',
    'נצרת עלית': 'נוף הגליל',
    'נצרת עילית': 'נוף הגליל',
    'אום אל פאחם': 'אום אל פחם',
    'זכרון יעקב': 'זיכרון יעקב',
    'שוהם': 'שהם',
    'יקנעם': 'יוקנעם',
    'יוקנעם עילית': 'יוקנעם',
    'יוקנעם המושבה': 'יוקנעם',
    'יהוד מונוסון': 'יהוד',
    'יהוד מונסון': 'יהוד',
    'מודיעין מכבים רעות': 'מודיעין',
    'מודעין': 'מודיעין',
    'מכבים': 'מודיעין',
    'רעות': 'מודיעין',
    'מעלה האדומים': 'מעלה אדומים',
    'תניה': 'נתניה',
    'ראשלצ': 'ראשון לציון',
    'כפר יסיף': 'כפר יאסיף',
    'כפר מאכר': 'כפר מכר',
    'קלנסוואה': 'קלנסאווה',
    "מג'ד אל כרום": "מג'דל כרום",
    'דיר אל אסאד': 'דיר אל-אסד',
    'מעלות': 'מעלות תרשיחא',
    'כבר המכבי': 'כפר המכבי',
    'כמכמורת': 'מכמורת',
    'שדה עוזיה': 'שדה עוזיהו',
    'פרדס חנה-כרכור': 'פרדס חנה',
    'פרדס חנה כרכור': 'פרדס חנה'
};

function normalizeCity(city) {
    let tidy = clean(city)
        .replace(/[\u05be\u2013\u2014]/g, '-') // Hebrew maqaf and long dashes -> hyphen
        .replace(/^תל-אביב/, 'תל אביב')
        // One town with a two-part name. Without this, the split below would
        // keep only the second half ("יפו", "כרכור").
        .replace(/^תל אביב\s*-\s*יפו$/, 'תל אביב')
        .replace(/^פרדס חנה\s*-\s*כרכור$/, 'פרדס חנה');
    // "מועצה אזורית לכיש - שדה דוד" -> "שדה דוד" (the town, not the council)
    const parts = tidy.split(HYPHEN_SEPARATOR);
    if (parts.length > 1) tidy = clean(parts[parts.length - 1]);
    tidy = tidy
        .replace(/^(מועצה מקומית|מ\.מ\.)\s+/, '')
        .replace(/^(קיבוץ|מושב)\s+/, '') // "קיבוץ שפיים" and "שפיים" are one place
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

// "&amp;" -> "&", "&quot;" -> '"', "&#39;" -> "'", "&#8211;" -> "–".
// One pass only, so "&amp;lt;" becomes the text "&lt;" and not a "<".
const ENTITIES = { amp: '&', quot: '"', lt: '<', gt: '>' };
function decodeEntities(text) {
    return text.replace(/&(amp|quot|lt|gt|#\d+);/g, (whole, code) => {
        if (ENTITIES[code]) return ENTITIES[code];
        const number = Number(code.slice(1));
        if (number < 32 || number > 0x10ffff) return ' '; // control characters and nonsense
        return String.fromCodePoint(number);
    });
}

// Decode HTML entities, remove tags, collapse whitespace and drop stray separators at the ends
function clean(value) {
    return decodeEntities(String(value == null ? '' : value))
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

// A coordinate must be a plain decimal number such as "32.8" or "-1.5".
// parseFloat would read "32,8" as 32 and "32.8abc" as 32.8, which puts a pin
// in the wrong place without any warning. Anything else gives NaN.
function parseCoordinate(value) {
    const text = String(value == null ? '' : value).trim();
    return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

// Distance in metres between two { lat, lng } points (haversine formula)
function distanceMeters(a, b) {
    const toRad = degrees => degrees * Math.PI / 180;
    const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Street and house number arrive in two fields. MAI writes 0 for "no number",
// and sometimes the number was already typed into the street ("הרצל 97" + "97").
function joinStreet(street, houseNumber) {
    if (!houseNumber || /^0+$/.test(houseNumber)) return street;
    if (street === houseNumber || street.endsWith(' ' + houseNumber)) return street;
    return [street, houseNumber].filter(Boolean).join(' ');
}

// Mega's internal branch code: "מגה קניון חדרה - חוויה ואיכות בעיר-3570/90"
const CHAIN_CODE_SUFFIX = /\s*-\s*חוויה ואיכות בעיר\s*-\s*\d+\/\d+$/;

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
    if (!/^\d+$/.test(String(marker.id))) return { skip: 'bad id' };
    if (String(marker.map_id) !== LIVE_MAP_ID) return { skip: 'old map' };

    const categories = String(marker.category || '').split(',').map(c => c.trim());
    if (!categories.includes(BATTERY_CATEGORY)) return { skip: 'not a battery point' };

    // No "|| 0" fallback here: a missing coordinate must be rejected, not become 0
    const lat = parseCoordinate(marker.lat);
    const lng = parseCoordinate(marker.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { skip: 'bad coordinates' };
    if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) {
        return { skip: 'outside Israel bounds' };
    }

    const override = overrides[String(marker.id)] || {};
    if (override.exclude) return { skip: 'excluded by data_overrides.json' };

    const fields = customFields(marker);
    const titleParts = String(marker.title || '').split(/<br\s*\/?>/i);
    const rawName = clean((fields.business_name || clean(titleParts[0])).replace(CHAIN_CODE_SUFFIX, ''));
    if (!rawName) return { skip: 'no name' };
    if (isMarkedInactive(rawName)) return { skip: 'marked inactive by MAI' };

    // A marker with no structured fields has "street" or "street, city" as its title
    const hasFields = Boolean(fields.business_name);
    let titleBits = [...new Set(rawName.split(',').map(clean).filter(Boolean))];
    const titleCity = !hasFields && titleBits.length > 1 ? titleBits[titleBits.length - 1] : '';
    titleBits = titleBits.filter(bit => bit !== titleCity);

    const rawCity = clean(override.city || fields.city || titleCity || cityByCoord.get(coordKey(lat, lng)) || '');
    const city = normalizeCity(rawCity);
    if (!city) return { skip: 'no city' };

    let street = hasFields
        ? joinStreet(fields.street || '', fields.house_number || '')
        : titleBits.join(', ');
    let place = fields.neighborhood || '';
    // The city is added once at the end, so a street or place that is only
    // the city again says nothing ("המלאכה 2, רעננה, רעננה")
    if (street === city || street === rawCity) street = '';
    if (place === city || place === rawCity) place = '';

    let name;
    if (!hasFields) {
        name = 'נקודת איסוף - ' + (street || city);
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

    // Some records have the address typed in as the business name
    // ("ההשראה 2, שלומי"). The same text twice helps nobody, so such a point
    // gets the generic name that nameless points get.
    const withoutCommas = text => text.replace(/,/g, '');
    if (withoutCommas(name) === withoutCommas(addressParts.join(', '))) {
        name = 'נקודת איסוף - ' + (addressParts.slice(0, -1).join(', ') || city);
    }

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
        detail: place || street,
        street: addressParts.length > 1 ? addressParts[0].split(',')[0].trim() : '', // '' = the address is only the city
        // false when "street" above is really a place name (MAI's neighbourhood field)
        hasStreetField: Boolean(street) && addressParts[0] === street
    };
}

// Two entries with the same name in the same city are confusing in search.
// Add the place (or street) to tell them apart. If that still gives the same name:
//   - closer than SAME_PLACE_METERS: one point listed twice. Keep the first, drop the rest.
//   - further apart: two real points. Keep both; the later one gets its street
//     added, or a number "(2)" when the street is no help.
// A numbered pair has the same name AND the same address at two different
// places, so one of the two pins is probably wrong. They are returned in
// farTwins so the run can print them for a person to check.
function disambiguate(entries) {
    const byNameCity = new Map();
    for (const entry of entries) {
        const key = entry.location.name + '\0' + entry.location.city;
        if (!byNameCity.has(key)) byNameCity.set(key, []);
        byNameCity.get(key).push(entry);
    }

    const result = [];
    let renamed = 0;
    const dropped = [];  // { id, sameAs }
    const farTwins = []; // { id, sameAs, meters }
    for (const group of byNameCity.values()) {
        if (group.length === 1) {
            result.push(group[0]);
            continue;
        }
        const keptByName = new Map(); // name -> entries already kept under that name
        const usedNames = new Set();
        for (const entry of group) {
            const loc = entry.location;
            if (entry.detail && !loc.name.includes(entry.detail)) {
                loc.name = (loc.name + ' - ' + entry.detail).substring(0, 200);
                renamed++;
            }
            if (!keptByName.has(loc.name)) keptByName.set(loc.name, []);
            const twins = keptByName.get(loc.name);
            const near = twins.find(twin => distanceMeters(twin.location, loc) <= SAME_PLACE_METERS);
            if (near) {
                dropped.push({ id: loc.id, sameAs: near.location.id });
                continue;
            }
            if (twins.length > 0) {
                const first = twins[0].location;
                const withStreet = (loc.name + ' - ' + entry.street).substring(0, 200);
                if (entry.street && !loc.name.includes(entry.street) && !usedNames.has(withStreet)) {
                    twins.push(entry);
                    loc.name = withStreet;
                } else {
                    farTwins.push({ id: loc.id, sameAs: first.id, meters: Math.round(distanceMeters(first, loc)) });
                    twins.push(entry);
                    loc.name = loc.name.substring(0, 190) + ' (' + twins.length + ')';
                }
            } else {
                twins.push(entry);
            }
            usedNames.add(loc.name);
            result.push(entry);
        }
    }
    return { entries: result, renamed, dropped, farTwins };
}

// Words that do not tell two streets apart: "שדרות יגאל אלון" and "יגאל אלון" are one street
const STREET_WORDS = ['רחוב', 'רח', 'שדרות', 'שד', 'דרך'];

// The words of a street that tell it apart from other streets, joined by spaces:
// no house numbers, quotes, dots, hyphens or street words.
// e.g. "רח' הרצל 10" -> "הרצל". Double yod/vav is ignored (איינשטיין = אינשטיין).
// A road number is part of the name and stays: "כביש 40" -> "כביש 40".
function streetKey(street) {
    const words = street
        .replace(/["'׳״]/g, '')      // ז'בוטינסקי = זבוטינסקי, ביל"ו = בילו
        .replace(/[.\-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const kept = [];
    words.forEach((word, index) => {
        if (STREET_WORDS.includes(word)) return;
        const isRoadNumber = /^\d+$/.test(word) && words[index - 1] === 'כביש';
        const text = isRoadNumber ? word : word.replace(/\d/g, '');
        if (text) kept.push(text.replace(/יי/g, 'י').replace(/וו/g, 'ו'));
    });
    return kept.join(' ');
}

// True when one word can be turned into the other by changing, adding or
// removing a single letter ("דיזינגוף" / "דיזנגוף", "נפחא" / "נפחה").
function oneLetterApart(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    let start = 0; // letters that agree from the start
    while (start < short.length && short[start] === long[start]) start++;
    let end = 0;   // letters that agree from the end
    while (end < short.length - start && short[short.length - 1 - end] === long[long.length - 1 - end]) end++;
    // what is left in the middle is the difference: at most one letter in the longer word
    return long.length - start - end <= 1;
}

// Two words of a street name are the same word when they are equal after
// dropping a leading "ה" ("הלוי" = "לוי"), or when they are one letter apart.
// Short words and numbers must be exactly equal: "הדר" and "הדס" are two
// streets, so a different letter is allowed only when both words have 3+
// letters and at least one of them has 4+.
function sameStreetWord(a, b) {
    const bare = word => (word.length > 3 && word.startsWith('ה') ? word.slice(1) : word);
    const x = bare(a);
    const y = bare(b);
    if (x === y) return true;
    if (/\d/.test(x + y)) return false;
    if (Math.min(x.length, y.length) < 3 || Math.max(x.length, y.length) < 4) return false;
    return oneLetterApart(x, y);
}

// Compares two street keys (see streetKey). People write one street in many
// ways: "דוד סחרוב" / "סחרוב", "יהודה לוי" / "יהודה הלוי", "דיזינגוף" / "דיזנגוף".
// The streets are the same when every word of the shorter key is also a word
// of the longer key (see sameStreetWord for what "the same word" means).
// The house number is not looked at: a city-centre fallback can share a number.
function sameStreet(keyA, keyB) {
    const a = keyA.split(' ');
    const b = keyB.split(' ');
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.every(word => long.some(other => sameStreetWord(word, other)));
}

// MAI's geocoder puts an address it cannot find at the centre of the city, so
// several different addresses end up on exactly the same coordinate. Such a pin
// is not where its address says, and we cannot tell which one (if any) is right.
//
// Each member has a "street": its street field, or (without one) the place it
// names instead, such as "בית ספר יסודי". A group of points on one exact
// coordinate is "stacked", and all of it is dropped, when:
//   1. nobody has a street field and the members are in more than one city, or
//   2. somebody has a street field and two members name different streets
//      (compared with sameStreet), or
//   3. somebody has a street field, a member names nothing at all, and the
//      members are in more than one city.
// Kept on purpose:
//   - a shopping centre (same street, different shops);
//   - a village where nobody has a street field and everybody is in the same
//     place: the pin is the village centre, which is still inside the village;
//   - a point that names nothing, next to points of the same city.
function isStacked(group) {
    const cities = new Set(group.map(entry => entry.location.city));
    if (!group.some(entry => entry.hasStreetField)) return cities.size > 1;

    const keys = [...new Set(group.map(entry => streetKey(entry.street)).filter(Boolean))];
    if (keys.some(a => keys.some(b => !sameStreet(a, b)))) return true;
    const someoneNamesNothing = group.some(entry => !streetKey(entry.street));
    return someoneNamesNothing && cities.size > 1;
}

// Removes every member of every stacked group. Returns the entries that stay
// and the groups that went ({ coord, ids }) so the caller can log them.
function dropStacked(entries) {
    const byCoord = new Map();
    for (const entry of entries) {
        const coord = entry.location.lat + ',' + entry.location.lng; // exact, not rounded
        if (!byCoord.has(coord)) byCoord.set(coord, []);
        byCoord.get(coord).push(entry);
    }
    const kept = [];
    const groups = [];
    for (const [coord, group] of byCoord) {
        if (group.length > 1 && isStacked(group)) {
            groups.push({ coord, ids: group.map(entry => entry.location.id) });
        } else {
            kept.push(...group);
        }
    }
    return { entries: kept, groups };
}

function loadFacilities(file) {
    if (!fs.existsSync(file)) {
        console.warn('facilities.json not found - no facilities will be added');
        return [];
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.locations.map(f => ({ ...f, type: 'facility' }));
}

function loadOverrides(file) {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')).overrides || {};
}

// The previous locations.json, or null when there is none yet
function loadPrevious(file) {
    if (!fs.existsSync(file)) return null;
    try {
        const previous = JSON.parse(fs.readFileSync(file, 'utf8')).locations;
        return Array.isArray(previous) ? previous : null;
    } catch (e) {
        console.warn('Could not read previous locations.json: ' + e.message);
        return null;
    }
}

// Cities from the previous run, for the few markers MAI publishes without one
function cityCache(previous) {
    const cache = new Map();
    for (const loc of previous || []) {
        if (loc.city && loc.city !== 'Unknown' && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
            cache.set(coordKey(loc.lat, loc.lng), loc.city);
        }
    }
    return cache;
}

// Markers without a usable id go last; transformMarker skips them anyway
function numericId(marker) {
    return marker && /^\d+$/.test(String(marker.id)) ? Number(marker.id) : Infinity;
}

function buildLocations(markers, cityByCoord, overrides = {}) {
    // MAI does not promise an order. Sorting first means the same markers always
    // give the same file, whichever order they arrive in.
    const sorted = [...markers].sort((a, b) => {
        const idA = numericId(a);
        const idB = numericId(b);
        return idA === idB ? 0 : (idA < idB ? -1 : 1);
    });

    const skipped = {};
    const entries = [];
    for (const marker of sorted) {
        const result = transformMarker(marker, cityByCoord, overrides);
        if (result.skip) {
            skipped[result.skip] = (skipped[result.skip] || 0) + 1;
        } else {
            entries.push(result);
        }
    }

    // Stacked groups go first: "same name, same coordinate" is only a repeat
    // when the addresses agree, and after this step they do.
    const { entries: placed, groups: stacked } = dropStacked(entries);

    // Same name at the same coordinates = MAI listed one point twice
    const firstAtSpot = new Map();
    const sameSpot = []; // { id, sameAs } for the log
    const unique = placed.filter(entry => {
        const loc = entry.location;
        const key = loc.name + '\0' + coordKey(loc.lat, loc.lng);
        if (firstAtSpot.has(key)) {
            sameSpot.push({ id: loc.id, sameAs: firstAtSpot.get(key) });
            return false;
        }
        firstAtSpot.set(key, loc.id);
        return true;
    });

    const { entries: named, renamed, dropped: sameName, farTwins } = disambiguate(unique);
    const locations = named.map(entry => entry.location).sort((a, b) => a.id - b.id);

    // An override whose id is not in the MAI response does nothing any more
    const markerIds = new Set(markers.filter(m => m && typeof m === 'object').map(m => String(m.id)));
    const overridesUnmatched = Object.keys(overrides).filter(id => !markerIds.has(id)).sort((a, b) => a - b);

    return {
        locations,
        skipped,
        stats: {
            sameSpot: sameSpot.length,
            renamed,
            dropped: sameName.length,
            stackedGroups: stacked.length,
            stackedPoints: stacked.reduce((sum, group) => sum + group.ids.length, 0)
        },
        dropped: { sameSpot, sameName, stacked },
        farTwins,
        overridesUnmatched
    };
}

// Returns the reason not to save, or null when the count is fine.
// previousCount is null when there is no previous file to compare with.
function checkCount(newCount, previousCount, force) {
    if (newCount < MIN_POINTS) {
        return 'Only ' + newCount + ' collection points parsed - the API format may have changed.';
    }
    if (!force && previousCount && newCount < previousCount * MIN_SHARE_OF_PREVIOUS) {
        return 'Only ' + newCount + ' points, under 90 % of the ' + previousCount +
            ' in the current locations.json. Check the Skipped and dropped lines above; ' +
            'if the drop is real, run again with --force.';
    }
    return null;
}

// Reads the command line. Throws on a mistake so main() can print it and exit 1.
function parseArgs(argv) {
    const options = { input: null, force: argv.includes('--force') };
    const inputIndex = argv.indexOf('--input');
    if (inputIndex !== -1) {
        const file = argv[inputIndex + 1];
        if (!file || file.startsWith('--')) {
            throw new Error('--input needs a file. Usage: node scraper.js [--input raw.json] [--force]');
        }
        options.input = file;
    }
    return options;
}

// Write to a temporary file first and rename it into place. A crash in the
// middle then leaves the old file whole instead of half a new one.
function writeJsonAtomic(file, data) {
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, file);
}

/**
 * The whole refresh. options:
 *   dir    folder with facilities.json, data_overrides.json and the output (default: this folder)
 *   input  path of a saved API response; without it the live API is fetched
 *   force  save even when the count fell under 90 % of the previous file
 * Returns the object written to data_meta.json.
 */
async function run(options = {}) {
    const files = filesIn(options.dir || __dirname);
    let data;
    let source;
    let fetchedAt;
    if (options.input) {
        data = JSON.parse(fs.readFileSync(options.input, 'utf8'));
        source = 'file: ' + path.basename(options.input);
        fetchedAt = fs.statSync(options.input).mtime; // when the saved response was written
        console.log('Loaded saved API response from ' + options.input);
    } else {
        data = await fetchMarkers();
        source = API_URL;
        fetchedAt = new Date();
        fs.writeFileSync(files.raw, JSON.stringify(data), 'utf8');
        console.log('Saved raw response to raw_markers.json');
    }

    const markers = Array.isArray(data) ? data : (data && data.markers);
    if (!Array.isArray(markers) || markers.length === 0) {
        throw new Error('No markers in response: ' + JSON.stringify(data).substring(0, 300));
    }
    console.log('Fetched ' + markers.length + ' markers');

    const previous = loadPrevious(files.output);
    const built = buildLocations(markers, cityCache(previous), loadOverrides(files.overrides));
    const { locations: stores, skipped, stats, dropped, farTwins, overridesUnmatched } = built;
    console.log('Skipped:', skipped);
    console.log('Duplicates removed: ' + (stats.sameSpot + stats.dropped) + ', names disambiguated: ' + stats.renamed);
    for (const d of [...dropped.sameSpot, ...dropped.sameName]) {
        console.log('  duplicate ' + d.id + ' dropped, same point as ' + d.sameAs);
    }
    console.log('Stacked coordinates dropped: ' + stats.stackedPoints + ' points in ' + stats.stackedGroups +
        ' groups (one coordinate, different streets)');
    for (const group of dropped.stacked) {
        console.log('  stacked at ' + group.coord + ': ' + group.ids.join(', '));
    }
    if (farTwins.length > 0) {
        console.warn('Same name and address at two places (both kept - one pin is probably wrong, check them):');
        for (const twin of farTwins) {
            console.warn('  ' + twin.id + ' is ' + twin.meters + ' m from ' + twin.sameAs);
        }
    }
    if (overridesUnmatched.length > 0) {
        console.warn('Overrides not matched by any MAI marker: [' + overridesUnmatched.join(', ') + ']');
    }

    const facilities = loadFacilities(files.facilities);
    const usedIds = new Set(stores.map(s => s.id));
    for (const facility of facilities) {
        if (usedIds.has(facility.id)) throw new Error('facilities.json id ' + facility.id + ' collides with a MAI id');
    }
    const locations = [...facilities, ...stores];

    // Refuse to overwrite good data with a broken response (e.g. API schema change)
    const previousStores = previous ? previous.filter(loc => loc.type === 'store').length : null;
    const problem = checkCount(stores.length, previousStores, options.force);
    if (problem) throw new Error(problem + ' locations.json was NOT changed.');

    const meta = {
        source: source,
        fetched_at: fetchedAt.toISOString(),
        raw_markers: markers.length,
        kept: stores.length,
        skipped: skipped,
        duplicates_removed: stats.sameSpot + stats.dropped,
        stacked_dropped: stats.stackedPoints,
        overrides_unmatched: overridesUnmatched.map(Number)
    };
    writeJsonAtomic(files.output, { locations });
    writeJsonAtomic(files.meta, meta);
    console.log('Saved ' + locations.length + ' locations (' + stores.length + ' collection points, ' + facilities.length + ' facilities)');

    const chains = {};
    locations.forEach(loc => { chains[loc.chain] = (chains[loc.chain] || 0) + 1; });
    console.log('By chain:', chains);
    return meta;
}

async function main() {
    await run(parseArgs(process.argv.slice(2)));
}

if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    transformMarker, buildLocations, determineChain, normalizeCity, municipalName, clean,
    isMarkedInactive, joinStreet, parseCoordinate, distanceMeters, streetKey, sameStreet, dropStacked,
    disambiguate, checkCount, parseArgs, run
};
