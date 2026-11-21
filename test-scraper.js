/**
 * Tests for scraper.js - these run the REAL functions (no copies).
 * Uses Node's built-in test runner, so there is nothing to install.
 *
 * Usage: node --test test-scraper.js
 */

const test = require('node:test');
const assert = require('node:assert');
const { transformMarker, buildLocations, determineChain, normalizeCity, municipalName } = require('./scraper.js');

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
        neighborhood: 'בית ספר רעות'
    }), noCache);
    assert.strictEqual(location.name, 'מוקד איסוף - בית ספר רעות');
    assert.strictEqual(location.chain, 'municipality');
    assert.strictEqual(location.address, 'הרצל 10, בית ספר רעות, חיפה');
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
