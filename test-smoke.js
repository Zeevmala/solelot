// Smoke test of the real page (index.html + app.js + sw.js) in a real browser.
//
//   node test-smoke.js                 run every check against this folder
//   node test-smoke.js --root <dir>    run against another copy of the site
//   node test-smoke.js --only <text>   run only the checks whose name contains <text>
//
// NOT part of the gate (bash .factory/check.sh): the gate must work offline and
// without installed packages. This script needs
//   - Playwright, installed outside this repository (npm i -g playwright, or NODE_PATH)
//   - network access to unpkg.com (Leaflet) and tile.openstreetmap.org (map tiles)
// It starts its own small web server for the folder, prints one "ok" or "FAIL"
// line per check and exits with 1 if any check failed.
//
// The unit tests (test.html, test-map.html) test copies of the pure functions.
// This file tests what they cannot see: that the page is wired to those functions.

const http = require('http');
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
    // A globally installed package is not found by require() unless NODE_PATH points at it.
    const globalDir = process.env.NODE_PATH || path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules');
    for (const name of ['playwright', path.join(globalDir, 'playwright')]) {
        try { return require(name); } catch (e) { /* try the next place */ }
    }
    console.error('Playwright is not installed. Install it outside the repository: npm i -g playwright');
    process.exit(2);
}
const { chromium } = loadPlaywright();

const args = process.argv.slice(2);
const argValue = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ROOT = path.resolve(argValue('--root') || __dirname);
const ONLY = argValue('--only');
// The checks about timing repeat themselves; SMOKE_RUNS=5 node test-smoke.js repeats them more
const RUNS = Number(process.env.SMOKE_RUNS || 2);

// Texts and places the checks use. They must exist in locations.json;
// a check says so clearly if the data changed and one of them is gone.
const CITY = 'חדרה';            // a city whose name also appears in other cities' addresses
const SHOP_TEXT = 'מגה';        // a shop name that is not a city
const CITY_2 = 'לוד';           // any other city
const PART_OF_CITY = 'גלי';     // inside the city name נוף הגליל, but not a city itself
const TEL_AVIV = { latitude: 32.0853, longitude: 34.7818, accuracy: 30 };

// ---------- a small static web server for ROOT ----------
// "faults" lets a check break a file on purpose: { '/style.css': 404 }
// "swVersion" serves sw.js with another cache name, as a new deploy would.
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
    json: 'application/json', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2', svg: 'image/svg+xml' };
const server = { faults: {}, swVersion: null, base: '' };
function startServer() {
    const httpServer = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (server.faults[urlPath]) { res.writeHead(server.faults[urlPath]); res.end('fault'); return; }
        const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
        let body = fs.readFileSync(file);
        if (urlPath === '/sw.js' && server.swVersion) {
            body = Buffer.from(body.toString('utf8').replace(/const STATIC_CACHE = '[^']+'/, `const STATIC_CACHE = '${server.swVersion}'`));
        }
        res.writeHead(200, { 'Content-Type': TYPES[file.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
    });
    return new Promise(resolve => httpServer.listen(0, '127.0.0.1', () => {
        server.base = `http://127.0.0.1:${httpServer.address().port}/`;
        resolve(httpServer);
    }));
}

// ---------- browser helpers ----------
let browser;
const PHONE = { width: 375, height: 667 };
const DESKTOP = { width: 1280, height: 800 };

// Opens a fresh browser profile and a page. Collects everything that went wrong on it.
async function openPage(options = {}) {
    const context = await browser.newContext(Object.assign(
        { serviceWorkers: 'block', viewport: DESKTOP, locale: 'he-IL' }, options));
    const page = await context.newPage();
    const problems = [];
    page.on('console', m => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });
    page.on('pageerror', e => problems.push('page error: ' + e.message));
    page.on('response', r => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    return { context, page, problems };
}

const dataLoaded = page => page.waitForFunction(
    () => typeof allLocations !== 'undefined' && allLocations.length > 0 && document.getElementById('loading-overlay').style.display === 'none',
    null, { timeout: 30000 });

async function openApp(options = {}, query = '') {
    const opened = await openPage(options);
    await opened.page.goto(server.base + query);
    await dataLoaded(opened.page);
    return opened;
}

// What the map shows right now
const shown = page => page.evaluate(() => {
    const onMap = new Set(markerCluster.getLayers().concat(facilityLayer.getLayers()));
    const locations = allMarkers.filter(item => onMap.has(item.marker)).map(item => item.location);
    return {
        count: locations.length,
        total: allLocations.length,
        cities: [...new Set(locations.map(l => l.city))],
        box: document.getElementById('search-input').value,
        listOpen: document.getElementById('search-suggestions').classList.contains('active')
    };
});
// How many locations contain a text, counted without the app's search code
const containing = (page, text) => page.evaluate(
    t => allLocations.filter(l => [l.name, l.address, l.city].some(field => field.includes(t))).length, text);
const inCity = (page, city) => page.evaluate(c => allLocations.filter(l => l.city === c).length, city);

const type = (page, text, delay = 30) => page.locator('#search-input').pressSequentially(text, { delay });
const press = (page, key) => page.locator('#search-input').press(key);
const clearSearch = async page => { await page.evaluate(() => document.getElementById('search-clear').click()); await page.waitForTimeout(400); };
const settle = (page, ms = 700) => page.waitForTimeout(ms); // longer than the 300 ms typing wait

// Resolves when the map has stood still for a second (same centre and zoom, no pins
// being added). Fails loudly if that does not happen in time.
const mapSettled = (page, timeout = 90000) => page.evaluate(ms => new Promise((resolve, reject) => {
    const started = Date.now();
    let last = '', still = 0;
    const look = () => {
        const busy = markerAddRunning || redrawWanted || map._animatingZoom;
        const now = [map.getCenter().lat.toFixed(6), map.getCenter().lng.toFixed(6), map.getZoom()].join();
        still = (now === last && !busy) ? still + 1 : 0;
        last = now;
        if (still >= 5) resolve();
        else if (Date.now() - started > ms) reject(new Error('the map did not come to rest in ' + ms / 1000 + ' s'));
        else setTimeout(look, 200);
    };
    look();
}), timeout);

const slowDown = async (context, page, rate) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
};

// Selected pins that can really be seen (on screen, and on a phone not under the sheet)
const visibleSelectedPins = page => page.evaluate(() => {
    const sheet = document.getElementById('sidebar').getBoundingClientRect();
    const bottom = window.innerWidth <= 768 ? sheet.top : window.innerHeight;
    return [...document.querySelectorAll('.battery-marker.selected')].filter(el => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.top >= 0 && box.left >= 0 && box.right <= window.innerWidth && box.bottom <= bottom && getComputedStyle(el).opacity !== '0';
    }).length;
});

function expect(condition, message) {
    if (!condition) throw new Error(message);
}

// ---------- the checks ----------
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('plain load: no console errors, tiles load with crossorigin, MAI credit shown', async () => {
    const { context, page, problems } = await openApp();
    const tileState = async () => {
        await page.waitForFunction(() => { const t = [...document.querySelectorAll('img.leaflet-tile')]; return t.length > 0 && t.every(i => i.complete); }, null, { timeout: 20000 });
        return page.evaluate(() => { const t = [...document.querySelectorAll('img.leaflet-tile')];
            return { n: t.length, cors: t.filter(i => i.getAttribute('crossorigin') !== null).length, loaded: t.filter(i => i.naturalWidth > 0).length }; });
    };
    const tiles = await tileState();
    await page.click('.basemap-toggle-btn'); // the second basemap is a separate tile layer
    const tiles2 = await tileState();
    const credit = await page.evaluate(() => [...document.querySelectorAll('.leaflet-control-attribution a')].map(a => a.textContent.trim() + '|' + a.href));
    await context.close();
    expect(problems.length === 0, 'problems on plain load: ' + problems.join(' ; '));
    expect(tiles.n > 0 && tiles.cors === tiles.n && tiles.loaded === tiles.n, 'tiles of the first basemap: ' + JSON.stringify(tiles));
    expect(tiles2.n > 0 && tiles2.cors === tiles2.n && tiles2.loaded === tiles2.n, 'tiles of the second basemap: ' + JSON.stringify(tiles2));
    expect(credit.includes('נתונים: תאגיד מ.א.י|https://mai.org.il/'), 'no MAI credit link in the attribution: ' + credit.join(', '));
    expect(credit.some(c => c.startsWith('OpenStreetMap|')), 'no OpenStreetMap credit');
});

check('picking a city suggestion shows only that city', async () => {
    const { context, page } = await openApp();
    const own = await inCity(page, CITY), byText = await containing(page, CITY);
    expect(own > 0 && byText > own, `data changed: ${CITY} has ${own} points and ${byText} contain the text; pick another CITY`);
    await type(page, CITY);
    await page.locator(`.suggestion-item[data-type="city"][data-value="${CITY}"]`).click();
    await settle(page);
    const s = await shown(page);
    await context.close();
    expect(s.count === own && s.cities.join() === CITY, `after picking ${CITY}: ${s.count} shown (city has ${own}), cities: ${s.cities.slice(0, 5)}`);
});

check('Enter: a typed shop name keeps the typed result; only a typed city is picked', async () => {
    const { context, page } = await openApp();
    for (const text of [SHOP_TEXT, PART_OF_CITY]) {
        await type(page, text); await settle(page);
        const typed = await shown(page);
        expect(typed.count > 0, `data changed: nothing contains "${text}"`);
        await press(page, 'Enter'); await settle(page);
        const after = await shown(page);
        expect(after.count === typed.count && after.box === text && !after.listOpen,
            `"${text}" + Enter: ${typed.count} shown while typing, ${after.count} after Enter, box "${after.box}", list open ${after.listOpen}`);
        await clearSearch(page);
    }
    const own = await inCity(page, CITY);
    await type(page, CITY); await press(page, 'Enter'); await settle(page);
    const s = await shown(page);
    await context.close();
    expect(s.count === own && s.cities.join() === CITY, `"${CITY}" + Enter: ${s.count} shown, city has ${own}`);
});

check('Enter is repeatable: Enter twice, Escape then Enter, map click then Enter keep the city', async () => {
    const { context, page } = await openApp();
    const own = await inCity(page, CITY);
    const mustBeCity = async step => { await settle(page, 1300); const s = await shown(page);
        expect(s.count === own && s.cities.join() === CITY, `${step}: ${s.count} shown, city has ${own}`); };
    await type(page, CITY); await press(page, 'Enter'); await mustBeCity('Enter');
    await press(page, 'Enter'); await mustBeCity('Enter twice');
    await clearSearch(page);
    await type(page, CITY); await settle(page); await press(page, 'Escape'); await press(page, 'Enter'); await mustBeCity('Escape then Enter');
    await clearSearch(page);
    await type(page, CITY); await settle(page); await page.mouse.click(640, 600); await settle(page, 400);
    await press(page, 'Enter'); await mustBeCity('map click then Enter');
    await context.close();
});

check('the map follows the text in the box (typing wait, clear, pick)', async () => {
    const { context, page } = await openApp();
    // 1. typing updates the map although the suggestion list is open
    await type(page, CITY); await settle(page);
    let s = await shown(page); const byText = await containing(page, CITY);
    expect(s.listOpen && s.count === byText, `typed "${CITY}": ${s.count} shown, ${byText} contain it (list open: ${s.listOpen})`);
    await clearSearch(page);
    // 2. clear inside the 300 ms typing wait: the old text must not come back
    await type(page, 'רמת', 10); await page.evaluate(() => document.getElementById('search-clear').click()); await settle(page);
    s = await shown(page);
    expect(s.box === '' && s.count === s.total, `clear inside the typing wait: box "${s.box}", ${s.count} of ${s.total} shown`);
    // 3. a location picked inside the typing wait: box empty, everything shown
    await type(page, 'מוקד', 10);
    await page.locator('.suggestion-item[data-type="location"]').first().click(); await settle(page, 2500);
    s = await shown(page);
    await context.close();
    expect(s.box === '' && s.count === s.total, `location picked inside the typing wait: box "${s.box}", ${s.count} of ${s.total} shown`);
});

check('?action=nearest waits for the data, then shows the nearest point', async () => {
    const { context, page, problems } = await openPage({ geolocation: TEL_AVIV, permissions: ['geolocation'] });
    // locations.json arrives 2 seconds late, as on a slow connection
    await page.route('**/locations.json', async route => {
        if (route.request().resourceType() === 'fetch') await new Promise(done => setTimeout(done, 2000));
        route.continue();
    });
    await page.goto(server.base + '?action=nearest');
    const ok = await page.waitForFunction(() => document.getElementById('notification').textContent.startsWith('הנקודה הקרובה:'), null, { timeout: 15000 }).then(() => true, () => false);
    const toast = await page.textContent('#notification');
    const active = await page.evaluate(() => typeof gpsActive !== 'undefined' && gpsActive);
    await context.close();
    expect(ok && active, `toast was "${toast}", locate button active: ${active} ${problems.filter(p => p.startsWith('page')).join(' ; ')}`);
});

// A location with at least two others within about 30 metres: its pin stays inside
// a cluster until the map is zoomed in all the way.
const tightClusterLocation = page => page.evaluate(() => {
    for (const a of allLocations) {
        const near = allLocations.filter(b => b !== a && Math.abs(a.lat - b.lat) < 0.0003 && Math.abs(a.lng - b.lng) < 0.0003);
        if (near.length >= 2 && a.name.length <= 50 && allLocations.filter(b => b.name === a.name).length === 1) return { id: a.id, name: a.name };
    }
    return null;
});

async function pickFromSuggestions(viewport, cpuSlowdown) {
    const { context, page, problems } = await openApp({ viewport });
    const target = await tightClusterLocation(page);
    expect(target, 'data changed: no location with two close neighbours');
    if (cpuSlowdown > 1) await slowDown(context, page, cpuSlowdown);
    await page.locator('#search-input').fill(target.name); // long enough to wait out the typing delay below
    await page.locator(`.suggestion-item[data-id="${target.id}"]`).click({ timeout: 60000 });
    // wait until the map stops moving, not for a fixed time: a slowed-down browser needs longer
    await mapSettled(page);
    const result = { pins: await visibleSelectedPins(page), zoom: await page.evaluate(() => map.getZoom()),
        title: await page.evaluate(() => (document.querySelector('#sidebar h2') || {}).textContent) };
    const errors = problems.filter(p => p.startsWith('page error'));
    // closing the details takes the "selected" mark off again
    await page.keyboard.press('Escape'); await page.waitForTimeout(600 * Math.max(1, cpuSlowdown / 2));
    const afterClose = await page.evaluate(() => document.querySelectorAll('.battery-marker.selected').length);
    // tapping a pin that is already drawn marks it selected too
    let afterTap = 1;
    if (cpuSlowdown === 1) {
        await page.locator(`.battery-marker[aria-label^="${target.name} - "]`).click({ force: true });
        await page.waitForTimeout(600);
        afterTap = await visibleSelectedPins(page);
    }
    await context.close();
    const where = `${viewport.width}px, CPU ${cpuSlowdown}x slower, "${target.name}"`;
    expect(errors.length === 0, `${where}: ${errors.join(' ; ')}`);
    expect(result.title === target.name, `${where}: details show "${result.title}"`);
    expect(result.pins === 1, `${where}: ${result.pins} visible selected pins at zoom ${result.zoom} (wanted exactly 1)`);
    expect(afterClose === 0, `${where}: ${afterClose} pins still marked selected after the details were closed`);
    expect(afterTap === 1, `${where}: ${afterTap} visible selected pins after tapping the pin (wanted exactly 1)`);
}
check('picking a location inside a tight cluster shows it as the one selected pin (desktop)', () => pickFromSuggestions(DESKTOP, 1));
check('picking a location inside a tight cluster shows it as the one selected pin (phone)', () => pickFromSuggestions(PHONE, 1));
check('the same on a slow phone (CPU 4x slower): pins are still being added when it is picked', () => pickFromSuggestions(PHONE, 4));
check('the same on a very slow phone (CPU 6x slower)', () => pickFromSuggestions(PHONE, 6));

check('a search change while pins are still being added ends with the pins of the final text', async () => {
    // 1. On a slow phone the first typed letter starts adding thousands of pins;
    //    the rest of the word and Enter arrive before that has finished.
    for (let run = 1; run <= RUNS; run++) {
        const { context, page, problems } = await openApp({ viewport: PHONE });
        const own = await inCity(page, CITY);
        await slowDown(context, page, 6);
        await page.locator('#search-input').focus();
        await page.keyboard.type(CITY); await page.keyboard.press('Enter');
        await mapSettled(page);
        const s = await shown(page);
        const errors = problems.filter(p => p.startsWith('page error'));
        await context.close();
        expect(errors.length === 0, `type + Enter, run ${run}: ${errors.join(' ; ')}`);
        expect(s.count === own && s.cities.join() === CITY, `type "${CITY}" + Enter at once, run ${run}: ${s.count} pins in ${s.cities.length} cities (the city has ${own})`);
    }
    // 2. Clear (all pins come back, slowly) and new text at once
    for (let run = 1; run <= RUNS; run++) {
        const { context, page } = await openApp({ viewport: PHONE });
        const byText = await containing(page, CITY);
        await slowDown(context, page, 6);
        await type(page, SHOP_TEXT); await mapSettled(page);
        await page.locator('#search-clear').click(); await page.keyboard.insertText(CITY);
        await page.waitForTimeout(1500); await mapSettled(page);
        const s = await shown(page);
        await context.close();
        expect(s.box === CITY && s.count === byText, `clear, then "${CITY}" at once, run ${run}: ${s.count} pins shown, ${byText} contain the text`);
    }
    // 3. Three changes with no pause between them: a city, clear, another city
    for (let run = 1; run <= RUNS; run++) {
        const { context, page } = await openApp({ viewport: PHONE });
        const own = await inCity(page, CITY_2);
        expect(own > 0, `data changed: no points in ${CITY_2}`);
        await slowDown(context, page, 4);
        await page.evaluate(([one, two]) => {
            const box = document.getElementById('search-input');
            const typeText = t => { box.value = t; box.dispatchEvent(new Event('input', { bubbles: true })); };
            const enter = () => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            typeText(one); enter();
            document.getElementById('search-clear').click();
            typeText(two); enter();
        }, [CITY, CITY_2]);
        await mapSettled(page);
        const s = await shown(page);
        await context.close();
        expect(s.count === own && s.cities.join() === CITY_2, `"${CITY}", clear, "${CITY_2}" in one go, run ${run}: ${s.count} pins in ${s.cities.length} cities (${CITY_2} has ${own})`);
    }
});

// Two places far apart, each with a name no other place has
const farApartPlaces = page => page.evaluate(() => {
    const unique = l => l.name.length <= 50 && allLocations.filter(o => o.name === l.name).length === 1;
    const north = allLocations.find(l => l.lat > 32.7 && unique(l));
    const south = allLocations.find(l => l.lat < 31.4 && unique(l));
    return [north, south].map(l => ({ id: l.id, name: l.name, lat: l.lat, lng: l.lng }));
});
// Things done inside the page in one go, faster than any person: no pause for the app to catch up
const typeInPage = (page, text) => page.evaluate(t => {
    const box = document.getElementById('search-input');
    box.value = t;
    box.dispatchEvent(new Event('input', { bubbles: true }));
}, text);
const pickInPage = (page, place) => page.evaluate(p => {
    const box = document.getElementById('search-input');
    box.value = p.name;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector(`.suggestion-item[data-id="${p.id}"]`).click();
}, place);
const enterInPage = page => page.evaluate(() =>
    document.getElementById('search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
// "Zooming to a clustered pin" has started / has just ended
const revealRunning = page => page.waitForFunction(() => cancelReveal !== null, null, { polling: 'raf', timeout: 15000 });
const revealOver = page => page.waitForFunction(() => cancelReveal === null, null, { polling: 'raf', timeout: 15000 });
const endsAt = async (page, place, step) => {
    await mapSettled(page);
    const end = await page.evaluate(b => ({ km: getDistance(map.getCenter().lat, map.getCenter().lng, b.lat, b.lng), title: document.querySelector('#sidebar h2').textContent }), place);
    const pins = await visibleSelectedPins(page);
    expect(end.title === place.name && end.km < 2 && pins === 1, `${step}: details "${end.title}", map centre ${end.km.toFixed(1)} km from "${place.name}", ${pins} visible selected pins`);
};

check('a second pick right after the first ends at the second place', async () => {
    // 1. no pause at all
    let { context, page, problems } = await openApp();
    let [first, second] = await farApartPlaces(page);
    await pickInPage(page, first); await pickInPage(page, second);
    await endsAt(page, second, 'two picks with no pause');
    await context.close();
    // 2. the second pick while the map is still zooming in to the first one
    ({ context, page, problems } = await openApp());
    await pickInPage(page, first); await revealRunning(page); await pickInPage(page, second);
    await endsAt(page, second, 'second pick while zooming to the first');
    await context.close();
    // 3. on a phone, the second pick while the map is flying the last stretch to the first one
    ({ context, page, problems } = await openApp({ viewport: PHONE }));
    await pickInPage(page, first); await revealRunning(page); await revealOver(page); await pickInPage(page, second);
    await endsAt(page, second, 'second pick during the flight to the first (phone)');
    const errors = problems.filter(p => p.startsWith('page error'));
    await context.close();
    expect(errors.length === 0, 'page errors: ' + errors[0]);
});

check('a search while the map is zooming to a picked place leaves no broken listener behind', async () => {
    const { context, page, problems } = await openApp();
    const [first] = await farApartPlaces(page);
    const own = await inCity(page, CITY);
    await pickInPage(page, first); await revealRunning(page);
    await typeInPage(page, CITY); await enterInPage(page);
    await mapSettled(page);
    // move the map a few times: a listener left behind throws on every movement
    for (let i = 0; i < 3; i++) {
        await page.mouse.move(640, 450); await page.mouse.down(); await page.mouse.move(700, 500, { steps: 5 }); await page.mouse.up();
        await page.waitForTimeout(500);
    }
    await page.keyboard.press('Escape');
    const s = await shown(page);
    const errors = problems.filter(p => p.startsWith('page error'));
    await context.close();
    expect(errors.length === 0, `${errors.length} page errors after the map was moved: ${errors[0]}`);
    expect(s.count === own && s.cities.join() === CITY, `pick, then "${CITY}" + Enter: ${s.count} shown, city has ${own}`);
});

check('a failed locations.json shows the error panel; retry brings the normal texts back', async () => {
    const { context, page } = await openPage();
    let calls = 0;
    await page.route('**/locations.json', route => {
        if (route.request().resourceType() !== 'fetch') return route.continue(); // the <link rel="prefetch"> request
        calls++;
        return calls === 1 ? route.fulfill({ status: 500, body: 'broken' }) : route.continue();
    });
    await page.goto(server.base);
    await page.waitForFunction(() => document.getElementById('empty-state').style.display === 'block', null, { timeout: 15000 });
    const panel = () => page.evaluate(() => ({ title: document.querySelector('#empty-state h3').textContent, button: document.getElementById('clear-filters').textContent,
        shown: document.getElementById('empty-state').style.display === 'block', legend: getComputedStyle(document.querySelector('.map-legend')).display }));
    const failed = await panel();
    expect(failed.title === 'שגיאה בטעינת הנתונים' && failed.button === 'נסה שוב' && failed.legend === 'none', 'after the failed load: ' + JSON.stringify(failed));
    await page.click('#clear-filters'); await dataLoaded(page);
    expect(!(await panel()).shown, 'the panel is still shown after a successful retry');
    await type(page, 'zzzzqqqq', 5); await settle(page);
    const empty = await panel();
    await context.close();
    expect(empty.shown && empty.title === 'לא נמצאו תוצאות' && empty.button === 'נקה סינון', 'a search with no results after the retry shows: ' + JSON.stringify(empty));
});

check('a record with markup in its id (or text coordinates) is not loaded and injects nothing', async () => {
    const { context, page } = await openPage({ viewport: PHONE });
    const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'locations.json'), 'utf8')).locations[0];
    const records = [
        Object.assign({}, real, { id: '1"><img src=x onerror="window.injected=1">', name: 'רעה אחת' }),
        Object.assign({}, real, { id: '77', name: 'רעה שתיים' }),
        Object.assign({}, real, { id: 5001, name: 'רעה שלוש', lat: String(real.lat) }),
        Object.assign({}, real, { id: 5002, name: 'טובה' })
    ];
    await page.route('**/locations.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ locations: records }) }));
    await page.goto(server.base); await dataLoaded(page);
    await type(page, 'רעה'); await settle(page);
    const bad = await page.evaluate(() => ({ loaded: allLocations.map(l => l.id), suggestions: document.querySelectorAll('.suggestion-item').length }));
    await clearSearch(page);
    await type(page, 'טובה'); await settle(page, 400);
    await page.locator('.suggestion-item[data-type="location"]').first().click(); await settle(page, 2000);
    const after = await page.evaluate(() => ({ injected: window.injected, images: document.querySelectorAll('img[src="x"]').length, likeIds: [...document.querySelectorAll('[data-like-id]')].map(e => e.dataset.likeId) }));
    await context.close();
    expect(JSON.stringify(bad.loaded) === '[5002]' && bad.suggestions === 0, 'loaded ids: ' + JSON.stringify(bad));
    expect(after.injected === undefined && after.images === 0 && after.likeIds.join() === '5002', 'after opening the good record: ' + JSON.stringify(after));
});

check('if Leaflet does not arrive, an error panel with a reload button replaces the loading screen', async () => {
    const { context, page } = await openPage();
    await page.route('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', route => route.abort());
    await page.goto(server.base); await page.waitForTimeout(1500);
    const panel = await page.evaluate(() => ({ title: document.querySelector('#empty-state h3').textContent, button: document.getElementById('clear-filters').textContent,
        panel: getComputedStyle(document.getElementById('empty-state')).display, loading: getComputedStyle(document.getElementById('loading-overlay')).display }));
    expect(panel.title === 'שגיאה בטעינת המפה' && panel.button === 'טען מחדש' && panel.panel === 'block' && panel.loading === 'none', JSON.stringify(panel));
    await page.unroute('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
    await Promise.all([page.waitForNavigation(), page.click('#clear-filters')]);
    await dataLoaded(page);
    await context.close();
});

// Waits until a service worker controls the page and its cache is filled
async function openWithServiceWorker() {
    const opened = await openPage({ serviceWorkers: 'allow' });
    await opened.page.goto(server.base);
    await dataLoaded(opened.page);
    await opened.page.evaluate(() => navigator.serviceWorker.ready);
    await opened.page.reload(); // the first load was not controlled by the worker yet
    await dataLoaded(opened.page);
    await opened.page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    return opened;
}
const cacheState = page => page.evaluate(async () => {
    const names = (await caches.keys()).filter(n => n.startsWith('static-'));
    const entries = {};
    for (const name of names) entries[name] = (await (await caches.open(name)).keys()).length;
    return entries;
});

check('the service worker registers, and an offline reload still shows the markers', async () => {
    const { context, page } = await openWithServiceWorker();
    await context.setOffline(true);
    await page.reload();
    const worked = await dataLoaded(page).then(() => true, () => false);
    const count = worked ? (await shown(page)).count : 0;
    await context.close();
    expect(worked && count > 1000, `offline reload: page loaded ${worked}, ${count} markers`);
});

check('a deploy with a missing precached file keeps the old service worker and its cache', async () => {
    const { context, page } = await openWithServiceWorker();
    try {
        const before = await cacheState(page);
        const oldName = Object.keys(before)[0];
        expect(Object.keys(before).length === 1 && before[oldName] >= 10, 'cache before the deploy: ' + JSON.stringify(before));
        // the "deploy": sw.js has a new cache name, and one file it must cache answers 404
        server.swVersion = 'static-smoke-new';
        server.faults['/style.css'] = 404;
        const result = await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            const oldWorker = registration.active;
            await registration.update();
            const fresh = registration.installing || registration.waiting;
            if (fresh && fresh.state !== 'redundant' && fresh.state !== 'activated') {
                await new Promise(done => { fresh.addEventListener('statechange', () => { if (['redundant', 'activated'].includes(fresh.state)) done(); }); setTimeout(done, 15000); });
            }
            await new Promise(done => setTimeout(done, 1000));
            return { sawNewWorker: !!fresh, newState: fresh && fresh.state, waiting: registration.waiting, installing: registration.installing, sameActive: registration.active === oldWorker };
        });
        const after = await cacheState(page);
        expect(result.sawNewWorker, 'the browser did not try to install the changed sw.js, so nothing was tested');
        expect(result.newState === 'redundant' && result.waiting === null && result.installing === null && result.sameActive, 'the broken worker was not dropped: ' + JSON.stringify(result));
        expect(after[oldName] === before[oldName] && !Object.keys(after).some(n => n === 'static-smoke-new' && after[n] >= before[oldName]),
            `cache before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
        expect(Object.keys(after).includes(oldName), 'the old cache was deleted');
    } finally {
        server.swVersion = null;
        server.faults = {};
        await context.close();
    }
});

// ---------- run ----------
(async () => {
    const httpServer = await startServer();
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {});
    console.log(`smoke test of ${ROOT} at ${server.base}`);
    let failed = 0, ran = 0;
    for (const { name, fn } of checks) {
        if (ONLY && !name.includes(ONLY)) continue;
        ran++;
        try {
            await fn();
            console.log('ok    ' + name);
        } catch (error) {
            failed++;
            console.log('FAIL  ' + name + '\n      ' + String(error.message).split('\n')[0]);
        }
    }
    await browser.close();
    httpServer.close();
    console.log(failed === 0 ? `\nSMOKE PASSED (${ran} checks)` : `\nSMOKE FAILED (${failed} of ${ran} checks)`);
    process.exit(failed === 0 && ran > 0 ? 0 : 1);
})();
