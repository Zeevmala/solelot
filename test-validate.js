/**
 * Tests for validate_data.js. Run: node --test test-validate.js
 *
 * Each test writes a small locations file, runs the real script on it
 * (node validate_data.js <path>) and checks the exit code and the printed line.
 *
 * Check 15 needs at least 1,000 locations, so every fixture starts from 1,000
 * generated clean points. The limit in validate_data.js is not made adjustable
 * for tests: a switch that lowers it could also be left on by mistake.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'validate_data.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-test-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// One valid collection point. Coordinates are WGS84 degrees: lat first, then lng.
function point(id, lat, lng, extra = {}) {
    return {
        id, name: 'נקודה ' + id, address: 'רחוב ' + id + ', תל אביב', city: 'תל אביב',
        type: 'store', chain: 'x', lat, lng, hours: '', ...extra
    };
}

// 1,000 clean points in תל אביב: a 40 x 25 grid, about 20 m apart, ids 1000-1999.
// The grid covers lat 32.0800-32.0878, lng 34.7800-34.7848.
const GRID_TOP_LAT = 32.08 + 39 * 0.0002;
function cleanPoints() {
    const points = [];
    for (let i = 0; i < 1000; i++) {
        const lat = Number((32.08 + Math.floor(i / 25) * 0.0002).toFixed(6));
        const lng = Number((34.78 + (i % 25) * 0.0002).toFixed(6));
        points.push(point(1000 + i, lat, lng));
    }
    return points;
}

// One degree of latitude on the validator's sphere (R = 6371 km) is 111.19 km
const KM_PER_DEGREE_LAT = 2 * Math.PI * 6371 / 360;

let fileNumber = 0;
// Runs the validator on the given locations. Returns the exit code and a
// function that gives the printed block of one check (its line + detail lines).
function validate(locations) {
    const file = path.join(TMP, 'fixture-' + (fileNumber++) + '.json');
    fs.writeFileSync(file, JSON.stringify({ locations }));
    const result = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
    const lines = result.stdout.split('\n');
    const block = number => {
        const start = lines.findIndex(line => new RegExp('^\\[.\\] ' + number + '\\. ').test(line));
        assert.notStrictEqual(start, -1, 'check ' + number + ' printed nothing:\n' + result.stdout + result.stderr);
        let end = start + 1;
        while (end < lines.length && lines[end].startsWith('    ')) end++;
        return lines.slice(start, end).join('\n');
    };
    return { status: result.status, stdout: result.stdout, block };
}

// The check failed: exit code 1 and an [X] line
function assertFails(result, number, pattern) {
    assert.strictEqual(result.status, 1, result.stdout);
    assert.match(result.block(number), /^\[X\]/);
    if (pattern) assert.match(result.block(number), pattern);
}

test('a clean file of 1,000 points passes every check with no warnings', () => {
    const result = validate(cleanPoints());
    assert.strictEqual(result.status, 0, result.stdout);
    assert.match(result.stdout, /ALL CHECKS PASSED \(1000 locations\)/);
    assert.doesNotMatch(result.stdout, /^\[X\]/m);
    assert.match(result.block('14a'), /: 0 to review/);
    assert.match(result.block('14b'), /: 0 points in 0 groups/);
    assert.match(result.block('14c'), /: 0 to review/);
});

test('check 4 fails on נסגר and on כפל as a whole word, not inside another word', () => {
    const result = validate([...cleanPoints(),
        point(101, 32.09, 34.79, { name: 'חנות - סניף נסגר' }),
        point(102, 32.091, 34.79, { name: 'בית ספר - כפל' }),
        point(103, 32.092, 34.79, { name: 'מערת המכפלה' })]);
    assertFails(result, 4, /2 issues/);
    assert.match(result.block(4), /id=101/);
    assert.match(result.block(4), /id=102/);
    assert.doesNotMatch(result.block(4), /id=103/);
});

test('check 11 fails on a string id', () => {
    const result = validate([...cleanPoints(), point('101', 32.09, 34.79)]);
    assertFails(result, 11, /1 issues/);
});

test('14a warns (exit 0) about a point 5.25 km from its city, not one 4.75 km away', () => {
    // Both points are straight north of the grid's top-left corner, so the
    // nearest same-city point is that corner and the distance is exact.
    const north = km => Number((GRID_TOP_LAT + km / KM_PER_DEGREE_LAT).toFixed(6));
    const far = validate([...cleanPoints(), point(101, north(5.25), 34.78)]);
    assert.strictEqual(far.status, 0, far.stdout);
    assert.match(far.block('14a'), /^\[!\].*: 1 to review\n    id=101: 5\.\d km - תל אביב/);

    const close = validate([...cleanPoints(), point(101, north(4.75), 34.78)]);
    assert.strictEqual(close.status, 0, close.stdout);
    assert.match(close.block('14a'), /: 0 to review/);
});

test('14a skips regional councils, with or without the מועצה אזורית prefix', () => {
    const spread = city => [
        point(101, 32.90, 35.20, { city, address: 'א, ' + city }),
        point(102, 32.99, 35.30, { city, address: 'ב, ' + city })];
    assert.match(validate([...cleanPoints(), ...spread('משגב')]).block('14a'), /: 0 to review/);
    assert.match(validate([...cleanPoints(), ...spread('מועצה אזורית מטה אשר')]).block('14a'), /: 0 to review/);
    assert.match(validate([...cleanPoints(), ...spread('כרמיאל')]).block('14a'), /: 2 to review/);
});

test('14b warns (exit 0) about one coordinate with two different streets', () => {
    const result = validate([...cleanPoints(),
        point(101, 32.09, 34.79, { address: 'הרצל 5, תל אביב' }),
        point(102, 32.09, 34.79, { address: 'ויצמן 3, תל אביב' })]);
    assert.strictEqual(result.status, 0, result.stdout);
    assert.match(result.block('14b'), /^\[!\].*: 2 points in 1 groups/);
    assert.match(result.block('14b'), /id=101/);
    assert.match(result.block('14b'), /id=102/);
});

test('14b does not flag one street written two ways, or an address that is only the city', () => {
    const result = validate([...cleanPoints(),
        // same street: street word and house number differ
        point(101, 32.09, 34.79, { address: 'שדרות יגאל אלון 3, תל אביב' }),
        point(102, 32.09, 34.79, { address: 'יגאל אלון 7, תל אביב' }),
        // a place name next to a city-only address
        point(103, 32.091, 34.79, { address: 'בית ספר ממלכתי א\', תל אביב' }),
        point(104, 32.091, 34.79, { address: 'תל אביב' })]);
    assert.strictEqual(result.status, 0, result.stdout);
    assert.match(result.block('14b'), /: 0 points in 0 groups/);
});

test('14c warns (exit 0) about the only point of a city that sits inside another city', () => {
    const result = validate([...cleanPoints(),
        point(101, 32.0841, 34.7821, { city: 'גבעתיים', address: 'כצנלסון 1, גבעתיים' })]);
    assert.strictEqual(result.status, 0, result.stdout);
    assert.match(result.block('14c'), /^\[!\].*: 1 to review\n    id=101: 5 of 5 nearest are תל אביב - גבעתיים/);
});

test('check 15 fails under 1,000 locations', () => {
    const result = validate(cleanPoints().slice(0, 999));
    assertFails(result, 15, /only 999 locations/);
});

test('check 16 fails when lat is a string or lng is missing', () => {
    const result = validate([...cleanPoints(),
        point(101, '32.09', 34.79),
        point(102, 32.09, null)]);
    assertFails(result, 16, /2 issues/);
    assert.match(result.block(16), /id=101: lat="32\.09"/);
    assert.match(result.block(16), /id=102: .*lng=null/);
});

test('check 17 fails on a tag or an HTML entity in name, address or city', () => {
    const result = validate([...cleanPoints(),
        point(101, 32.09, 34.79, { name: '<b>חנות</b>' }),
        point(102, 32.091, 34.79, { address: 'טום &amp; גרי 1, תל אביב' }),
        point(103, 32.092, 34.79, { name: 'ביה&#39;ס' }),
        point(104, 32.093, 34.79, { name: 'חנות A&B' })]); // a bare & is not an entity
    assertFails(result, 17, /3 issues/);
    assert.doesNotMatch(result.block(17), /id=104/);
});

test('check 18 fails on a coordinate inside a name', () => {
    const result = validate([...cleanPoints(), point(101, 32.09, 34.79, { name: 'מוקד איסוף - 32.218691' })]);
    assertFails(result, 18, /id=101/);
});

test('check 19 fails when the name is the whole address', () => {
    const result = validate([...cleanPoints(),
        point(101, 32.09, 34.79, { name: 'הרצל 1, תל אביב', address: 'הרצל 1, תל אביב' })]);
    assertFails(result, 19, /id=101/);
});

test('check 20 fails on a facility that is not in facilities.json and on a store id under 100', () => {
    // facilities.json in the repository is empty on purpose, so any facility record is unknown
    const result = validate([...cleanPoints(),
        point(150, 32.09, 34.79, { type: 'facility', description: 'מפעל' }),
        point(50, 32.091, 34.79)]);
    assertFails(result, 20);
    assert.match(result.block(20), /id=150: facility .* is not in facilities\.json/);
    assert.match(result.block(20), /id=150: facility id outside 1-99/);
    assert.match(result.block(20), /id=50: "store" id below 100/);
});

test('check 21 fails on two city names one letter apart', () => {
    const result = validate([...cleanPoints(),
        point(101, 31.77, 35.21, { city: 'ירושלים', address: 'יפו 1, ירושלים' }),
        point(102, 31.771, 35.21, { city: 'ירשלים', address: 'יפו 2, ירשלים' })]);
    assertFails(result, 21, /1 issues\n    id=-: ירושלים \(1\) \/ ירשלים \(1\)/);
});

test('check 21 skips 3-letter pairs and pairs in KNOWN_DISTINCT_CITIES', () => {
    const result = validate([...cleanPoints(),
        point(101, 32.43, 34.92, { city: 'חדרה', address: 'א 1, חדרה' }),   // חדרה / גדרה are in the list
        point(102, 31.81, 34.78, { city: 'גדרה', address: 'א 1, גדרה' }),
        point(103, 31.95, 34.89, { city: 'לוד', address: 'א 1, לוד' }),     // 3 letters each
        point(104, 31.96, 34.89, { city: 'לוב', address: 'א 1, לוב' })]);
    assert.strictEqual(result.status, 0, result.stdout);
    assert.match(result.block(21), /^\[\+\]/);
});
