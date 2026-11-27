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
 *   node scraper.js --force             save even if many points disappeared or moved,
 *                                       or many overrides match no marker
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
// Two records of one chain closer than this, on one street, are one shop listed twice (see dropSameShop)
const SAME_SHOP_METERS = 50;
// A point whose pin is further than this from where it was in the previous file has "moved"
const MOVED_METERS = 100;
// Refuse to save when more than this share of the previous points was removed or moved
const MAX_SHARE_REMOVED_OR_MOVED = 0.05;
// Refuse to save when more than this share of the overrides matches no marker
const MAX_SHARE_OVERRIDES_UNMATCHED = 0.1;

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

// Schools are left off the map (owner's decision, Nov 2026): a collection bin
// inside a school is not open to the public. Colleges and universities stay.
// Each pattern must match a whole word, so "אלישיב" (a moshav) is not a "ישיבה"
// and "התיכונים" (a street) is not a "תיכון".
const SCHOOL_WORDS = [
    'בית ה?ספר', 'בתי[ -]ה?ספר', 'בי"ס', 'ביה"ס', 'ה?תיכון', 'תיכונט', 'חט"ב', 'חטיבת', 'ישיבה', 'ישיבת',
    'אולפנה', 'אולפנת', 'ממ"ד', 'חמ"ד', 'תלמוד תורה', 'גני ילדים', 'בית חינוך', 'קרי?ית ה?חינוך'
];
// "מול בית הספר" / "ליד התיכון": opposite or next to a school is not inside it
const SCHOOL_PATTERN = new RegExp('(^|[^א-ת])(?<!(?:מול|ליד) )(' + SCHOOL_WORDS.join('|') + ')($|[^א-ת])');
// "חטיבת אלכסנדרוני 2": a brigade name followed by a house number is a street address
const BRIGADE_STREET = /חטיבת [א-ת"']+ \d+/g;

function isSchool(name) {
    // "חטיבת הנח"ל 30" is a street; petrol stations are named after the street they are on
    if (name.startsWith('תחנת דלק')) return false;
    return SCHOOL_PATTERN.test(name.replace(BRIGADE_STREET, ''));
}

// What kind of point this is, shown to users as one short line: "fuel" (a petrol station),
// "municipal" (a council collection point or street e-waste bin) or "shop".
// rawName is the business name as MAI wrote it, before the clean-up turns
// "עיריית חיפה - מוקד איסוף" into "מוקד איסוף - ...". Category 14 (small electrical items)
// is used only as a sign of a municipal point; the map does not say what else a point takes.
// Checked by hand on a seeded sample of 40 (2026-11-27, see docs/brain/DECISIONS.md).
const FUEL_NAME = /^תחנת דלק|אלונית|דור אלון/;
const MUNICIPAL_NAME = /רשות מקומית|חשמלית|מועצה|עיריית|מוקד איסוף|מרכז איסוף/;
const SHOPS_WITH_ELECTRICAL = /^(מחסני חשמל|איידיגיטל)/; // chains that also take category 14
function pointKind(rawName, categories) {
    if (!rawName) return undefined;
    if (FUEL_NAME.test(rawName)) return 'fuel';
    if (MUNICIPAL_NAME.test(rawName)) return 'municipal';
    if (categories.includes('14') && !SHOPS_WITH_ELECTRICAL.test(rawName)) return 'municipal';
    return 'shop';
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
    'פרדס חנה כרכור': 'פרדס חנה',
    // Found in the "good to great" audit (26 November 2026)
    'ביתר עלית': 'ביתר עילית',
    'באקה אל גארבייה': 'באקה אל-גרבייה',
    'כפר תמרה': 'טמרה',
    'כפר טורעאן': 'טורעאן',
    'כוכב יאיר': 'כוכב יאיר צור יגאל',
    'מועצה אזורית משגב': 'משגב',
    "גוש חלב ג'ש": 'גוש חלב',
    'נוה מבטח': 'נווה מבטח',
    'סילבר': 'כפר סילבר',
    'פעמי תשז': 'פעמי תש"ז',
    'דגניה א': "דגניה א'",
    'הילה': 'מצפה הילה',
    'גרנות': 'גרנות הגליל',
    'שדה תרומות': 'שדי תרומות',
    'צ.צלמון': 'צומת צלמון',
    'א.ת.עמק חפר': 'עמק חפר',
    'מחלף M הדרך': 'מחלף אם הדרך'
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
        .replace(/^קרית /, 'קריית ') // official spelling has two yods
        .replace(/\s*\([^()]*\)$/, ''); // "עובדה (שיכון משפחות)" -> "עובדה"
    return CITY_ALIASES[tidy] || tidy;
}

// A hyphen used as a separator has a space on at least one side ("א - ב", "א -ב").
// A hyphen inside a word ("סופר-פארם") is left alone.
const HYPHEN_SEPARATOR = /\s+-\s*|\s*-\s+/;

// "תל אביב - רשות מקומית - מרכז איסוף - תחנת תברואה" -> "מוקד איסוף - תחנת תברואה"
// The boilerplate parts say nothing about the place, so only the rest is kept.
const MUNICIPAL_BOILERPLATE = ['רשות מקומית', 'מוקד איסוף', 'מרכז איסוף', 'אחראי לפינוי פסולת', 'מוקד איסוף עירוני'];
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

// Decode HTML entities, remove tags, collapse whitespace and drop stray separators at the ends.
// A hyphen at the end after a number is a floor below ground typed right to left ("קומה 1-" = floor -1):
// it is written "(1-)", as MAI writes it elsewhere, so the text does not end in a separator.
function clean(value) {
    return decodeEntities(String(value == null ? '' : value))
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s,.\-]+|[\s,.]+$/g, '')
        .replace(/(\d+)-$/, '($1-)')
        .replace(/[\s\-]+$/, '')
        .trim();
}

// The street names of שפרעם come with a cut-off Arabic copy ("זאהר עומר א - זידאני ظاهر العم") and a
// land-registry parcel instead of a house number ("10262/31", "10301/10302/23/2"). The page is Hebrew
// and a parcel number does not help anyone find the place, so both are removed.
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g;
const PARCEL_NUMBER = /\d{4,}(\/\d+)+/g;
function withoutForeignText(text) {
    return clean(clean(text).replace(ARABIC_SCRIPT, ' '));
}

// "חשמלית - חשמלית - מקס שיין 9" -> "חשמלית - מקס שיין 9". A name without a repeat is returned unchanged.
function withoutRepeatedParts(name) {
    const parts = name.split(HYPHEN_SEPARATOR).map(clean);
    const unique = parts.filter((part, index) => part && parts.indexOf(part) === index);
    return unique.length < parts.length ? unique.join(' - ') : name;
}

// "מוקד איסוף - חשמלית" -> "חשמלית": municipal boilerplate in a place field says nothing about the place
function withoutBoilerplate(text) {
    const parts = text.split(HYPHEN_SEPARATOR).map(clean);
    const kept = parts.filter(part => part && !MUNICIPAL_BOILERPLATE.includes(part));
    return kept.length < parts.length ? kept.join(' - ') : text;
}

// "רחוב הטייסים" -> "הטייסים", at the start of a street, of a comma part or of a name part ("מגה - רחוב דרך הים 26")
const STREET_PREFIX = /(^|,\s*|\s-\s)(רחוב|רח['׳.])\s+(?=\S)/g;
function withoutStreetPrefix(text) {
    return text.replace(STREET_PREFIX, '$1');
}

// Shop names do not need the company form: "שופרסל סטוק בע"מ" -> "שופרסל סטוק"
const COMPANY_SUFFIX = /\s+בע["'״]{1,2}מ(?=$|[\s,])/g;

// True when text ends with part as a whole part of it ("מוקד איסוף - מרכז הטייסים" ends with "מרכז הטייסים")
function endsWithPart(text, part) {
    if (!part || !text.endsWith(part)) return false;
    return text === part || /[\s\-]$/.test(text.slice(0, -part.length));
}

// A name part that is a street with a house number ("סמטת רוזמרין 17"), used when the address has no street
const STREET_WITH_NUMBER = /[א-ת"'׳״] \d{1,3}$/;

// custom_field_data is [{ name, value }, ...] -> { city, street, ... }
function customFields(marker) {
    const fields = {};
    const list = Array.isArray(marker.custom_field_data) ? marker.custom_field_data : [];
    for (const field of list) {
        if (field && field.name) fields[field.name] = withoutForeignText(field.value);
    }
    if (fields.house_number) fields.house_number = clean(fields.house_number.replace(PARCEL_NUMBER, ' '));
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
 * overrides: manual corrections from data_overrides.json, keyed by marker id.
 */
function transformMarker(marker, overrides = {}) {
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
    const rawName = clean((fields.business_name || clean(titleParts[0])).replace(CHAIN_CODE_SUFFIX, '').replace(COMPANY_SUFFIX, ''));
    if (!rawName) return { skip: 'no name' };
    if (isMarkedInactive(rawName)) return { skip: 'marked inactive by MAI' };

    // A marker with no structured fields has "street" or "street, city" as its title
    const hasFields = Boolean(fields.business_name);
    let titleBits = [...new Set(rawName.split(',').map(clean).filter(Boolean))];
    const titleCity = !hasFields && titleBits.length > 1 ? titleBits[titleBits.length - 1] : '';
    titleBits = titleBits.filter(bit => bit !== titleCity);

    const rawCity = clean(override.city || fields.city || titleCity || '');
    const city = normalizeCity(rawCity);
    if (!city) return { skip: 'no city' };

    let street = withoutStreetPrefix(hasFields
        ? joinStreet(fields.street || '', fields.house_number || '')
        : titleBits.join(', '));
    let place = withoutStreetPrefix(withoutBoilerplate(fields.neighborhood || ''));
    // The city is added once at the end, so a part of the street or place that is only the city again
    // says nothing ("המלאכה 2, רעננה, רעננה", "מרכז ביג, כרמיאל", "מודיעין-עילית")
    const isTheCity = text => text === city || text === rawCity || text.replace(/-/g, ' ') === city || CITY_ALIASES[text] === city;
    const withoutCity = text => (text.split(',').some(part => isTheCity(clean(part)))
        ? text.split(',').map(clean).filter(part => part && !isTheCity(part)).join(', ')
        : text);
    street = withoutCity(street);
    place = withoutCity(place);

    let name;
    if (!hasFields) {
        name = 'נקודת איסוף - ' + (street || city);
    } else if (MUNICIPAL_BOILERPLATE.some(b => rawName.includes(b))) {
        name = municipalName(rawName, city, place || street);
    } else {
        name = rawName;
    }
    name = withoutRepeatedParts(withoutStreetPrefix(name));

    // Leave out address parts that only repeat the name, and the place when the name ends with it
    // (unless the place is all the address has besides the city)
    const addressParts = [];
    if (street && street !== name) addressParts.push(street);
    const placeInName = endsWithPart(name, place) && addressParts.length > 0;
    if (place && place !== name && !street.includes(place) && !placeInName) addressParts.push(place);
    // An address that is only the city, for a name that ends with a street and number
    // ("חשמלית - סמטת רוזמרין 17" | "חולון"): the street goes in the address too
    const nameParts = name.split(HYPHEN_SEPARATOR).map(clean);
    if (addressParts.length === 0 && nameParts.length > 1 && STREET_WITH_NUMBER.test(nameParts[nameParts.length - 1])) {
        addressParts.push(nameParts[nameParts.length - 1]);
    }
    addressParts.push(city);

    // Some records have the address typed in as the business name
    // ("ההשראה 2, שלומי"). The same text twice helps nobody, so such a point
    // gets the generic name that nameless points get.
    const withoutCommas = text => text.replace(/,/g, '');
    const nameIsAddress = withoutCommas(name) === withoutCommas(addressParts.join(', '));
    if (nameIsAddress) {
        name = 'נקודת איסוף - ' + (addressParts.slice(0, -1).join(', ') || city);
    }

    // A petrol station's place field names the junction or street it is on ("צומת גולני-בית ספר כדורי")
    const placeIsSchool = !rawName.startsWith('תחנת דלק') && isSchool(place);
    if (isSchool(name) || isSchool(rawName) || placeIsSchool) return { skip: 'school (not open to the public)' };

    return {
        location: {
            id: parseInt(marker.id, 10),
            name: name.substring(0, 200),
            address: addressParts.join(', ').substring(0, 300),
            city: city,
            type: 'store',
            // no kind when there is no business name, or the name is only the address: nothing to tell it by
            ...(hasFields && !nameIsAddress ? { kind: pointKind(rawName, categories) } : {}),
            lat: lat,
            lng: lng,
            hours: 'בדוק באתר' // MAI does not publish opening hours
        },
        // Kept only while building; removed before saving
        detail: place || street,
        addressParts,
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
                // the name now says the place, so the address need not say it again
                const parts = entry.addressParts || [];
                if (parts.length > 2 && parts.includes(entry.detail)) {
                    loc.address = parts.filter(part => part !== entry.detail).join(', ').substring(0, 300);
                }
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
// Limit: this is deliberately forgiving, so it also treats some really different
// streets as one ("רמב"ם" / "רמב"ן", "הרצל" / "הרצל רוזנבלום"). If two such streets
// ever share one coordinate, the group is kept and nobody is warned.
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

// Names this scraper gives to points without a shop name of their own. They are not a chain:
// two municipal points 50 m apart are usually two buildings (a library and a community centre).
const GENERIC_NAMES = ['מוקד איסוף', 'נקודת איסוף'];

// The chain of a shop: the first part of its name ("רמי לוי - תקשורת - קניון עטרות" -> "רמי לוי"),
// and for a fuel station the brand too ("תחנת דלק - פז YELLOW"). '' for a generic name.
function shopChain(name) {
    const parts = name.split(HYPHEN_SEPARATOR).map(clean);
    const chain = parts[0] === 'תחנת דלק' ? parts.slice(0, 2).join(' - ') : parts[0];
    return GENERIC_NAMES.includes(chain) ? '' : chain;
}

// The house number in a street ("הרצל 10" -> "10"). A road number ("כביש 40") is not a house number.
function houseNumber(street) {
    return (street.replace(/כביש \d+/g, '').match(/\d+/g) || []).join(' ');
}

// MAI lists some shops twice: "רמי לוי" and "רמי לוי - תקשורת" (the phone counter inside it), or one
// branch under two names. Two entries are one shop when they have the same shopChain, are at most
// SAME_SHOP_METERS apart, and have the same street (streetKey) or one of them has no house number.
// Two different house numbers are never one shop: אבי סופר at אלנבי 113, 122 and 124 are three shops
// within 23 m. The lower id stays. Returns the entries that stay and the dropped ids ({ id, sameAs }).
function dropSameShop(entries) {
    const byChain = new Map(); // chain -> entries kept so far
    const dropped = [];
    const gone = new Set();
    for (const entry of [...entries].sort((a, b) => a.location.id - b.location.id)) {
        const chain = shopChain(entry.location.name);
        if (!chain) continue;
        if (!byChain.has(chain)) byChain.set(chain, []);
        const number = houseNumber(entry.street);
        const twin = byChain.get(chain).find(other => {
            const otherNumber = houseNumber(other.street);
            if (number && otherNumber && number !== otherNumber) return false;
            if (number && otherNumber && streetKey(entry.street) !== streetKey(other.street)) return false;
            return distanceMeters(entry.location, other.location) <= SAME_SHOP_METERS;
        });
        if (twin) {
            dropped.push({ id: entry.location.id, sameAs: twin.location.id });
            gone.add(entry);
        } else {
            byChain.get(chain).push(entry);
        }
    }
    return { entries: entries.filter(entry => !gone.has(entry)), dropped };
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

// Markers without a usable id go last; transformMarker skips them anyway
function numericId(marker) {
    return marker && /^\d+$/.test(String(marker.id)) ? Number(marker.id) : Infinity;
}

function buildLocations(markers, overrides = {}) {
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
        const result = transformMarker(marker, overrides);
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

    // One shop under two names ("רמי לוי" and "רמי לוי - תקשורת"), before names are told apart
    const { entries: shops, dropped: sameShop } = dropSameShop(unique);

    const { entries: named, renamed, dropped: sameName, farTwins } = disambiguate(shops);
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
            sameShop: sameShop.length,
            stackedGroups: stacked.length,
            stackedPoints: stacked.reduce((sum, group) => sum + group.ids.length, 0)
        },
        dropped: { sameSpot, sameName, sameShop, stacked },
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

// What a refresh changed, as lists of ids: previous and stores are the collection
// points of the old and the new locations.json. "moved" = the pin is more than
// MOVED_METERS from where it was. A count that stays the same can hide all of these.
function changesSince(previous, stores) {
    const before = new Map(previous.map(loc => [loc.id, loc]));
    const nowIds = new Set(stores.map(loc => loc.id));
    const changes = { added: [], removed: [], moved: [], renamed: [], cityChanged: [] };
    for (const loc of stores) {
        const old = before.get(loc.id);
        if (!old) {
            changes.added.push(loc.id);
            continue;
        }
        if (distanceMeters(old, loc) > MOVED_METERS) changes.moved.push(loc.id);
        if (old.name !== loc.name) changes.renamed.push(loc.id);
        if (old.city !== loc.city) changes.cityChanged.push(loc.id);
    }
    for (const loc of previous) {
        if (!nowIds.has(loc.id)) changes.removed.push(loc.id);
    }
    for (const list of Object.values(changes)) list.sort((a, b) => a - b);
    return changes;
}

// Returns the reason not to save, or null. A large change may be real (MAI
// re-imported its map), but a person should look at it first.
function checkChanges(changes, previousCount, force) {
    const gone = changes.removed.length + changes.moved.length;
    if (!force && gone > previousCount * MAX_SHARE_REMOVED_OR_MOVED) {
        return gone + ' of ' + previousCount + ' points were removed or moved more than ' + MOVED_METERS +
            ' m (over 5 %). Check the Changes lines above; if the change is real, run again with --force.';
    }
    return null;
}

// Returns the reason not to save, or null. Overrides are keyed by MAI marker id,
// so when many stop matching, MAI has probably given its markers new ids and
// every known-wrong pin would come back.
function checkOverrides(unmatchedCount, overrideCount, force) {
    if (!force && unmatchedCount > overrideCount * MAX_SHARE_OVERRIDES_UNMATCHED) {
        return unmatchedCount + ' of ' + overrideCount + ' overrides match no MAI marker - ' +
            'MAI may have renumbered its markers. If that is expected, run again with --force.';
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
 *   force  save even when the count fell under 90 % of the previous file, over 5 % of
 *          its points were removed or moved, or over 10 % of the overrides match nothing
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
    const overrides = loadOverrides(files.overrides);
    const built = buildLocations(markers, overrides);
    const { locations: stores, skipped, stats, dropped, farTwins, overridesUnmatched } = built;
    console.log('Skipped:', skipped);
    console.log('Duplicates removed: ' + (stats.sameSpot + stats.dropped + stats.sameShop) + ', names disambiguated: ' + stats.renamed);
    for (const d of [...dropped.sameSpot, ...dropped.sameName]) {
        console.log('  duplicate ' + d.id + ' dropped, same point as ' + d.sameAs);
    }
    for (const d of dropped.sameShop) {
        console.log('  duplicate ' + d.id + ' dropped, same shop as ' + d.sameAs);
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
    const previousStores = previous ? previous.filter(loc => loc.type === 'store') : null;
    let problem = checkCount(stores.length, previousStores && previousStores.length, options.force);
    if (!problem) problem = checkOverrides(overridesUnmatched.length, Object.keys(overrides).length, options.force);

    // What changed since the previous file (null when there is none to compare with)
    let changes = null;
    if (previousStores) {
        const lists = changesSince(previousStores, stores);
        const counts = {};
        for (const [kind, ids] of Object.entries(lists)) counts[kind] = ids.length;
        changes = { counts, ...lists };
        console.log('Changes since the previous locations.json: ' +
            Object.entries(counts).map(([kind, count]) => kind + ' ' + count).join(', '));
        for (const [kind, ids] of Object.entries(lists)) {
            if (ids.length > 0) {
                console.log('  ' + kind + ': ' + ids.slice(0, 20).join(', ') +
                    (ids.length > 20 ? ' ... and ' + (ids.length - 20) + ' more (all in data_meta.json)' : ''));
            }
        }
        if (!problem) problem = checkChanges(lists, previousStores.length, options.force);
    }
    if (problem) throw new Error(problem + ' locations.json was NOT changed.');

    const meta = {
        source: source,
        fetched_at: fetchedAt.toISOString(),
        raw_markers: markers.length,
        kept: stores.length,
        skipped: skipped,
        duplicates_removed: stats.sameSpot + stats.dropped + stats.sameShop,
        stacked_dropped: stats.stackedPoints,
        overrides_unmatched: overridesUnmatched.map(Number),
        changes: changes
    };
    writeJsonAtomic(files.output, { locations });
    writeJsonAtomic(files.meta, meta);
    console.log('Saved ' + locations.length + ' locations (' + stores.length + ' collection points, ' + facilities.length + ' facilities)');

    const kinds = {};
    stores.forEach(loc => { const kind = loc.kind || '(none)'; kinds[kind] = (kinds[kind] || 0) + 1; });
    console.log('By kind:', kinds);
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
    transformMarker, buildLocations, pointKind, normalizeCity, municipalName, clean,
    isMarkedInactive, isSchool, joinStreet, parseCoordinate, distanceMeters, streetKey, sameStreet, dropStacked,
    disambiguate, checkCount, parseArgs, run, changesSince, shopChain, houseNumber,
    withoutRepeatedParts, withoutBoilerplate, ARABIC_SCRIPT, PARCEL_NUMBER
};
