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
const { transformMarker, buildLocations, determineChain, normalizeCity, municipalName } = scraper;
const {
    clean, isMarkedInactive, isSchool, joinStreet, parseCoordinate, distanceMeters,
    streetKey, sameStreet, checkCount, parseArgs, run
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

const noCache = new Map();

test('transformMarker builds a clean location from structured fields', () => {
    const { location } = transformMarker(marker(), noCache);
    assert.deepStrictEqual(location, {
        id: 500001,
        name: 'באג',
        address: 'הרצל 10, חיפה',
        city: 'חיפה',
        type: 'store',
        chain: 'bug',
        lat: 32.8,
        lng: 35.0,
        hours: 'בדוק באתר'
    });
});

test('transformMarker never lets HTML from the title into the name', () => {
    const { location } = transformMarker(marker(), noCache);
    assert.ok(!location.name.includes('<'));
    assert.ok(!location.address.includes('<'));
});

test('transformMarker rejects markers that must not reach the map', () => {
    assert.strictEqual(transformMarker(marker({ map_id: '2' }), noCache).skip, 'old map');
    assert.strictEqual(transformMarker(marker({ category: '14' }), noCache).skip, 'not a battery point');
    assert.strictEqual(transformMarker(marker({ lat: '' }), noCache).skip, 'bad coordinates');
    assert.strictEqual(transformMarker(marker({ lat: null, lng: null }), noCache).skip, 'bad coordinates');
    assert.strictEqual(transformMarker(marker({ lat: '0', lng: '0' }), noCache).skip, 'outside Israel bounds');
    assert.strictEqual(transformMarker(marker({ lat: '36.7', lng: '-119.4' }), noCache).skip, 'outside Israel bounds');
    assert.strictEqual(transformMarker(marker({}, { business_name: 'טיב טעם - לא פעיל' }), noCache).skip, 'marked inactive by MAI');
    assert.strictEqual(transformMarker(marker({ title: '' }, { business_name: undefined }), noCache).skip, 'no name');
});

test('transformMarker accepts a battery category inside a list', () => {
    assert.ok(transformMarker(marker({ category: '12,14,15' }), noCache).location);
});

test('generic municipal names become "מוקד איסוף - <place>"', () => {
    const { location } = transformMarker(marker({}, {
        business_name: 'רשות מקומית - מוקד איסוף',
        neighborhood: 'מתנ"ס רעות'
    }), noCache);
    assert.strictEqual(location.name, 'מוקד איסוף - מתנ"ס רעות');
    assert.strictEqual(location.chain, 'municipality');
    assert.strictEqual(location.address, 'הרצל 10, מתנ"ס רעות, חיפה');
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

test('a marker without a city falls back to the cache, else is skipped', () => {
    const bare = marker({ title: 'ויצמן 20', custom_field_data: [] });
    assert.strictEqual(transformMarker(bare, noCache).skip, 'no city');
    const cache = new Map([['32.80000,35.00000', 'חיפה']]);
    const { location } = transformMarker(bare, cache);
    assert.strictEqual(location.city, 'חיפה');
    assert.strictEqual(location.name, 'נקודת איסוף - ויצמן 20');
});

test('data_overrides.json entries fix a city or exclude a point', () => {
    const fixed = transformMarker(marker(), noCache, { 500001: { city: 'נשר' } });
    assert.strictEqual(fixed.location.city, 'נשר');
    assert.strictEqual(fixed.location.address, 'הרצל 10, נשר');
    const excluded = transformMarker(marker(), noCache, { 500001: { exclude: true } });
    assert.strictEqual(excluded.skip, 'excluded by data_overrides.json');
});

test('buildLocations removes repeats and tells same-name branches apart', () => {
    const markers = [
        marker({ id: '1' }),
        marker({ id: '2' }),                                              // exact repeat of 1
        marker({ id: '3', lat: '32.81' }, { street: 'הנביאים', house_number: '5' }), // another branch
        marker({ id: '4', map_id: '2' })                                  // skipped
    ];
    const { locations, skipped } = buildLocations(markers, noCache);
    assert.deepStrictEqual(locations.map(l => l.name), ['באג - הרצל 10', 'באג - הנביאים 5']);
    assert.strictEqual(skipped['old map'], 1);
    const keys = locations.map(l => l.name + '|' + l.city);
    assert.strictEqual(new Set(keys).size, keys.length);
});

test('determineChain recognises the main chains', () => {
    assert.strictEqual(determineChain('סופר-פארם'), 'superpharm');
    assert.strictEqual(determineChain('שופרסל דיל'), 'shufersal');
    assert.strictEqual(determineChain('רמי לוי - תקשורת'), 'rami_levy');
    assert.strictEqual(determineChain('הום סנטר'), 'home_center');
    assert.strictEqual(determineChain('ביג אלקטריק'), 'big_electric');
    assert.strictEqual(determineChain('תחנת דלק - פז YELLOW'), 'gas_station');
    assert.strictEqual(determineChain('רשות מקומית - מוקד איסוף'), 'municipality');
    assert.strictEqual(determineChain('קרביץ'), 'other');
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
        transformMarker(marker({}, { business_name: 'בית ספר אלון - מוקד איסוף - כפל' }), noCache).skip,
        'marked inactive by MAI');
});

test('"כפול" and "כפל" inside a longer word do not mark a point as closed', () => {
    assert.ok(!isMarkedInactive('מכפולת'));
    assert.ok(!isMarkedInactive('מכולת מכפולת הזהב'));
    assert.ok(!isMarkedInactive('מכפלה'));
    assert.ok(!isMarkedInactive('סופר-פארם'));
    assert.ok(transformMarker(marker({}, { business_name: 'מכפולת' }), noCache).location);
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
    const zero = transformMarker(marker({}, { street: 'מרכז מגה אור', house_number: '0' }), noCache).location;
    assert.strictEqual(zero.address, 'מרכז מגה אור, חיפה');
    const doubled = transformMarker(marker({}, { street: 'הרצל 97', house_number: '97' }), noCache).location;
    assert.strictEqual(doubled.address, 'הרצל 97, חיפה');
    const cityTwice = transformMarker(marker({}, { street: 'המלאכה', house_number: '2', neighborhood: 'חיפה' }), noCache).location;
    assert.strictEqual(cityTwice.address, 'המלאכה 2, חיפה');
    // the repeated part is spelled like MAI's city, before our spelling fix
    const oldSpelling = transformMarker(marker({}, { city: 'זכרון יעקב', street: 'זכרון יעקב', house_number: undefined }), noCache).location;
    assert.strictEqual(oldSpelling.address, 'זיכרון יעקב');
});

test('the chain-internal branch code is removed from the name', () => {
    const { location } = transformMarker(marker({}, { business_name: 'מגה קניון חדרה - חוויה ואיכות בעיר-3570/90' }), noCache);
    assert.strictEqual(location.name, 'מגה קניון חדרה');
    assert.strictEqual(location.chain, 'mega');
});

test('a business name that is only the address becomes "נקודת איסוף - <street>"', () => {
    // real records: 343467 "ההשראה 2, שלומי", 345324 (place only), 344752 (city field holds the address)
    const a = transformMarker(marker({}, { city: 'שלומי', street: 'ההשראה', house_number: '2', business_name: 'ההשראה 2, שלומי' }), noCache).location;
    assert.strictEqual(a.name, 'נקודת איסוף - ההשראה 2');
    assert.strictEqual(a.address, 'ההשראה 2, שלומי');
    const b = transformMarker(marker({}, {
        city: 'ירושלים', street: undefined, house_number: undefined,
        neighborhood: 'מרכז מסחרי נווה יעקב', business_name: 'מרכז מסחרי נווה יעקב, ירושלים'
    }), noCache).location;
    assert.strictEqual(b.name, 'נקודת איסוף - מרכז מסחרי נווה יעקב');
    const c = transformMarker(marker({}, {
        city: 'פנחס לבון 18 נתניה', street: 'פנחס לבון', house_number: '18', business_name: 'פנחס לבון 18, נתניה'
    }), noCache).location;
    assert.strictEqual(c.name, 'נקודת איסוף - פנחס לבון 18');
    assert.strictEqual(c.city, 'נתניה');
    // a real name is left alone
    assert.strictEqual(transformMarker(marker(), noCache).location.name, 'באג');
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
    const { locations, stats, dropped } = buildLocations(markers, noCache);
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
    const { locations, dropped } = buildLocations(markers, noCache);
    assert.deepStrictEqual(locations.map(l => l.id), [21, 22, 23]);
    assert.deepStrictEqual(dropped.stacked, []);
});

test('stacked coordinates: one street written short and long is still one street', () => {
    const markers = [
        marker({ id: '25' }, { business_name: 'באג', street: 'אבא הלל סילבר', house_number: '301' }),
        marker({ id: '26' }, { business_name: 'קרביץ', street: 'אבא הלל', house_number: '301' }),
        marker({ id: '27' }, { business_name: 'גולף', street: 'אבא הלל', house_number: '301' })
    ];
    const { locations, dropped } = buildLocations(markers, noCache);
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
    ], noCache);
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
    const { locations, dropped } = buildLocations(markers, noCache);
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
    const { locations, dropped } = buildLocations(markers, noCache);
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
    ], noCache);
    assert.deepStrictEqual(sameCity.locations.map(l => l.id), [31, 32]);
    assert.strictEqual(sameCity.locations[1].address, 'חיפה');

    // two villages on one coordinate, neither has a street -> dropped
    const twoVillages = buildLocations([
        marker({ id: '33' }, { business_name: 'מוקד א', city: 'שוקדה', street: undefined, house_number: undefined }),
        marker({ id: '34' }, { business_name: 'מוקד ב', city: 'שובה', street: undefined, house_number: undefined })
    ], noCache);
    assert.deepStrictEqual(twoVillages.locations, []);
    assert.deepStrictEqual(twoVillages.dropped.stacked[0].ids, [33, 34]);

    // no street in one city, a street in another -> dropped
    const mixed = buildLocations([
        marker({ id: '35' }, { business_name: 'מוקד א', city: 'רבדים', street: undefined, house_number: undefined }),
        marker({ id: '36' }, { business_name: 'מוקד ב', city: 'שדה יואב', street: 'מזכירות', house_number: undefined })
    ], noCache);
    assert.deepStrictEqual(mixed.locations, []);
});

test('stacked coordinates: same chain name does not hide two different addresses', () => {
    // real case: ids 344484 and 345700, both "גוד פארם", one pin, two cities
    const { locations, stats, dropped } = buildLocations([
        marker({ id: '41' }, { business_name: 'גוד פארם', city: 'פתח תקווה', street: 'רוטשילד', house_number: '57' }),
        marker({ id: '42' }, { business_name: 'גוד פארם', city: 'כרמיאל', street: 'מעלה כמון', house_number: '9' })
    ], noCache);
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
    const { locations, dropped, farTwins, stats } = buildLocations(markers, noCache);
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
    const forward = buildLocations(markers, noCache);
    const backward = buildLocations([...markers].reverse(), noCache);
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
    assert.strictEqual(transformMarker(marker({ lat: '32,8' }), noCache).skip, 'bad coordinates');
    assert.strictEqual(transformMarker(marker({ lng: '35.0abc' }), noCache).skip, 'bad coordinates');
    assert.strictEqual(transformMarker(marker({ id: '12a' }), noCache).skip, 'bad id');
    assert.strictEqual(transformMarker(marker({ id: '' }), noCache).skip, 'bad id');
    assert.strictEqual(transformMarker(marker({ id: undefined }), noCache).skip, 'bad id');
    assert.strictEqual(transformMarker(marker({ id: '<b>7</b>' }), noCache).skip, 'bad id');
    assert.strictEqual(transformMarker(marker({ id: 500001 }), noCache).location.id, 500001); // a number is fine
    const { skipped } = buildLocations([marker({ id: 'x1' }), marker({ id: '2', lat: '32.8abc' })], noCache);
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
    const { location } = transformMarker(marker({}, { business_name: 'H&amp;M &lt;b&gt;קניון&lt;/b&gt;' }), noCache);
    assert.strictEqual(location.name, 'H&M קניון');
});

test('overrides whose id is not in the MAI response are reported', () => {
    const overrides = { 71: { city: 'נשר' }, 99999: { exclude: true }, 88888: { city: 'עכו' } };
    const { overridesUnmatched, locations } = buildLocations([marker({ id: '71' })], noCache, overrides);
    assert.deepStrictEqual(overridesUnmatched, ['88888', '99999']);
    assert.strictEqual(locations[0].city, 'נשר');
    assert.deepStrictEqual(buildLocations([marker({ id: '71' })], noCache).overridesUnmatched, []);
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

const FIXTURE = path.join(__dirname, 'test-fixtures', 'raw_sample.json');

test('fixture: every kind of real marker ends up where it should', () => {
    const markers = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    assert.strictEqual(markers.length, 33);
    const { locations, skipped, dropped, stats, farTwins } = buildLocations(markers, noCache, {});
    const byId = new Map(locations.map(l => [l.id, l]));

    // normal structured record; HTML from the title never leaks
    assert.deepStrictEqual(byId.get(346168), {
        id: 346168, name: 'רמי לוי', address: 'גוש עציון, כביש 367, גוש עציון, אבטליון', city: 'אבטליון',
        type: 'store', chain: 'rami_levy', lat: 31.645457, lng: 35.129984, hours: 'בדוק באתר'
    });
    for (const loc of locations) {
        assert.ok(!/[<>]|&\w+;/.test(loc.name + loc.address + loc.city), 'markup in ' + loc.id);
    }
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
    fs.writeFileSync(path.join(dir, 'data_overrides.json'), JSON.stringify({ overrides: { 400001: { exclude: true }, 77: { city: 'x' } } }));
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
    assert.deepStrictEqual(Object.keys(saved.locations[0]), ['id', 'name', 'address', 'city', 'type', 'chain', 'lat', 'lng', 'hours']);

    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data_meta.json'), 'utf8')), meta);
    assert.deepStrictEqual(meta, {
        source: 'file: raw.json',
        fetched_at: '2026-11-20T10:00:00.000Z', // the input file's modification time
        raw_markers: 1201,
        kept: 1199,
        skipped: { 'old map': 1, 'excluded by data_overrides.json': 1 },
        duplicates_removed: 0,
        stacked_dropped: 0,
        overrides_unmatched: [77]
    });
    assert.deepStrictEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);

    // a second run on the same input gives the same bytes
    const first = fs.readFileSync(path.join(dir, 'locations.json'), 'utf8');
    await run({ dir, input });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'locations.json'), 'utf8'), first);
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

    await run({ dir, input: writeRaw(dir, manyMarkers(1600)) });             // 1,599 of 1,699 = 94 % -> fine
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
    for (const name of [
        'תחנת דלק - סונול סו גוד - חטיבת הנח"ל 30', 'תחנת דלק - פז YELLOW - חטיבה תשע פינת הולנד', 'חשמלית - אלישיב',
        'מוקד איסוף - סמוך לגן ילדים', 'באג - אוניברסיטת ת"א, שער 8', 'מוקד איסוף - מכללת לוינסקי', 'בית מדרש דרכי דוד',
        'מוקד איסוף - גן נווה', 'מוקד איסוף - מתנ"ס מרכז אופק', 'שופרסל', 'מוקד איסוף - התיכונים 5', 'מוקד איסוף - שכונת יפה נוף, צמוד לבית הספר', 'מוקד איסוף - מכללת שנקר'
    ]) assert.ok(!isSchool(name), name);
});

test('a school is skipped, whether the school is in the name or in the place field', () => {
    const inName = transformMarker(marker({}, { business_name: 'בית ספר רעות' }), noCache);
    assert.strictEqual(inName.skip, 'school (not open to the public)');
    const inPlace = transformMarker(marker({}, { business_name: 'רשות מקומית - מוקד איסוף', neighborhood: 'בית ספר רימונים' }), noCache);
    assert.strictEqual(inPlace.skip, 'school (not open to the public)');
    const onSchoolStreet = transformMarker(marker({}, { business_name: 'שופרסל', street: 'בית הספר', house_number: '4' }), noCache);
    assert.ok(onSchoolStreet.location, 'a shop on a street named after a school stays');
});
