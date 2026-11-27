/**
 * Tests for scraper.js - these run the REAL functions (no copies).
 * Uses Node's built-in test runner, so there is nothing to install.
 *
 * Usage: node --test test-scraper.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const scraper = require('./scraper.js');
const { transformMarker, buildLocations, pointKind, normalizeCity, municipalName } = scraper;
const {
    clean, isMarkedInactive, isSchool, joinStreet, parseCoordinate, distanceMeters,
    streetKey, sameStreet, checkCount, parseArgs, run, changesSince, shopChain
} = scraper;

// A marker shaped like the real MAI API response
function marker(overrides = {}, fields = {}) {
    const custom = { city: 'חיפה', street: 'הרצל', house_number: '10', business_name: 'באג', ...fields };
    return {
        id: '500001',
        map_id: '5',
        category: '12',
        lat: '32.8',
        lng: '35.0',
        address: null,
        title: 'באג<br><span style="font-size: 16px;">הרצל 10, חיפה.</span>',
        custom_field_data: Object.entries(custom)
            .filter(([, value]) => value !== undefined)
            .map(([name, value]) => ({ name, value })),
        ...overrides
    };
}

test('transformMarker builds a clean location from structured fields', () => {
    const { location } = transformMarker(marker());
    assert.deepStrictEqual(location, {
        id: 500001,
        name: 'באג',
        address: 'הרצל 10, חיפה',
        city: 'חיפה',
        type: 'store',
        kind: 'shop',
        lat: 32.8,
        lng: 35.0,
        hours: 'בדוק באתר'
    });
});

test('transformMarker never lets HTML from the title into the name', () => {
    const { location } = transformMarker(marker());
    assert.ok(!location.name.includes('<'));
    assert.ok(!location.address.includes('<'));
});

test('transformMarker rejects markers that must not reach the map', () => {
    assert.strictEqual(transformMarker(marker({ map_id: '2' })).skip, 'old map');
    assert.strictEqual(transformMarker(marker({ category: '14' })).skip, 'not a battery point');
    assert.strictEqual(transformMarker(marker({ lat: '' })).skip, 'bad coordinates');
    assert.strictEqual(transformMarker(marker({ lat: null, lng: null })).skip, 'bad coordinates');
    assert.strictEqual(transformMarker(marker({ lat: '0', lng: '0' })).skip, 'outside Israel bounds');
    assert.strictEqual(transformMarker(marker({ lat: '36.7', lng: '-119.4' })).skip, 'outside Israel bounds');
    assert.strictEqual(transformMarker(marker({}, { business_name: 'טיב טעם - לא פעיל' })).skip, 'marked inactive by MAI');
    assert.strictEqual(transformMarker(marker({ title: '' }, { business_name: undefined })).skip, 'no name');
});

test('transformMarker accepts a battery category inside a list', () => {
    assert.ok(transformMarker(marker({ category: '12,14,15' })).location);
});

test('generic municipal names become "מוקד איסוף - <place>"', () => {
    const { location } = transformMarker(marker({}, {
        business_name: 'רשות מקומית - מוקד איסוף',
        neighborhood: 'מתנ"ס רעות'
    }));
    assert.strictEqual(location.name, 'מוקד איסוף - מתנ"ס רעות');
    assert.strictEqual(location.kind, 'municipal');
    // the name already ends with the place, so the address does not repeat it ("good to great" audit)
    assert.strictEqual(location.address, 'הרצל 10, חיפה');
});

test('municipalName strips boilerplate, the city and repeats', () => {
    assert.strictEqual(
        municipalName('תל אביב - רשות מקומית - מרכז איסוף - מוקד איסוף - תחנת תברואה', 'תל אביב', 'x'),
        'מוקד איסוף - תחנת תברואה');
    assert.strictEqual(municipalName('רשות מקומית - מוקד איסוף', 'חיפה', 'הרצל 10'), 'מוקד איסוף - הרצל 10');
    assert.strictEqual(municipalName('רשות מקומית - מרכז איסוף', 'חיפה', ''), 'מוקד איסוף - חיפה');
});

test('normalizeCity gives each city one spelling', () => {
    assert.strictEqual(normalizeCity('תל־אביב–יפו'), 'תל אביב');
    assert.strictEqual(normalizeCity('תל אביב-יפו'), 'תל אביב');
    assert.strictEqual(normalizeCity('קרית גת'), 'קריית גת');
    assert.strictEqual(normalizeCity('פתח תקוה'), 'פתח תקווה');
    assert.strictEqual(normalizeCity('מועצה אזורית לכיש - שדה דוד'), 'שדה דוד');
    assert.strictEqual(normalizeCity('מ.מ. ירכא'), 'ירכא');
    assert.strictEqual(normalizeCity("ג'סר א-זרקא"), "ג'סר א-זרקא"); // hyphen inside a name is kept
});

test('a marker without a city is skipped unless data_overrides.json gives it one', () => {
    const bare = marker({ title: 'ויצמן 20', custom_field_data: [] });
    assert.strictEqual(transformMarker(bare).skip, 'no city');
    const { location } = transformMarker(bare, { 500001: { city: 'חיפה' } });
    assert.strictEqual(location.city, 'חיפה');
    assert.strictEqual(location.name, 'נקודת איסוף - ויצמן 20');
});

test('the previous locations.json does not change what is built', async (t) => {
    const dir = tempDir(t);
    const bare = marker({ id: '400500', lat: '31.5', lng: '34.9', title: 'ויצמן 20', custom_field_data: [] });
    const input = writeRaw(dir, [...manyMarkers(1200), bare]);
    // a previous file that knows a city for the coordinate of the city-less marker
    const previous = { locations: [{ id: 400500, name: 'נקודת איסוף - ויצמן 20', address: 'ויצמן 20, חיפה', city: 'חיפה',
        type: 'store', lat: 31.5, lng: 34.9, hours: 'בדוק באתר' }] };
    fs.writeFileSync(path.join(dir, 'locations.json'), JSON.stringify(previous));
    const meta = await run({ dir, input, force: true });
    assert.strictEqual(meta.skipped['no city'], 1);
    const withPrevious = fs.readFileSync(path.join(dir, 'locations.json'), 'utf8');

    fs.rmSync(path.join(dir, 'locations.json'));
    await run({ dir, input });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'locations.json'), 'utf8'), withPrevious);
});

test('data_overrides.json entries fix a city or exclude a point', () => {
    const fixed = transformMarker(marker(), { 500001: { city: 'נשר' } });
    assert.strictEqual(fixed.location.city, 'נשר');
    assert.strictEqual(fixed.location.address, 'הרצל 10, נשר');
    const excluded = transformMarker(marker(), { 500001: { exclude: true } });
    assert.strictEqual(excluded.skip, 'excluded by data_overrides.json');
});

test('buildLocations removes repeats and tells same-name branches apart', () => {
    const markers = [
        marker({ id: '1' }),
        marker({ id: '2' }),                                              // exact repeat of 1
        marker({ id: '3', lat: '32.81' }, { street: 'הנביאים', house_number: '5' }), // another branch
        marker({ id: '4', map_id: '2' })                                  // skipped
    ];
    const { locations, skipped } = buildLocations(markers);
    assert.deepStrictEqual(locations.map(l => l.name), ['באג - הרצל 10', 'באג - הנביאים 5']);
    assert.strictEqual(skipped['old map'], 1);
    const keys = locations.map(l => l.name + '|' + l.city);
    assert.strictEqual(new Set(keys).size, keys.length);
});

test('pointKind: fuel = name starts "תחנת דלק" or has אלונית / דור אלון', () => {
    assert.strictEqual(pointKind('תחנת דלק - פז YELLOW', ['12']), 'fuel');
    assert.strictEqual(pointKind('סופר אלונית - רמת השרון', ['12']), 'fuel');
    assert.strictEqual(pointKind('דור אלון - צומת גולני', ['12']), 'fuel');
    // fuel wins over category 14
    assert.strictEqual(pointKind('תחנת דלק - סונול', ['12', '14']), 'fuel');
    // "תחנת דלק" in the middle of a name is not enough
    assert.strictEqual(pointKind('קפה ליד תחנת דלק', ['12']), 'shop');
});

test('pointKind: municipal = a municipal word in the name, or category 14 except two electrical chains', () => {
    for (const name of ['רשות מקומית - מוקד איסוף', 'חשמלית - מקס שיין 9', 'מועצה אזורית גזר',
        'עיריית חולון - מתנ"ס', 'תל אביב - מוקד איסוף', 'מרכז איסוף עירוני']) {
        assert.strictEqual(pointKind(name, ['12']), 'municipal', name);
    }
    assert.strictEqual(pointKind('מתנ"ס רעות', ['12', '14']), 'municipal');
    assert.strictEqual(pointKind('מתנ"ס רעות', ['12', '14', '15']), 'municipal');
    // the two shop chains that also take small electrical items stay shops
    assert.strictEqual(pointKind('מחסני חשמל - חולון', ['12', '14']), 'shop');
    assert.strictEqual(pointKind('איידיגיטל - קניון רמת אביב', ['12', '14', '15']), 'shop');
});

test('pointKind: shop = the rest; no name, no kind', () => {
    assert.strictEqual(pointKind('באג', ['12']), 'shop');
    assert.strictEqual(pointKind('רמי לוי - תקשורת', ['12']), 'shop');
    assert.strictEqual(pointKind('', ['12', '14']), undefined);
});

test('transformMarker sets kind from the raw business name, before the name is cleaned', () => {
    // the cleaned name no longer says "רשות מקומית", the raw one does
    const city = transformMarker(marker({}, { business_name: 'רשות מקומית - חשמלית', neighborhood: 'מתנ"ס רעות' })).location;
    assert.strictEqual(city.name, 'מוקד איסוף - חשמלית');
    assert.strictEqual(city.kind, 'municipal');
    // a business name that is only the address (real: 343467 "ההשראה 2, שלומי") says nothing about the point:
    // it gets the generic name that nameless points get, and no kind, like them
    const typed = transformMarker(marker({}, { business_name: 'הרצל 10, חיפה' })).location;
    assert.strictEqual(typed.name, 'נקודת איסוף - הרצל 10');
    assert.ok(!('kind' in typed));
    assert.strictEqual(transformMarker(marker({ category: '12,14' }, { business_name: 'מתנ"ס רעות' })).location.kind, 'municipal');
    assert.strictEqual(transformMarker(marker({ category: '12,14' }, { business_name: 'מחסני חשמל' })).location.kind, 'shop');
    assert.strictEqual(transformMarker(marker({}, { business_name: 'תחנת דלק - דלק' })).location.kind, 'fuel');
    assert.strictEqual(transformMarker(marker()).location.kind, 'shop');
});

test('a marker with no business name has no kind key and no chain key', () => {
    // real: 343977, only street and house number, title "אבן גבירול 73"
    const bare = marker({ title: 'אבן גבירול 73' }, { business_name: undefined, city: 'תל אביב', street: 'אבן גבירול', house_number: '73' });
    const { location } = transformMarker(bare);
    assert.strictEqual(location.name, 'נקודת איסוף - אבן גבירול 73');
    assert.ok(!('kind' in location));
    assert.ok(!('chain' in location));
});

// ---------------------------------------------------------------------------
// Scraper hardening (design: docs/designs/launch-readiness.md, slice B-1)
// ---------------------------------------------------------------------------

test('names that MAI marked as closed or duplicate are skipped', () => {
    // the five records from the audit: ids 346701, 346706, 346714, 346738, 346657
    assert.ok(isMarkedInactive('שדרות -בית ספר מדעים אלון - מוקד איסוף - כפל'));
    assert.ok(isMarkedInactive('שדרות - בית ספר גיל רבין - מוקד איסוף -כפל של מוקד איסוף'));
    assert.ok(isMarkedInactive('שדרות -בית ספר לאומנויות שקמים מעוז - מוקד איסוף- כפל'));
    assert.ok(isMarkedInactive('מר וגברת פון - שדרות בנימין 23 - נתניה - סניף נסגר'));
    // the old patterns still work
    assert.ok(isMarkedInactive('אמפמ AMPM - משלוחים - כפול לא פעיל'));
    assert.ok(isMarkedInactive('רמת גן בתי הספר - מכל"ל - כפול במערכת'));
    assert.ok(isMarkedInactive('קרביץ - קניון מודיעין - כפילות 323383'));
    assert.ok(isMarkedInactive('עיריית אופקים - בית ספר עמל פסגות (בוטל)'));
    assert.strictEqual(
        transformMarker(marker({}, { business_name: 'בית ספר אלון - מוקד איסוף - כפל' })).skip,
        'marked inactive by MAI');
});

test('"כפול" and "כפל" inside a longer word do not mark a point as closed', () => {
    assert.ok(!isMarkedInactive('מכפולת'));
    assert.ok(!isMarkedInactive('מכולת מכפולת הזהב'));
    assert.ok(!isMarkedInactive('מכפלה'));
    assert.ok(!isMarkedInactive('סופר-פארם'));
    assert.ok(transformMarker(marker({}, { business_name: 'מכפולת' })).location);
});

test('normalizeCity: one spelling for the localities found in the audit', () => {
    const expected = {
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
        'זבולון - כבר המכבי': 'כפר המכבי',
        'עמק חפר - כמכמורת': 'מכמורת',
        'שדה עוזיה': 'שדה עוזיהו'
    };
    for (const [from, to] of Object.entries(expected)) {
        assert.strictEqual(normalizeCity(from), to, from);
    }
    // names that only look similar are left alone
    assert.strictEqual(normalizeCity('נצרת'), 'נצרת');
    assert.strictEqual(normalizeCity('נתניה'), 'נתניה');
    assert.strictEqual(normalizeCity('מעלות תרשיחא'), 'מעלות תרשיחא');
    assert.strictEqual(normalizeCity('אור יהודה'), 'אור יהודה');
});

test('normalizeCity: a town with a two-part name is not cut in half', () => {
    assert.strictEqual(normalizeCity('תל אביב - יפו'), 'תל אביב');
    assert.strictEqual(normalizeCity('תל אביב -יפו'), 'תל אביב');
    assert.strictEqual(normalizeCity('פרדס חנה - כרכור'), 'פרדס חנה');
    assert.strictEqual(normalizeCity('פרדס חנה-כרכור'), 'פרדס חנה');
    assert.strictEqual(normalizeCity('פרדס חנה כרכור'), 'פרדס חנה');
    assert.strictEqual(normalizeCity('פרדס חנה'), 'פרדס חנה');
});

test('normalizeCity drops a leading "קיבוץ" or "מושב"', () => {
    assert.strictEqual(normalizeCity('קיבוץ שפיים'), 'שפיים');
    assert.strictEqual(normalizeCity('מושב רגבה'), 'רגבה');
    assert.strictEqual(normalizeCity('מועצה אזורית מגידו - קיבוץ מגידו'), 'מגידו');
    assert.strictEqual(normalizeCity('יוקנעם המושבה'), 'יוקנעם'); // "המושבה" is not the prefix "מושב "
});

test('joinStreet: no house number 0, no number written twice', () => {
    assert.strictEqual(joinStreet('הרצל', '10'), 'הרצל 10');
    assert.strictEqual(joinStreet('מרכז מגה אור', '0'), 'מרכז מגה אור');
    assert.strictEqual(joinStreet('הרצל 97', '97'), 'הרצל 97');
    assert.strictEqual(joinStreet('הרצל', ''), 'הרצל');
    assert.strictEqual(joinStreet('', '5'), '5');
    assert.strictEqual(joinStreet('הרצל 197', '97'), 'הרצל 197 97'); // 197 is not 97
});

test('address cleanup inside transformMarker', () => {
    const zero = transformMarker(marker({}, { street: 'מרכז מגה אור', house_number: '0' })).location;
    assert.strictEqual(zero.address, 'מרכז מגה אור, חיפה');
    const doubled = transformMarker(marker({}, { street: 'הרצל 97', house_number: '97' })).location;
    assert.strictEqual(doubled.address, 'הרצל 97, חיפה');
    const cityTwice = transformMarker(marker({}, { street: 'המלאכה', house_number: '2', neighborhood: 'חיפה' })).location;
    assert.strictEqual(cityTwice.address, 'המלאכה 2, חיפה');
    // the repeated part is spelled like MAI's city, before our spelling fix
    const oldSpelling = transformMarker(marker({}, { city: 'זכרון יעקב', street: 'זכרון יעקב', house_number: undefined })).location;
    assert.strictEqual(oldSpelling.address, 'זיכרון יעקב');
});

test('the chain-internal branch code is removed from the name', () => {
    const { location } = transformMarker(marker({}, { business_name: 'מגה קניון חדרה - חוויה ואיכות בעיר-3570/90' }));
    assert.strictEqual(location.name, 'מגה קניון חדרה');
    assert.strictEqual(location.kind, 'shop');
});

test('a business name that is only the address becomes "נקודת איסוף - <street>"', () => {
    // real records: 343467 "ההשראה 2, שלומי", 345324 (place only), 344752 (city field holds the address)
    const a = transformMarker(marker({}, { city: 'שלומי', street: 'ההשראה', house_number: '2', business_name: 'ההשראה 2, שלומי' })).location;
    assert.strictEqual(a.name, 'נקודת איסוף - ההשראה 2');
    assert.strictEqual(a.address, 'ההשראה 2, שלומי');
    const b = transformMarker(marker({}, {
        city: 'ירושלים', street: undefined, house_number: undefined,
        neighborhood: 'מרכז מסחרי נווה יעקב', business_name: 'מרכז מסחרי נווה יעקב, ירושלים'
    })).location;
    assert.strictEqual(b.name, 'נקודת איסוף - מרכז מסחרי נווה יעקב');
    const c = transformMarker(marker({}, {
        city: 'פנחס לבון 18 נתניה', street: 'פנחס לבון', house_number: '18', business_name: 'פנחס לבון 18, נתניה'
    })).location;
    assert.strictEqual(c.name, 'נקודת איסוף - פנחס לבון 18');
    assert.strictEqual(c.city, 'נתניה');
    // a real name is left alone
    assert.strictEqual(transformMarker(marker()).location.name, 'באג');
});

test('streetKey ignores numbers, quotes and street words', () => {
    assert.strictEqual(streetKey("רח' הרצל 10"), 'הרצל');
    assert.strictEqual(streetKey('שדרות יגאל אלון 3'), streetKey('יגאל אלון 3'));
    assert.strictEqual(streetKey('איינשטיין 40'), streetKey('אינשטיין 40'));
    assert.strictEqual(streetKey("ז'בוטינסקי 37"), streetKey('זבוטינסקי 21'));
    assert.strictEqual(streetKey('ביל"ו 2'), streetKey('בילו 2'));
    assert.notStrictEqual(streetKey('הרצל 10'), streetKey('ויצמן 10'));
    assert.strictEqual(streetKey(''), '');
});

test('stacked coordinates: different streets on one coordinate are all dropped and logged', () => {
    const markers = [
        marker({ id: '11' }, { business_name: 'חנות א', street: 'הרצל', house_number: '10' }),
        marker({ id: '12' }, { business_name: 'חנות ב', street: 'ויצמן', house_number: '3' }),
        marker({ id: '13' }, { business_name: 'חנות ג', street: 'ויצמן', house_number: '3' }),
        marker({ id: '14', lat: '32.9' }, { business_name: 'חנות ד' }) // alone on its coordinate
    ];
    const { locations, stats, dropped } = buildLocations(markers);
    assert.deepStrictEqual(locations.map(l => l.id), [14]);
    assert.deepStrictEqual(dropped.stacked, [{ coord: '32.8,35', ids: [11, 12, 13] }]);
    assert.strictEqual(stats.stackedGroups, 1);
    assert.strictEqual(stats.stackedPoints, 3);
});

test('stacked coordinates: a shopping centre (same street, different shops) is kept', () => {
    const markers = [
        marker({ id: '21' }, { business_name: 'באג', street: 'אינשטיין', house_number: '40', neighborhood: 'קניון רמת אביב' }),
        marker({ id: '22' }, { business_name: 'טיב טעם', street: 'איינשטיין', house_number: '40', neighborhood: 'קניון רמת אביב' }),
        marker({ id: '23' }, { business_name: 'קרביץ', street: "רח' איינשטיין", house_number: '40' })
    ];
    const { locations, dropped } = buildLocations(markers);
    assert.deepStrictEqual(locations.map(l => l.id), [21, 22, 23]);
    assert.deepStrictEqual(dropped.stacked, []);
});

test('stacked coordinates: one street written short and long is still one street', () => {
    const markers = [
        marker({ id: '25' }, { business_name: 'באג', street: 'אבא הלל סילבר', house_number: '301' }),
        marker({ id: '26' }, { business_name: 'קרביץ', street: 'אבא הלל', house_number: '301' }),
        marker({ id: '27' }, { business_name: 'גולף', street: 'אבא הלל', house_number: '301' })
    ];
    const { locations, dropped } = buildLocations(markers);
    assert.deepStrictEqual(locations.map(l => l.id), [25, 26, 27]);
    assert.deepStrictEqual(dropped.stacked, []);
});

test('sameStreet: one street spelled two ways is one street', () => {
    const same = (a, b) => sameStreet(streetKey(a), streetKey(b));
    // real pairs that share one coordinate in the MAI data (ids in the comments)
    assert.ok(same('דיזינגוף 50', 'דיזנגוף 50'));             // 343312 / 343456  one letter
    assert.ok(same('דוד סחרוב 21', 'סחרוב 21'));              // 343684 / 344598  first name left out
    assert.ok(same('יהודה לוי 1', 'יהודה הלוי 1'));           // 344258 / 345147  leading ה
    assert.ok(same('הרו"אה 2', 'הרא"ה 2'));                   // 343840 / 346781
    assert.ok(same('שדרות דרום 3', 'דרך הדרום 3'));           // 343926 / 343957
    assert.ok(same('יהשוע חנקין 14', 'יהושוע חנקין 14'));     // 345190 / 345380
    assert.ok(same('נפחא 25', 'נפחה 25'));                    // 346326 / 346539
    assert.ok(same('שדרות דוד טוביהו 125', 'שדרות טוביהו 25')); // 346327 / 346548
    assert.ok(same('מלך חסן השני', 'שדרות המלך חסן 1'));      // 343753 / 344068
    assert.ok(same('פייר קנינג 2', 'פייר קינג 26'));           // 344877 / 345039
    assert.ok(same('התע"ש פינת אפעל', "תעש' 2"));             // 345554 / 345755
    assert.ok(same('זבוטיסקי 5', "ז'בוטינסקי 5"));            // 346136 / 346565
    assert.ok(same('אבא הלל סילבר 301', 'אבא הלל 301'));
    assert.ok(same('הרצל 10', 'הרצל 10'));
    // different streets stay different
    assert.ok(!same('הרצל 10', 'ויצמן 10'));
    assert.ok(!same('תלמוד בבלי 17', 'פינת נורדאו 195'));     // 342659 / 343789
    assert.ok(!same('המנור 2', 'הפלד 7'));                    // 342660 / 344257
    assert.ok(!same('בית ספר יסודי', 'בית ספר תיכון'));
    assert.ok(!same('דוד המלך 1', 'דוד רמז 1'));              // one shared word is not enough
    assert.ok(!same('גן 1', 'גת 1'));                         // too short to allow a different letter
    assert.ok(!same('הדר 1', 'הדס 1'));
});

test('streetKey keeps a road number: כביש 40 is not כביש 4', () => {
    const same = (a, b) => sameStreet(streetKey(a), streetKey(b));
    assert.strictEqual(streetKey('כביש 40'), 'כביש 40');
    assert.ok(!same('כביש 40', 'כביש 4'));
    assert.ok(!same('כביש 443', 'כביש 444'));                 // numbers are never "one letter apart"
    assert.ok(same('כביש 40', 'כביש 40, בין ביל"ו לרמלה'.split(',')[0]));
    assert.strictEqual(streetKey('הרצל 40'), 'הרצל');         // a house number is still ignored
    const { dropped } = buildLocations([
        marker({ id: '81' }, { business_name: 'תחנה א', street: 'כביש 40', house_number: undefined }),
        marker({ id: '82' }, { business_name: 'תחנה ב', street: 'כביש 4', house_number: undefined })
    ]);
    assert.deepStrictEqual(dropped.stacked[0].ids, [81, 82]);
});

test('stacked coordinates: real groups that must be kept (one street, spelled differently)', () => {
    const municipal = 'רשות מקומית - מוקד איסוף';
    const markers = [
        // Dizengoff Center, Tel Aviv
        marker({ id: '343312' }, { city: 'תל אביב', street: 'דיזינגוף', house_number: '50', neighborhood: 'דיזינגוף סנטר', business_name: 'איידיגיטל' }),
        marker({ id: '343444' }, { city: 'תל אביב', street: 'דיזינגוף', house_number: '50', neighborhood: 'דיזנגוף סנטר', business_name: 'טויס.אר.אס' }),
        marker({ id: '343456' }, { city: 'תל אביב', street: 'דיזנגוף', house_number: '50', neighborhood: 'דיזנגוף סנטר, קומה מינוס 1,', business_name: 'באג' }),
        // קניון הזהב, Rishon LeZion
        marker({ id: '343684', lat: '31.989917' }, { city: 'ראשון לציון', street: 'דוד סחרוב', house_number: '21', neighborhood: 'קניון הזהב', business_name: 'קרביץ' }),
        marker({ id: '344598', lat: '31.989917' }, { city: 'ראשון לציון', street: 'סחרוב', house_number: '21', business_name: 'באג' }),
        // BIG Tiberias
        marker({ id: '344258', lat: '32.790511' }, { city: 'טבריה', street: 'יהודה לוי', house_number: '1', neighborhood: 'גני הלוטוס', business_name: 'שקם אלקטריק' }),
        marker({ id: '345147', lat: '32.790511' }, { city: 'טבריה', street: 'יהודה הלוי', house_number: '1', neighborhood: 'מתחם ביג טבריה', business_name: 'אייס קנה ובנה' }),
        marker({ id: '345168', lat: '32.790511' }, { city: 'טבריה', street: 'יהודה הלוי', house_number: '1', neighborhood: 'מתחם ביג טבריה', business_name: 'באג' }),
        // a village: nobody has a street, everybody is in כפר ג'וליס (two coordinates).
        // The real records are schools, which are now skipped, so the places are renamed here.
        marker({ id: '345844', lat: '32.942235' }, { city: "כפר ג'וליס", street: undefined, house_number: undefined, neighborhood: 'מועדון נוער', business_name: 'רשות מקומית - מרכז איסוף' }),
        marker({ id: '345846', lat: '32.942235' }, { city: "כפר ג'וליס", street: undefined, house_number: undefined, neighborhood: 'מרכז קהילתי', business_name: municipal }),
        marker({ id: '345845', lat: '32.945048' }, { city: "כפר ג'וליס", street: undefined, house_number: undefined, neighborhood: 'ספרייה', business_name: 'רשות מקומית - מרכז איסוף' }),
        marker({ id: '345848', lat: '32.945048' }, { city: "כפר ג'וליס", street: undefined, house_number: undefined, business_name: municipal })
    ];
    const { locations, dropped } = buildLocations(markers);
    assert.deepStrictEqual(dropped.stacked, []);
    assert.strictEqual(locations.length, markers.length);
});

test('stacked coordinates: real groups that must still be dropped', () => {
    const municipal = 'רשות מקומית - מוקד איסוף';
    const none = { street: undefined, house_number: undefined };
    const markers = [
        // three villages on one coordinate (nobody has a street, but the cities differ)
        marker({ id: '343334', lat: '31.449' }, { ...none, city: 'שוקדה', business_name: municipal }),
        marker({ id: '343471', lat: '31.449' }, { ...none, city: 'שיבולים', business_name: municipal }),
        marker({ id: '343472', lat: '31.449' }, { ...none, city: 'שובה', business_name: municipal }),
        // Tel Aviv city-centre fallback: five different addresses
        marker({ id: '342659', lat: '32.085299' }, { city: 'תל אביב', street: 'תלמוד בבלי', house_number: '17', business_name: 'מגה' }),
        marker({ id: '343317', lat: '32.085299' }, { ...none, city: 'תל אביב', neighborhood: 'חניון מוזיאון ישראל', business_name: 'תחנת דלק - פז YELLOW' }),
        marker({ id: '343439', lat: '32.085299' }, { city: 'תל אביב', street: 'חניון מוזיאון ישראל', house_number: undefined, business_name: 'מוזיאון ישראל' }),
        marker({ id: '343447', lat: '32.085299' }, { city: 'תל אביב', street: 'הרברט סמואל טיילת ת"א', house_number: undefined, neighborhood: 'בתוך חניון גן לונדון', business_name: 'תחנת דלק - דלק מנטה' }),
        marker({ id: '343789', lat: '32.085299' }, { city: 'תל אביב', street: 'פינת נורדאו', house_number: '195', business_name: 'AM.PM' }),
        // Jerusalem: one real street and two places that are somewhere else
        marker({ id: '344860', lat: '31.768319' }, { city: 'ירושלים', street: 'דרך אגודת ספורט בית"ר', house_number: '1', neighborhood: 'קניון מלחה', business_name: 'איידיגיטל' }),
        marker({ id: '345044', lat: '31.768319' }, { ...none, city: 'ירושלים', neighborhood: 'א.ת תלפיות', business_name: 'תחנת דלק - פז YELLOW' }),
        marker({ id: '345049', lat: '31.768319' }, { ...none, city: 'ירושלים', neighborhood: 'גבעונים גבעת זאב', business_name: 'תחנת דלק - דלק מנטה' }),
        // two real, different streets in one village (פסוטה) - a street is a claim we can check
        marker({ id: '344213', lat: '33.046997' }, { city: 'פסוטה', street: 'יחיא אל עדי', house_number: undefined, neighborhood: 'מתנ"ס', business_name: municipal }),
        marker({ id: '344505', lat: '33.046997' }, { city: 'פסוטה', street: 'אל אחטל', house_number: undefined, neighborhood: 'מועצה מקומית', business_name: municipal })
    ];
    const { locations, dropped } = buildLocations(markers);
    assert.deepStrictEqual(locations, []);
    assert.deepStrictEqual(dropped.stacked.map(g => g.ids), [
        [342659, 343317, 343439, 343447, 343789],
        [343334, 343471, 343472],
        [344213, 344505],
        [344860, 345044, 345049]
    ]);
});

test('stacked coordinates: a point without a street', () => {
    // same city: "somewhere in חיפה" does not contradict "הרצל 10, חיפה" -> kept
    const sameCity = buildLocations([
        marker({ id: '31' }, { business_name: 'חנות א' }),
        marker({ id: '32' }, { business_name: 'חנות ב', street: undefined, house_number: undefined })
    ]);
    assert.deepStrictEqual(sameCity.locations.map(l => l.id), [31, 32]);
    assert.strictEqual(sameCity.locations[1].address, 'חיפה');

    // two villages on one coordinate, neither has a street -> dropped
    const twoVillages = buildLocations([
        marker({ id: '33' }, { business_name: 'מוקד א', city: 'שוקדה', street: undefined, house_number: undefined }),
        marker({ id: '34' }, { business_name: 'מוקד ב', city: 'שובה', street: undefined, house_number: undefined })
    ]);
    assert.deepStrictEqual(twoVillages.locations, []);
    assert.deepStrictEqual(twoVillages.dropped.stacked[0].ids, [33, 34]);

    // no street in one city, a street in another -> dropped
    const mixed = buildLocations([
        marker({ id: '35' }, { business_name: 'מוקד א', city: 'רבדים', street: undefined, house_number: undefined }),
        marker({ id: '36' }, { business_name: 'מוקד ב', city: 'שדה יואב', street: 'מזכירות', house_number: undefined })
    ]);
    assert.deepStrictEqual(mixed.locations, []);
});

test('stacked coordinates: same chain name does not hide two different addresses', () => {
    // real case: ids 344484 and 345700, both "גוד פארם", one pin, two cities
    const { locations, stats, dropped } = buildLocations([
        marker({ id: '41' }, { business_name: 'גוד פארם', city: 'פתח תקווה', street: 'רוטשילד', house_number: '57' }),
        marker({ id: '42' }, { business_name: 'גוד פארם', city: 'כרמיאל', street: 'מעלה כמון', house_number: '9' })
    ]);
    assert.deepStrictEqual(locations, []);
    assert.strictEqual(stats.sameSpot, 0);
    assert.deepStrictEqual(dropped.stacked[0].ids, [41, 42]);
});

test('distanceMeters is a haversine distance', () => {
    const a = { lat: 32.0, lng: 34.8 };
    assert.strictEqual(distanceMeters(a, a), 0);
    const oneDegreeNorth = distanceMeters(a, { lat: 33.0, lng: 34.8 });
    assert.ok(Math.abs(oneDegreeNorth - 111195) < 5, String(oneDegreeNorth));
});

test('same name, city and street: near = one point twice, far = two points', () => {
    const fields = { business_name: 'רשות מקומית - מוקד איסוף', street: undefined, house_number: undefined, neighborhood: 'מרכז מיחזור' };
    const markers = [
        marker({ id: '51', lat: '32.80000' }, fields),
        marker({ id: '52', lat: '32.80050' }, fields),  // ~55 m from 51  -> same point
        marker({ id: '53', lat: '32.81000' }, fields),  // ~1.1 km away   -> another point, same address
        marker({ id: '54', lat: '32.82000' }, { ...fields, street: 'ויצמן', house_number: '186' }) // another street
    ];
    const { locations, dropped, farTwins, stats } = buildLocations(markers);
    assert.deepStrictEqual(locations.map(l => [l.id, l.name]), [
        [51, 'מוקד איסוף - מרכז מיחזור'],
        [53, 'מוקד איסוף - מרכז מיחזור (2)'],
        [54, 'מוקד איסוף - מרכז מיחזור - ויצמן 186']
    ]);
    assert.deepStrictEqual(dropped.sameName, [{ id: 52, sameAs: 51 }]);
    assert.strictEqual(stats.dropped, 1);
    // same name AND same address 1.1 km apart: reported so a person can check the pins
    assert.strictEqual(farTwins.length, 1);
    assert.strictEqual(farTwins[0].id, 53);
    assert.strictEqual(farTwins[0].sameAs, 51);
    assert.ok(farTwins[0].meters > 1000 && farTwins[0].meters < 1200);
});

test('the order of the markers in the API response does not change the result', () => {
    const markers = [
        marker({ id: '63', lat: '32.81' }, { street: 'הנביאים', house_number: '5' }),
        marker({ id: '61' }),
        marker({ id: '62' }),   // exact repeat of 61
        marker({ id: '64', lat: '32.82' }, { business_name: 'קרביץ' }),
        marker({ id: '60', lat: '32.83' }, { business_name: 'קרביץ' }),
        marker({ id: '9', map_id: '2' })
    ];
    const forward = buildLocations(markers);
    const backward = buildLocations([...markers].reverse());
    assert.deepStrictEqual(backward, forward);
    assert.deepStrictEqual(forward.locations.map(l => l.id), [60, 61, 63, 64]); // sorted, lowest id of a repeat survives
    assert.strictEqual(markers[0].id, '63', 'the input array is not reordered');
});

test('parseCoordinate accepts plain decimals only', () => {
    assert.strictEqual(parseCoordinate('32.8'), 32.8);
    assert.strictEqual(parseCoordinate(' 32.197170 '), 32.19717);
    assert.strictEqual(parseCoordinate('-1.5'), -1.5);
    assert.strictEqual(parseCoordinate(35), 35);
    for (const bad of ['32,8', '32.8abc', '', ' ', null, undefined, '1e2', '32.', '.5', '32.8.1', 'NaN', '0x20']) {
        assert.ok(Number.isNaN(parseCoordinate(bad)), String(bad));
    }
});

test('transformMarker skips half-numeric coordinates and non-numeric ids', () => {
    assert.strictEqual(transformMarker(marker({ lat: '32,8' })).skip, 'bad coordinates');
    assert.strictEqual(transformMarker(marker({ lng: '35.0abc' })).skip, 'bad coordinates');
    assert.strictEqual(transformMarker(marker({ id: '12a' })).skip, 'bad id');
    assert.strictEqual(transformMarker(marker({ id: '' })).skip, 'bad id');
    assert.strictEqual(transformMarker(marker({ id: undefined })).skip, 'bad id');
    assert.strictEqual(transformMarker(marker({ id: '<b>7</b>' })).skip, 'bad id');
    assert.strictEqual(transformMarker(marker({ id: 500001 })).location.id, 500001); // a number is fine
    const { skipped } = buildLocations([marker({ id: 'x1' }), marker({ id: '2', lat: '32.8abc' })]);
    assert.deepStrictEqual(skipped, { 'bad id': 1, 'bad coordinates': 1 });
});

test('clean decodes HTML entities, then removes tags', () => {
    assert.strictEqual(clean('H&amp;M'), 'H&M');
    assert.strictEqual(clean('ביה&quot;ס אלון'), 'ביה"ס אלון');
    assert.strictEqual(clean('שד&#39; ירושלים'), "שד' ירושלים");
    assert.strictEqual(clean('א &#8211; ב'), 'א – ב');
    assert.strictEqual(clean('טום &#038; גרי'), 'טום & גרי');
    assert.strictEqual(clean('a &lt; b'), 'a < b');
    assert.strictEqual(clean('&lt;script&gt;alert(1)&lt;/script&gt;שם'), 'alert(1) שם'); // an encoded tag is still a tag
    assert.strictEqual(clean('&amp;lt;b&amp;gt;'), '&lt;b&gt;'); // decoded once, not twice
    assert.strictEqual(clean('a&#0;b&#99999999;c'), 'a b c');
    const { location } = transformMarker(marker({}, { business_name: 'H&amp;M &lt;b&gt;קניון&lt;/b&gt;' }));
    assert.strictEqual(location.name, 'H&M קניון');
});

test('clean drops a trailing hyphen, and keeps a number with a hyphen as MAI writes a floor below ground', () => {
    assert.strictEqual(clean('חנות הרצל -'), 'חנות הרצל');
    // real: 343431 "קומה 1-" is floor -1 typed right to left; MAI writes it "(1-)" elsewhere (346291)
    assert.strictEqual(clean('בניין העירייה - חדר אשפה קומה 1-'), 'בניין העירייה - חדר אשפה קומה (1-)');
    assert.strictEqual(clean('קומת חנייה (1-) כניסה 1'), 'קומת חנייה (1-) כניסה 1');
});

// --- name and address clean-up (real records from the "good to great" audit) ---

const municipal = { business_name: 'רשות מקומית - מוקד איסוף' };

test('a part of the name that repeats an earlier part is left out', () => {
    // real: 347201 "חשמלית - חשמלית - מקס שיין 9"; 347510 "חשמלית - חשמלית - הרי הגלבוע"
    const bin = name => transformMarker(marker({}, { business_name: name, city: 'רחובות', street: '.', house_number: '.' })).location;
    assert.strictEqual(bin('חשמלית - חשמלית - מקס שיין 9').name, 'חשמלית - מקס שיין 9');
    assert.strictEqual(bin('חשמלית - חשמלית - הרי הגלבוע').name, 'חשמלית - הרי הגלבוע');
    // a name with no repeat keeps its own spacing
    assert.strictEqual(bin('קרביץ מלחה- קניון עזריאלי').name, 'קרביץ מלחה- קניון עזריאלי');
});

test('an address that is only the city takes the street from the end of the name', () => {
    // real: 347223 "- חשמלית - סמטת רוזמרין 17" | "חולון"; 347201 (רחובות)
    const bin = (name, city) => transformMarker(marker({}, { business_name: name, city, street: '.', house_number: '.' })).location;
    assert.deepStrictEqual([bin('- חשמלית - סמטת רוזמרין 17', 'חולון').name, bin('- חשמלית - סמטת רוזמרין 17', 'חולון').address],
        ['חשמלית - סמטת רוזמרין 17', 'סמטת רוזמרין 17, חולון']);
    assert.strictEqual(bin('חשמלית - חשמלית - מקס שיין 9', 'רחובות').address, 'מקס שיין 9, רחובות');
    // no house number at the end: not clearly a street, the address stays the city
    assert.strictEqual(bin('חשמלית - חשמלית - הרי הגלבוע', 'רחובות').address, 'רחובות');
    // one part only: the name is the shop, not a street
    assert.strictEqual(bin('גלי 3', 'רחובות').address, 'רחובות');
});

test('municipal boilerplate is removed from the place field too', () => {
    // real: 344186, 344286, 346635
    const a = transformMarker(marker({}, { ...municipal, city: 'צורן', street: 'השקמה', house_number: '4', neighborhood: 'מוקד איסוף - חשמלית' })).location;
    assert.deepStrictEqual([a.name, a.address], ['מוקד איסוף - חשמלית', 'השקמה 4, צורן']);
    const b = transformMarker(marker({}, { ...municipal, city: 'הרצליה', street: 'שדרות נווה עובד', house_number: '6', neighborhood: 'עיריית הרצליה - מוקד איסוף - מתנ"ס נוף ים' })).location;
    assert.deepStrictEqual([b.name, b.address], ['מוקד איסוף - עיריית הרצליה - מתנ"ס נוף ים', 'שדרות נווה עובד 6, הרצליה']);
    const c = transformMarker(marker({}, { business_name: 'עיריית רמת גן - מוקד איסוף עירוני - מכללת שנקר - האגף החדש', city: 'רמת גן', street: 'אנה פרנק', house_number: '12' })).location;
    assert.strictEqual(c.name, 'מוקד איסוף - עיריית רמת גן - מכללת שנקר - האגף החדש');
});

test('בע"מ is removed from a shop name', () => {
    // real: 343665, 344167, 346599
    const name = business => transformMarker(marker({}, { business_name: business })).location;
    assert.strictEqual(name('שופרסל סטוק בע"מ').name, 'שופרסל סטוק');
    assert.strictEqual(name('שופרסל סטוק בע"מ').kind, 'shop');
    assert.strictEqual(name('שופרסל סטוק בע"מ - סניף חולון').name, 'שופרסל סטוק - סניף חולון');
    assert.strictEqual(name('קבוצת גולף א.ק. בע"מ - מודיעין מרכז מגה אור').name, 'קבוצת גולף א.ק. - מודיעין מרכז מגה אור');
});

test('Arabic-script text and parcel numbers are removed (שפרעם street names)', () => {
    // real: 345905 and 345907; the Arabic copy is cut off and the "house number" is a parcel (גוש/חלקה)
    const a = transformMarker(marker({}, { ...municipal, city: 'שפרעם', street: 'זאהר עומר א - זידאני ظاهر العم', house_number: '10262/31' })).location;
    assert.deepStrictEqual([a.name, a.address], ['מוקד איסוף - זאהר עומר א - זידאני', 'זאהר עומר א - זידאני, שפרעם']);
    const b = transformMarker(marker({}, { ...municipal, city: 'שפרעם', street: "ג'בור יוסף ג'בור جبور يوسف جبو", house_number: '10301/10302/23/2' })).location;
    assert.strictEqual(b.address, "ג'בור יוסף ג'בור, שפרעם");
    // an ordinary house number stays
    assert.strictEqual(transformMarker(marker({}, { street: 'הרצל', house_number: '10/2' })).location.address, 'הרצל 10/2, חיפה');
});

test('the city is not written twice in the address', () => {
    // real: 345560 (place "מרכז ביג, כרמיאל"), 346666 (street "סכנין, כביש ראשי"), 342668 (place "מודיעין-עילית")
    const a = transformMarker(marker({}, { business_name: 'קרביץ', city: 'כרמיאל', street: 'מעלה כמון', house_number: '2', neighborhood: 'מרכז ביג, כרמיאל' })).location;
    assert.strictEqual(a.address, 'מעלה כמון 2, מרכז ביג, כרמיאל');
    const b = transformMarker(marker({}, { business_name: 'ביג אלקטריק - סניף סכנין', city: 'סכנין', street: 'סכנין, כביש ראשי', house_number: '0' })).location;
    assert.strictEqual(b.address, 'כביש ראשי, סכנין');
    const c = transformMarker(marker({}, { business_name: 'זול בשפע', city: 'מודיעין עילית', street: "שד' יחזקאל 2", house_number: '2', neighborhood: 'מודיעין-עילית' })).location;
    assert.strictEqual(c.address, "שד' יחזקאל 2, מודיעין עילית");
});

test('a street does not start with "רחוב" or "רח\'"', () => {
    // real: 342578, 344140, 344931, 342662
    const a = transformMarker(marker({}, { business_name: 'רשות מקומית - מרכז איסוף', city: 'נס ציונה', street: 'רחוב הטייסים', house_number: '34', neighborhood: 'מרכז הטייסים' })).location;
    assert.deepStrictEqual([a.name, a.address], ['מוקד איסוף - מרכז הטייסים', 'הטייסים 34, נס ציונה']);
    const b = transformMarker(marker({}, { business_name: 'קרביץ', city: 'חדרה', street: "רח' גיבורים קניון לב", house_number: undefined, neighborhood: 'חדרה' })).location;
    assert.strictEqual(b.address, 'גיבורים קניון לב, חדרה');
    const c = transformMarker(marker({}, { business_name: 'תחנת דלק - פז YELLOW', city: 'חיפה', street: 'עין דיר', house_number: '16', neighborhood: 'רחוב הבנקים' })).location;
    assert.strictEqual(c.address, 'עין דיר 16, הבנקים, חיפה');
    assert.strictEqual(transformMarker(marker({}, { business_name: 'מגה - רחוב דרך הים 26' })).location.name, 'מגה - דרך הים 26');
    // the city רחובות is not a street word
    assert.strictEqual(transformMarker(marker({}, { city: 'רחובות', street: 'הרצל', house_number: '1' })).location.address, 'הרצל 1, רחובות');
});

test('the place is left out of the address when the name already ends with it', () => {
    // real: 342583 "רמי לוי" | "בית הדפוס 13, גבעת שאול, ירושלים" and a second רמי לוי in ירושלים:
    // telling them apart adds the place to the name, so the address no longer repeats it
    const { locations } = buildLocations([
        marker({ id: '1', lat: '31.79' }, { business_name: 'רמי לוי', city: 'ירושלים', street: 'בית הדפוס', house_number: '13', neighborhood: 'גבעת שאול' }),
        marker({ id: '2', lat: '31.75' }, { business_name: 'רמי לוי', city: 'ירושלים', street: 'פייר קניג', house_number: '30', neighborhood: 'תלפיות' })
    ]);
    assert.deepStrictEqual(locations.map(l => [l.name, l.address]), [
        ['רמי לוי - גבעת שאול', 'בית הדפוס 13, ירושלים'],
        ['רמי לוי - תלפיות', 'פייר קניג 30, ירושלים']
    ]);
    // real: 342576 "מוקד איסוף - מול מרכז מחזור החושן" | "החושן, מול מרכז מחזור החושן, נס ציונה"
    const one = transformMarker(marker({}, { ...municipal, city: 'נס ציונה', street: 'החושן', house_number: undefined, neighborhood: 'מול מרכז מחזור החושן' })).location;
    assert.deepStrictEqual([one.name, one.address], ['מוקד איסוף - מול מרכז מחזור החושן', 'החושן, נס ציונה']);
    // a name that does not end with the place keeps the place in the address
    const shop = transformMarker(marker({}, { business_name: 'באג', neighborhood: 'קניון חיפה' })).location;
    assert.strictEqual(shop.address, 'הרצל 10, קניון חיפה, חיפה');
});

test('overrides whose id is not in the MAI response are reported', () => {
    const overrides = { 71: { city: 'נשר' }, 99999: { exclude: true }, 88888: { city: 'עכו' } };
    const { overridesUnmatched, locations } = buildLocations([marker({ id: '71' })], overrides);
    assert.deepStrictEqual(overridesUnmatched, ['88888', '99999']);
    assert.strictEqual(locations[0].city, 'נשר');
    assert.deepStrictEqual(buildLocations([marker({ id: '71' })]).overridesUnmatched, []);
});

test('checkCount: under 1,000 never saves; under 90 % of the previous file needs --force', () => {
    assert.match(checkCount(999, null, false), /Only 999/);
    assert.match(checkCount(999, 900, true), /Only 999/);          // --force does not switch this guard off
    assert.strictEqual(checkCount(1000, null, false), null);       // no previous file
    assert.strictEqual(checkCount(3600, 4000, false), null);       // exactly 90 %
    assert.match(checkCount(3599, 4000, false), /under 90 %.*--force/);
    assert.strictEqual(checkCount(3599, 4000, true), null);
    assert.strictEqual(checkCount(4100, 4000, false), null);
});

test('parseArgs: --input needs a path', () => {
    assert.deepStrictEqual(parseArgs([]), { input: null, force: false });
    assert.deepStrictEqual(parseArgs(['--input', 'raw.json', '--force']), { input: 'raw.json', force: true });
    assert.throws(() => parseArgs(['--input']), /--input needs a file/);
    assert.throws(() => parseArgs(['--input', '--force']), /--input needs a file/);
});

// --- the real fixture: 33 markers copied from the MAI API on 2026-11-25 ---

test('one shop listed twice: same chain within 50 m, same street or one without a house number -> the lower id stays', () => {
    const { locations, dropped, stats } = buildLocations([
        // real: 345582 / 345669, the phone counter inside the same רמי לוי, 18 m apart
        marker({ id: '345669', lat: '31.796689', lng: '35.146284' }, { business_name: 'רמי לוי', city: 'מבשרת ציון', street: 'החוצבים', house_number: '10' }),
        marker({ id: '345582', lat: '31.79683328091107', lng: '35.14636170421983' }, { business_name: 'רמי לוי - תקשורת', city: 'מבשרת ציון', street: 'החוצבים', house_number: '10' }),
        // real: 344152 / 345148 אייס צומת וולקן, 4 m apart; neither has a house number, the streets differ
        marker({ id: '344152', lat: '32.811818', lng: '35.072960' }, { business_name: 'אייס קנה ובנה', city: 'חיפה', street: 'צומת וולקן', house_number: undefined, neighborhood: 'צומת וולקן' }),
        marker({ id: '345148', lat: '32.811844', lng: '35.072932' }, { business_name: 'אייס קנה ובנה', city: 'חיפה', street: 'החרושת', house_number: undefined, neighborhood: 'צומת וולקן, מפרץ חיפה' })
    ]);
    assert.deepStrictEqual(locations.map(l => l.id), [344152, 345582]);
    assert.deepStrictEqual(dropped.sameShop, [{ id: 345148, sameAs: 344152 }, { id: 345669, sameAs: 345582 }]);
    assert.strictEqual(stats.sameShop, 2);
});

test('one shop listed twice: different house numbers are never merged (אבי סופר, אלנבי 113, 122 and 124)', () => {
    // real: three shops within 23 m
    const avi = (id, lat, lng, number) => marker({ id, lat, lng }, { business_name: 'אבי סופר', city: 'תל אביב', street: 'אלנבי', house_number: number });
    const { locations, dropped } = buildLocations([
        avi('343536', '32.062731', '34.773254', '113'),
        avi('343540', '32.062690', '34.773227', '124'),
        avi('343543', '32.062893', '34.773172', '122')
    ]);
    assert.deepStrictEqual(locations.map(l => l.id), [343536, 343540, 343543]);
    assert.deepStrictEqual(dropped.sameShop, []);
});

test('one shop listed twice: not another chain, not another fuel brand, not over 50 m, not a municipal point', () => {
    const at = (id, lat, fields) => marker({ id, lat, lng: '35.0' }, { street: 'הרצל', house_number: '10', ...fields });
    const { locations, dropped } = buildLocations([
        at('1', '32.80000', { business_name: 'באג' }),
        at('2', '32.80010', { business_name: 'גלי' }),                              // 11 m, another chain
        at('3', '32.81000', { business_name: 'תחנת דלק - פז YELLOW' }),
        at('4', '32.81010', { business_name: 'תחנת דלק - דור אלון' }),              // 11 m, another brand
        at('5', '32.82000', { business_name: 'מחסני חשמל' }),
        at('6', '32.82055', { business_name: 'מחסני חשמל - סניף הרצל' }),            // 61 m
        at('7', '32.83000', { business_name: 'רשות מקומית - מוקד איסוף', neighborhood: 'ספרייה' }),
        at('8', '32.83010', { business_name: 'רשות מקומית - מוקד איסוף', neighborhood: 'מתנ"ס' }) // two buildings
    ]);
    assert.deepStrictEqual(locations.map(l => l.id), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepStrictEqual(dropped.sameShop, []);
});

test('shopChain: the first part of the name, with the brand for a fuel station; none for a municipal point', () => {
    assert.strictEqual(shopChain('רמי לוי - תקשורת - קניון עטרות'), 'רמי לוי');
    assert.strictEqual(shopChain('רמי לוי'), 'רמי לוי');
    assert.strictEqual(shopChain('תחנת דלק - פז YELLOW - צומת סעד'), 'תחנת דלק - פז YELLOW');
    assert.strictEqual(shopChain('סופר-פארם - דיזנגוף'), 'סופר-פארם');
    assert.strictEqual(shopChain('מוקד איסוף - ספרייה'), '');
    assert.strictEqual(shopChain('נקודת איסוף - הרצל 4'), '');
});

const FIXTURE = path.join(__dirname, 'test-fixtures', 'raw_sample.json');

test('fixture: every kind of real marker ends up where it should', () => {
    const markers = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    assert.strictEqual(markers.length, 33);
    const { locations, skipped, dropped, stats, farTwins } = buildLocations(markers, {});
    const byId = new Map(locations.map(l => [l.id, l]));

    // normal structured record; HTML from the title never leaks
    assert.deepStrictEqual(byId.get(346168), {
        id: 346168, name: 'רמי לוי', address: 'גוש עציון, כביש 367, גוש עציון, אבטליון', city: 'אבטליון',
        type: 'store', kind: 'shop', lat: 31.645457, lng: 35.129984, hours: 'בדוק באתר'
    });
    for (const loc of locations) {
        assert.ok(!/[<>]|&\w+;/.test(loc.name + loc.address + loc.city), 'markup in ' + loc.id);
    }
    // every kept fixture record has a business name, so every one has a kind
    assert.strictEqual(byId.get(344878).kind, 'fuel');      // תחנת דלק - דלק מנטה
    assert.strictEqual(byId.get(345539).kind, 'municipal'); // a recycling centre, categories 12,14,15
    assert.strictEqual(byId.get(343312).kind, 'shop');      // איידיגיטל
    assert.deepStrictEqual(locations.filter(l => !l.kind).map(l => l.id), []);
    // schools are left off the map: 343396 (school in the title), 345844 and 345846 (school in the place field)
    for (const id of [343396, 345844, 345846]) assert.ok(!byId.has(id), id + ' is a school and must be skipped');

    // skipped, with the reason counted: 343988 no city, 342852 no name, 21574 map 2,
    // 343303 no battery category, 343260 lat 35.15, 346604 "לא פעיל", 346657 "נסגר", 346701 "כפל"
    assert.deepStrictEqual(skipped, {
        'old map': 1, 'no name': 1, 'outside Israel bounds': 1, 'not a battery point': 1,
        'no city': 1, 'marked inactive by MAI': 3, 'school (not open to the public)': 3
    });
    for (const id of [343988, 342852, 21574, 343303, 343260, 346604, 346657, 346701]) {
        assert.ok(!byId.has(id), id + ' must be skipped');
    }

    // stacked: one coordinate, two different streets -> both gone, ids logged
    // (343334 + 343471: two villages, שוקדה and שיבולים, on one coordinate)
    assert.deepStrictEqual(dropped.stacked.map(g => g.ids), [[343334, 343471], [344484, 345700], [346139, 346162]]);
    assert.strictEqual(stats.stackedPoints, 6);
    // one street spelled two ways (דיזינגוף / דיזנגוף 50, Dizengoff Center) -> kept
    for (const id of [343312, 343456]) assert.ok(byId.has(id), id + ' must be kept');
    // shopping centre (קניון רמת אביב, three shops, one coordinate) -> all kept
    for (const id of [343313, 343460, 343463]) assert.ok(byId.has(id), id + ' must be kept');

    // city spelling
    assert.strictEqual(byId.get(344878).city, 'ירושלים');          // MAI: ירשלים
    assert.strictEqual(byId.get(344718).city, 'שפיים');            // MAI: קיבוץ שפיים
    // address cleanup
    assert.strictEqual(byId.get(346793).address, 'הרצל 97, חיפה');             // MAI: הרצל 97 97
    assert.strictEqual(byId.get(346599).address, 'מרכז מגה אור, מודיעין');     // MAI: house number 0
    assert.strictEqual(byId.get(343522).address, 'המלאכה 2, רעננה');           // MAI: המלאכה 2, רעננה, רעננה
    assert.strictEqual(byId.get(344172).name, 'מגה קניון חדרה');               // MAI: ... - חוויה ואיכות בעיר-3570/90

    // same name and place 1.5 km apart, different streets -> both kept, told apart by street
    assert.strictEqual(byId.get(345539).name, 'מוקד איסוף - מרכז מיחזור');
    assert.strictEqual(byId.get(345540).name, 'מוקד איסוף - מרכז מיחזור - אז"ר 97');
    assert.deepStrictEqual(farTwins, []);
    // one point listed twice at the same coordinate -> the lower id stays
    assert.deepStrictEqual(dropped.sameSpot, [{ id: 342617, sameAs: 342611 }]);

    assert.strictEqual(locations.length, 15);
    assert.deepStrictEqual(locations.map(l => l.id), [...byId.keys()].sort((a, b) => a - b));
    assert.strictEqual(new Set(locations.map(l => l.name + '|' + l.city)).size, locations.length);
});

// --- run(): the whole refresh, offline, in a temporary folder ---

// MIN_POINTS is 1,000, so the guards need a response of that size
function manyMarkers(count) {
    const markers = [];
    for (let i = 0; i < count; i++) {
        markers.push(marker(
            { id: String(400000 + i), lat: (31 + i * 0.001).toFixed(3), lng: '34.9' },
            { business_name: 'חנות ' + i, street: 'רחוב ' + i }
        ));
    }
    return markers;
}

function tempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scraper-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'facilities.json'), JSON.stringify({ locations: [] }));
    // 10 overrides, one of them (77) matching no marker. The other eight give markers the city they
    // already have, so they change nothing. One unmatched in ten is allowed; more refuses to save.
    const overrides = { 400001: { exclude: true }, 77: { city: 'x' } };
    for (let id = 400002; id <= 400009; id++) overrides[id] = { city: 'חיפה' };
    fs.writeFileSync(path.join(dir, 'data_overrides.json'), JSON.stringify({ overrides }));
    return dir;
}

function writeRaw(dir, markers) {
    const file = path.join(dir, 'raw.json');
    fs.writeFileSync(file, JSON.stringify(markers));
    fs.utimesSync(file, new Date('2026-11-20T10:00:00Z'), new Date('2026-11-20T10:00:00Z'));
    return file;
}

test('run writes locations.json and data_meta.json, with no .tmp file left', async (t) => {
    const dir = tempDir(t);
    const input = writeRaw(dir, [...manyMarkers(1200), marker({ id: '5', map_id: '2' })]);
    const meta = await run({ dir, input });

    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'locations.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(saved), ['locations']);
    assert.strictEqual(saved.locations.length, 1199);
    assert.deepStrictEqual(Object.keys(saved.locations[0]), ['id', 'name', 'address', 'city', 'type', 'kind', 'lat', 'lng', 'hours']);

    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data_meta.json'), 'utf8')), meta);
    assert.deepStrictEqual(meta, {
        source: 'file: raw.json',
        fetched_at: '2026-11-20T10:00:00.000Z', // the input file's modification time
        raw_markers: 1201,
        kept: 1199,
        skipped: { 'old map': 1, 'excluded by data_overrides.json': 1 },
        duplicates_removed: 0,
        stacked_dropped: 0,
        overrides_unmatched: [77],
        changes: null // there was no previous file to compare with
    });
    assert.deepStrictEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);

    // a second run on the same input gives the same bytes, and reports that nothing changed
    const first = fs.readFileSync(path.join(dir, 'locations.json'), 'utf8');
    const again = await run({ dir, input });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'locations.json'), 'utf8'), first);
    assert.deepStrictEqual(again.changes, {
        counts: { added: 0, removed: 0, moved: 0, renamed: 0, cityChanged: 0 },
        added: [], removed: [], moved: [], renamed: [], cityChanged: []
    });
});

test('run refuses to save under 1,000 points and leaves the old files alone', async (t) => {
    const dir = tempDir(t);
    fs.writeFileSync(path.join(dir, 'locations.json'), 'OLD');
    const input = writeRaw(dir, manyMarkers(900));
    await assert.rejects(run({ dir, input }), /Only 899 collection points.*NOT changed/);
    await assert.rejects(run({ dir, input, force: true }), /Only 899 collection points/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'locations.json'), 'utf8'), 'OLD');
    assert.ok(!fs.existsSync(path.join(dir, 'data_meta.json')));
});

test('run refuses to save under 90 % of the previous count unless forced', async (t) => {
    const dir = tempDir(t);
    await run({ dir, input: writeRaw(dir, manyMarkers(2000)) });             // previous file: 1,999 points
    const before = fs.readFileSync(path.join(dir, 'locations.json'), 'utf8');

    const smaller = writeRaw(dir, manyMarkers(1700));                        // 1,699 = 85 %
    await assert.rejects(run({ dir, input: smaller }), /under 90 %.*--force.*NOT changed/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'locations.json'), 'utf8'), before);

    const meta = await run({ dir, input: smaller, force: true });
    assert.strictEqual(meta.kept, 1699);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'locations.json'), 'utf8')).locations.length, 1699);

    await run({ dir, input: writeRaw(dir, manyMarkers(1650)) });             // 1,649 of 1,699 = 97 % -> fine
});

test('changesSince lists what was added, removed, moved over 100 m, renamed or given another city', () => {
    const at = (id, lat, extra = {}) => ({ id, name: 'חנות ' + id, city: 'חיפה', lat, lng: 35.0, ...extra });
    const previous = [at(1, 32.8), at(2, 32.8), at(3, 32.8), at(4, 32.8), at(5, 32.8), at(6, 32.8)];
    const stores = [
        at(1, 32.8),                        // unchanged
        at(3, 32.8018),                     // 200 m north
        at(4, 32.8005),                     // 56 m north: not a move
        at(5, 32.8, { name: 'חנות חדשה' }),
        at(6, 32.8, { city: 'נשר' }),
        at(7, 32.8)                         // new; 2 is gone
    ];
    assert.deepStrictEqual(changesSince(previous, stores), {
        added: [7], removed: [2], moved: [3], renamed: [5], cityChanged: [6]
    });
    const none = changesSince(previous, previous);
    assert.deepStrictEqual(none, { added: [], removed: [], moved: [], renamed: [], cityChanged: [] });
});

// The markers of manyMarkers, with the first `count` moved 150 m north
function withMoved(markers, count) {
    return markers.map((m, i) => (i < count ? { ...m, lat: (Number(m.lat) + 0.00135).toFixed(5) } : m));
}

test('run refuses to save when over 5 % of the points moved or went, unless forced', async (t) => {
    const dir = tempDir(t);
    await run({ dir, input: writeRaw(dir, manyMarkers(1200)) });             // previous file: 1,199 points
    const before = fs.readFileSync(path.join(dir, 'locations.json'), 'utf8');
    const metaBefore = fs.readFileSync(path.join(dir, 'data_meta.json'), 'utf8');

    const moved = writeRaw(dir, withMoved(manyMarkers(1200), 73));            // 72 kept points moved = 6 %
    await assert.rejects(run({ dir, input: moved }), /72 of 1199 points were removed or moved.*--force.*NOT changed/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'locations.json'), 'utf8'), before);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'data_meta.json'), 'utf8'), metaBefore);

    const meta = await run({ dir, input: moved, force: true });
    assert.strictEqual(meta.changes.counts.moved, 72);
    assert.strictEqual(meta.changes.moved.length, 72);
    assert.deepStrictEqual(meta.changes.moved.slice(0, 2), [400000, 400002]); // 400001 is excluded
});

test('run saves a small change and writes it to data_meta.json', async (t) => {
    const dir = tempDir(t);
    await run({ dir, input: writeRaw(dir, manyMarkers(1200)) });
    const next = withMoved(manyMarkers(1201), 3).slice(0, 1201).filter(m => m.id !== '400010');
    const meta = await run({ dir, input: writeRaw(dir, next) });
    assert.deepStrictEqual(meta.changes, {
        counts: { added: 1, removed: 1, moved: 2, renamed: 0, cityChanged: 0 },
        added: [401200], removed: [400010], moved: [400000, 400002], renamed: [], cityChanged: []
    });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data_meta.json'), 'utf8')).changes, meta.changes);
});

test('run refuses to save when over 10 % of the overrides match no marker, unless forced', async (t) => {
    const dir = tempDir(t);
    fs.writeFileSync(path.join(dir, 'locations.json'), 'OLD');
    const input = writeRaw(dir, manyMarkers(1200));
    const overrides = JSON.parse(fs.readFileSync(path.join(dir, 'data_overrides.json'), 'utf8')).overrides;
    delete overrides[400009];
    overrides[78] = { exclude: true };                                       // now 2 of 10 match nothing
    fs.writeFileSync(path.join(dir, 'data_overrides.json'), JSON.stringify({ overrides }));
    await assert.rejects(run({ dir, input }),
        /2 of 10 overrides match no MAI marker - MAI may have renumbered its markers\..*NOT changed/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'locations.json'), 'utf8'), 'OLD');
    assert.ok(!fs.existsSync(path.join(dir, 'data_meta.json')));

    fs.rmSync(path.join(dir, 'locations.json'));
    const meta = await run({ dir, input, force: true });
    assert.deepStrictEqual(meta.overrides_unmatched, [77, 78]);
});

test('command line: --input without a path is a usage error (exit 1)', () => {
    const { spawnSync } = require('child_process');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'scraper.js'), '--input'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--input needs a file/);
});

test('isSchool: schools, yeshivas and kindergartens, but not streets, shops or colleges', () => {
    for (const name of [
        'מוקד איסוף - בית ספר רעות', 'מוקד איסוף - בית הספר ממ"ד הראל', 'מוקד איסוף - בתי הספר היסודיים ממלכתיים - עתיד',
        'מוקד איסוף - בתי-ספר יסודיים ממ"ד - הרא"ה', 'מוקד איסוף - ביה"ס ברנדיס', 'מוקד איסוף - בי"ס קשת',
        'מוקד איסוף - מזכירות\\ביה"ס', 'מוקד איסוף - תיכון הראל', 'מוקד איסוף - חט"ב סביונים', 'מוקד איסוף - חטיבת רבין',
        'מוקד איסוף - ישיבת הסדר', 'מוקד איסוף - אולפנת בהרן', 'מוקד איסוף - ממ"ד גוננים', 'מוקד איסוף - גני ילדים',
        'מוקד איסוף - קריית החינוך', 'מוקד איסוף - "התיכון הישראלי למדעים ואומנויות"', 'מוקד איסוף - בית חינוך קהילתי גאולה', 'מוקד איסוף - תלמוד תורה'
    ]) assert.ok(isSchool(name), name);
    // a school campus that does not use the word "school" (found on the map in the November 2026 audit)
    for (const name of ['מוקד איסוף - תיכונט ע"ש אלתרמן', 'מוקד איסוף - חמ"ד מודיעים - יהלום, כניסה ראשית']) assert.ok(isSchool(name), name);
    // opposite or next to a school is not inside it; "חטיבת <name> <number>" is a street address
    for (const name of [
        'נחלת החדשה, מול בית הספר', 'מוקד איסוף - ליד בי"ס קשת', 'מוקד איסוף - מול התיכון',
        'עיריית רמת השרון - מרכז איסוף - חשמלית - חטיבת אלכסנדרוני 2', 'מוקד איסוף - חטיבת גולני 14'
    ]) assert.ok(!isSchool(name), name);
    for (const name of [
        'תחנת דלק - סונול סו גוד - חטיבת הנח"ל 30', 'תחנת דלק - פז YELLOW - חטיבה תשע פינת הולנד', 'חשמלית - אלישיב',
        'מוקד איסוף - סמוך לגן ילדים', 'באג - אוניברסיטת ת"א, שער 8', 'מוקד איסוף - מכללת לוינסקי', 'בית מדרש דרכי דוד',
        'מוקד איסוף - גן נווה', 'מוקד איסוף - מתנ"ס מרכז אופק', 'שופרסל', 'מוקד איסוף - התיכונים 5', 'מוקד איסוף - שכונת יפה נוף, צמוד לבית הספר', 'מוקד איסוף - מכללת שנקר'
    ]) assert.ok(!isSchool(name), name);
});

test('a school is skipped, whether the school is in the name or in the place field', () => {
    const inName = transformMarker(marker({}, { business_name: 'בית ספר רעות' }));
    assert.strictEqual(inName.skip, 'school (not open to the public)');
    const inPlace = transformMarker(marker({}, { business_name: 'רשות מקומית - מוקד איסוף', neighborhood: 'בית ספר רימונים' }));
    assert.strictEqual(inPlace.skip, 'school (not open to the public)');
    const onSchoolStreet = transformMarker(marker({}, { business_name: 'שופרסל', street: 'בית הספר', house_number: '4' }));
    assert.ok(onSchoolStreet.location, 'a shop on a street named after a school stays');
});

test('real records the school rule used to drop by mistake are kept', () => {
    // 344744: a petrol station whose place field names the junction by the school next to it
    const station = transformMarker(marker({ id: '344744' }, {
        city: 'צומת גולני דרומה', street: undefined, house_number: undefined,
        neighborhood: 'צומת גולני דרומה-בית ספר כדורי', business_name: 'תחנת דלק - דור אלון'
    }));
    assert.strictEqual(station.location.name, 'תחנת דלק - דור אלון');
    // 342750: a collection centre opposite a school
    const opposite = transformMarker(marker({ id: '342750' }, {
        city: 'ראשון לציון', street: 'העצמאות', house_number: undefined,
        neighborhood: 'נחלת החדשה, מול בית הספר', business_name: 'רשות מקומית - מרכז איסוף'
    }));
    assert.ok(opposite.location, 'opposite a school: ' + opposite.skip);
    // 346995: "חטיבת אלכסנדרוני 2" is the street address
    const street = transformMarker(marker({ id: '346995' }, {
        city: 'רמת השרון', street: 'חטיבת אלכסנדרוני', house_number: '2', neighborhood: 'מורשה',
        business_name: 'עיריית רמת השרון - מרכז איסוף - חשמלית - חטיבת אלכסנדרוני 2'
    }));
    assert.ok(street.location, 'a street named after a brigade: ' + street.skip);
    // still a school: the bin is in the car park of the high school (342792, left out until the owner decides)
    const carPark = transformMarker(marker({ id: '342792' }, {
        city: 'מודיעין', street: 'נחל עיון', house_number: undefined,
        neighborhood: 'החנייה האחורית של תיכון עירוני ב\' ע"ש רבין', business_name: 'רשות מקומית - מרכז איסוף - חשמלית'
    }));
    assert.strictEqual(carPark.skip, 'school (not open to the public)');
});

test('normalizeCity: spellings and labels found in the "good to great" audit', () => {
    const cases = {
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
        // a letter that is part of the name needs its geresh, or it reads as a typing slip
        'קיבוץ דגניה א': "דגניה א'",
        // one place under a short and a long name, pins 21 m and 364 m apart
        'הילה': 'מצפה הילה',
        'גרנות': 'גרנות הגליל',
        // abbreviations and a Latin letter inside a Hebrew name
        'צ.צלמון': 'צומת צלמון',
        'א.ת.עמק חפר': 'עמק חפר',
        'מחלף M הדרך': 'מחלף אם הדרך',
        // a trailing bracket is a remark, not part of the name
        'עובדה (שיכון משפחות)': 'עובדה',
        'שדה תרומות (ביכורה)': 'שדי תרומות', // and the moshav is שדי, not שדה
        'מועצה אזורית גולן': 'מועצה אזורית גולן' // other regional councils are left as they are
    };
    for (const [raw, expected] of Object.entries(cases)) {
        assert.strictEqual(normalizeCity(raw), expected, raw);
    }
});

test('points inside places the public cannot freely enter are excluded by data_overrides.json (owner, 2026-11-27)', () => {
    const { overrides } = JSON.parse(fs.readFileSync(path.join(__dirname, 'data_overrides.json'), 'utf8'));
    // 343333 מחנה רמון (air force base), 344808 inside the national police headquarters, 345833 a pre-army academy
    for (const id of ['343333', '344808', '345833']) {
        assert.deepStrictEqual(overrides[id], { exclude: true }, id + ' should be excluded');
        assert.strictEqual(transformMarker(marker({ id }), overrides).skip, 'excluded by data_overrides.json');
    }
});
