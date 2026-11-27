// Smoke test of the real page (index.html + app.js + sw.js) in a real browser.
//
//   node test-smoke.js                 run every check against this folder
//   node test-smoke.js --root <dir>    run against another copy of the site
//   node test-smoke.js --only <text>   run only the checks whose name contains <text>
//
// NOT part of the gate (bash .factory/check.sh): the gate must work offline and
// without installed packages. This script needs
//   - Playwright, installed outside this repository (npm i -g playwright, or NODE_PATH)
//   - network access to tile.openstreetmap.org (map tiles)
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
// "indexTitle" serves index.html with another <title>, so a check can tell the new page from the old.
// "maxAge" sends Cache-Control: max-age=N instead of no-store, as GitHub Pages does (600 s).
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
    json: 'application/json', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2', svg: 'image/svg+xml' };
const server = { faults: {}, swVersion: null, indexTitle: null, maxAge: null, base: '' };
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
        if (file === path.join(ROOT, 'index.html') && server.indexTitle) {
            body = Buffer.from(body.toString('utf8').replace(/<title>[^<]*<\/title>/, `<title>${server.indexTitle}</title>`));
        }
        res.writeHead(200, { 'Content-Type': TYPES[file.split('.').pop()] || 'application/octet-stream',
            'Cache-Control': server.maxAge ? `max-age=${server.maxAge}` : 'no-store' });
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
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    const attribution = await page.evaluate(() => { const el = document.querySelector('.leaflet-control-attribution');
        return { text: el.textContent, links: el.querySelectorAll('a').length, width: Math.round(el.getBoundingClientRect().width) }; });
    await context.close();
    expect(problems.length === 0, 'problems on plain load: ' + problems.join(' ; '));
    expect(tiles.n > 0 && tiles.cors === tiles.n && tiles.loaded === tiles.n, 'tiles of the first basemap: ' + JSON.stringify(tiles));
    expect(tiles2.n > 0 && tiles2.cors === tiles2.n && tiles2.loaded === tiles2.n, 'tiles of the second basemap: ' + JSON.stringify(tiles2));
    expect(credit.includes('נתונים: תאגיד מ.א.י|https://mai.org.il/'), 'no MAI credit link in the attribution: ' + credit.join(', '));
    expect(credit.some(c => c.startsWith('OpenStreetMap|')), 'no OpenStreetMap credit');
    expect(!/Leaflet/.test(attribution.text) && attribution.links === 2, 'the credit line has no Leaflet prefix, only the two data credits: ' + JSON.stringify(attribution));
    expect(attribution.width <= 390 - 24, 'the credit line is wider than the phone: ' + JSON.stringify(attribution));
});

check('light basemap keeps a hint of colour: the sea reads as sea', async () => {
    const { context, page, problems } = await openApp({ viewport: { width: 390, height: 844 } });
    await page.evaluate(() => map.setView([32.0, 34.4], 8, { animate: false }));
    await page.waitForFunction(() => { const t = [...document.querySelectorAll('img.leaflet-tile')]; return t.length > 0 && t.every(i => i.complete && i.naturalWidth > 0); }, null, { timeout: 20000 });
    // a sea pixel, drawn through the same CSS filter the light basemap uses
    const sea = await page.evaluate(() => {
        const at = map.latLngToContainerPoint([32.4, 34.2]); const box = map.getContainer().getBoundingClientRect();
        const tile = [...document.querySelectorAll('.basemap-light img.leaflet-tile')].find(img => { const b = img.getBoundingClientRect();
            return box.left + at.x >= b.left && box.left + at.x < b.right && box.top + at.y >= b.top && box.top + at.y < b.bottom; });
        if (!tile) return null;
        const b = tile.getBoundingClientRect();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d'); ctx.filter = getComputedStyle(tile.parentElement.parentElement).filter; ctx.drawImage(tile, 0, 0);
        const [r, g, bl] = ctx.getImageData(Math.floor((box.left + at.x - b.left) * 256 / b.width), Math.floor((box.top + at.y - b.top) * 256 / b.height), 1, 1).data;
        return { r, g, b: bl, filter: ctx.filter };
    });
    await context.close();
    expect(sea && sea.b - sea.r >= 10, 'sea pixel at zoom 8: ' + JSON.stringify(sea));
    expect(problems.length === 0, problems.join(' ; '));
});

// "עודכן d.m.yyyy" as data_meta.json says, in Israel time (the same rule as formatUpdatedDate in app.js)
const expectedUpdated = () => {
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data_meta.json'), 'utf8'));
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(meta.fetched_at));
    const part = type => Number(parts.find(p => p.type === type).value); // en-GB writes 05, people write 5
    return `עודכן ${part('day')}.${part('month')}.${part('year')}`;
};
const creditText = page => page.evaluate(() => document.querySelector('.leaflet-control-attribution').textContent);

check('the credit line says when the data was updated; without data_meta.json it says nothing and logs nothing', async () => {
    const wanted = expectedUpdated();
    let { context, page, problems } = await openApp({ viewport: { width: 390, height: 844 } });
    await page.waitForFunction(w => document.querySelector('.leaflet-control-attribution').textContent.includes(w), wanted, { timeout: 5000 }).catch(() => {});
    const text = await creditText(page);
    const box = await page.evaluate(() => { const b = document.querySelector('.leaflet-control-attribution').getBoundingClientRect(); return { width: Math.round(b.width), height: Math.round(b.height) }; });
    await context.close();
    const mai = text.indexOf('נתונים: תאגיד מ.א.י'), date = text.indexOf(wanted), osm = text.indexOf('OpenStreetMap');
    expect(mai >= 0 && date > mai && osm > date, `credit line "${text}", wanted "${wanted}" after the MAI credit`);
    expect(box.width <= 390 - 24 && box.height <= 24, 'credit line box at 390 px: ' + JSON.stringify(box));
    expect(problems.length === 0, problems.join(' ; '));
    // the file missing, then broken: no date, no error from the page
    for (const fault of [{ status: 404 }, { status: 200, body: 'not json' }, { status: 200, body: '{"fetched_at":"<b>x</b>"}' }]) {
        ({ context, page, problems } = await openPage({ viewport: { width: 390, height: 844 } }));
        await page.route('**/data_meta.json', route => route.fulfill({ status: fault.status, contentType: 'application/json', body: fault.body || 'missing' }));
        await page.goto(server.base); await dataLoaded(page); await page.waitForTimeout(800);
        const without = await creditText(page);
        await context.close();
        const own = problems.filter(p => p.startsWith('page error') || (p.startsWith('console error') && !p.includes('Failed to load resource')));
        expect(!without.includes('עודכן') && without.includes('נתונים: תאגיד מ.א.י') && without.includes('OpenStreetMap'), `${JSON.stringify(fault)}: credit line "${without}"`);
        expect(own.length === 0, `${JSON.stringify(fault)}: ${own.join(' ; ')}`);
    }
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

// After "nearest": the details of the nearest point are open, its pin is the one
// selected pin and is above the sheet, a navigate link can be seen
const nearestState = page => page.evaluate(() => {
    const sheet = document.getElementById('sidebar');
    const nav = document.querySelector('#sidebar a.sidebar-nav-btn.waze');
    const navBox = nav ? nav.getBoundingClientRect() : null;
    const pins = [...document.querySelectorAll('.battery-marker.selected')];
    const pinBox = pins.length === 1 ? pins[0].getBoundingClientRect() : null;
    const sheetTop = window.innerWidth <= 768 ? sheet.getBoundingClientRect().top : window.innerHeight;
    const nearest = userLocation && findNearestLocation(userLocation.lat, userLocation.lng);
    return {
        open: sheet.style.display !== 'none' && !sheet.classList.contains('hidden'),
        title: (document.querySelector('#sidebar h2') || {}).textContent,
        nearest: nearest ? nearest.location.name : null,
        distanceText: (document.querySelector('#sidebar .distance') || {}).textContent || '',
        pins: pins.length,
        pinAboveSheet: !!pinBox && pinBox.top >= 0 && pinBox.bottom <= sheetTop && pinBox.left >= 0 && pinBox.right <= window.innerWidth,
        navVisible: !!navBox && navBox.width > 0 && navBox.top >= 0 && navBox.bottom <= window.innerHeight,
        userDotInteractive: !!(userMarker && userMarker.options.interactive),
        userDotPopup: !!(userMarker && userMarker.getPopup()),
        active: document.querySelector('.locate-btn').classList.contains('active'),
        zoom: map.getZoom(),
        toast: document.getElementById('notification').style.display !== 'none' ? document.getElementById('notification').textContent : ''
    };
});
const tapLocate = async page => { await page.click('.locate-btn'); await page.waitForTimeout(300); await mapSettled(page); await page.waitForTimeout(400); };

check('address search: "street city" in any order; "אייס" is not "איסוף"; the suggestion row shows the address', async () => {
    const { context, page, problems } = await openApp({ viewport: PHONE });
    const onMap = () => page.evaluate(() => {
        const drawn = new Set(markerCluster.getLayers());
        return allMarkers.filter(item => drawn.has(item.marker)).map(item => item.location);
    });
    for (const text of ['אבן גבירול תל אביב', 'תל אביב אבן גבירול']) {
        await page.locator('#search-input').fill(text); await settle(page);
        const points = await onMap();
        const rows = await page.evaluate(() => [...document.querySelectorAll('.suggestion-item[data-type="location"]')].map(row => {
            const location = allLocations.find(l => l.id === Number(row.dataset.id));
            return { shown: row.querySelector('.suggestion-city').textContent, address: location.address };
        }));
        expect(points.length > 0 && points.every(l => l.city === 'תל אביב' && (l.name + l.address).includes('אבן גבירול')),
            `"${text}": ${points.length} pins, cities ${[...new Set(points.map(l => l.city))].slice(0, 4)}`);
        expect(rows.length > 0 && rows.every(r => r.shown === r.address), `"${text}": suggestion rows ${JSON.stringify(rows.slice(0, 2))}`);
        await clearSearch(page);
    }
    await page.locator('#search-input').fill('אייס'); await settle(page);
    const ace = (await onMap()).length, aceText = await containing(page, 'אייס');
    await clearSearch(page);
    await page.locator('#search-input').fill('haifa'); await settle(page);
    const haifaRow = await page.evaluate(() => (document.querySelector('.suggestion-item') || {}).dataset);
    await context.close();
    expect(ace === aceText, `"אייס": ${ace} pins, ${aceText} records contain it`);
    expect(haifaRow && haifaRow.type === 'city' && haifaRow.value === 'חיפה', '"haifa": first suggestion ' + JSON.stringify(haifaRow));
    expect(problems.length === 0, problems.join(' ; '));
});

check('?action=nearest waits for the data, then opens the nearest point', async () => {
    const { context, page, problems } = await openPage({ viewport: PHONE, geolocation: TEL_AVIV, permissions: ['geolocation'] });
    // locations.json arrives 2 seconds late, as on a slow connection
    await page.route('**/locations.json', async route => {
        if (route.request().resourceType() === 'fetch') await new Promise(done => setTimeout(done, 2000));
        route.continue();
    });
    await page.goto(server.base + '?action=nearest');
    const ok = await page.waitForFunction(() => typeof allLocations !== 'undefined' && allLocations.length > 0 && document.getElementById('sidebar').style.display === 'flex', null, { timeout: 15000 }).then(() => true, () => false);
    await mapSettled(page); await page.waitForTimeout(400);
    const s = await nearestState(page);
    await context.close();
    expect(ok && s.open && s.title === s.nearest && s.pins === 1 && s.pinAboveSheet && s.navVisible && s.active,
        `?action=nearest: ${JSON.stringify(s)} ${problems.filter(p => p.startsWith('page')).join(' ; ')}`);
});

check('nearest: one tap opens the nearest point above the sheet; a second tap re-centres', async () => {
    const places = { 'Tel Aviv': [32.08, 34.78], 'Jerusalem': [31.778, 35.225], 'Haifa': [32.794, 34.9896], 'Mitzpe Ramon': [30.6103, 34.8019] };
    for (const viewport of [PHONE, DESKTOP]) {
        for (const [where, [latitude, longitude]] of Object.entries(places)) {
            const { context, page, problems } = await openApp({ viewport, geolocation: { latitude, longitude, accuracy: 20 }, permissions: ['geolocation'] });
            await tapLocate(page);
            const s = await nearestState(page);
            const label = `${where} at ${viewport.width}px`;
            expect(s.open && s.title === s.nearest, `${label}: details show "${s.title}", nearest is "${s.nearest}"`);
            expect(s.pins === 1 && s.pinAboveSheet, `${label}: ${s.pins} selected pins, above the sheet: ${s.pinAboveSheet}`);
            expect(s.navVisible, `${label}: no visible navigate link`);
            expect(/ בקו אווירי$/.test(s.distanceText), `${label}: distance text "${s.distanceText}"`);
            expect(!s.userDotInteractive && !s.userDotPopup && s.active, `${label}: user dot interactive ${s.userDotInteractive}, popup ${s.userDotPopup}, button active ${s.active}`);
            expect(s.toast === '', `${label}: a toast "${s.toast}" next to the open sheet`);
            if (viewport === PHONE) {
                // the open sheet must not cover the locate button: a tap there would land on "הנקודה קיימת"
                const hit = await page.evaluate(() => { const b = document.querySelector('.locate-btn').getBoundingClientRect(); const el = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return el ? (el.closest('.locate-btn') ? 'locate' : el.className || el.tagName) : 'nothing'; });
                expect(hit === 'locate', `${label}: with the sheet open, the locate button is covered by ${hit}`);
            }
            if (where === 'Tel Aviv' && viewport === PHONE) {
                // a second tap with the sheet still open re-centres and sends no confirmation
                await page.evaluate(() => { window.smokeOpened = []; window.open = url => { window.smokeOpened.push(url); return null; }; map.setView([31.25, 34.79], 10, { animate: false }); });
                await tapLocate(page);
                const kept = await nearestState(page);
                const opened = await page.evaluate(() => window.smokeOpened.length + document.querySelectorAll('.like-btn.liked').length);
                expect(kept.open && kept.title === s.nearest && kept.zoom >= 14 && opened === 0, `${label}, second tap with the sheet open: ${JSON.stringify(kept)}, forms opened or likes: ${opened}`);
            }
            if (where === 'Tel Aviv') {
                // move away, close the details, tap again: back to the user and the nearest point
                await page.evaluate(() => { hideSidebar(); map.setView([31.25, 34.79], 10, { animate: false }); });
                await tapLocate(page);
                const again = await nearestState(page);
                const centreKm = await page.evaluate(() => getDistance(map.getCenter().lat, map.getCenter().lng, userLocation.lat, userLocation.lng));
                expect(again.open && again.title === s.nearest && again.zoom >= 14 && centreKm < 1 && again.active && !!(await page.evaluate(() => userMarker)),
                    `${label}, second tap: ${JSON.stringify(again)}, centre ${centreKm.toFixed(2)} km from the user`);
            }
            const errors = problems.filter(p => p.startsWith('page error') || p.startsWith('console error'));
            await context.close();
            expect(errors.length === 0, `${label}: ${errors.join(' ; ')}`);
        }
    }
});

// With a point open: what is at the centre of each map control and of the selected pin.
// Returns the ones covered by something else, with what covers them.
const coveredControls = page => page.evaluate(() => {
    const nameOf = t => (t ? (t.id || (typeof t.className === 'string' ? t.className : t.className.baseVal) || t.tagName) : 'nothing');
    const out = [];
    const probe = (label, el) => {
        if (!el) { out.push(label + ': missing'); return; }
        const b = el.getBoundingClientRect();
        if (b.width === 0) { out.push(label + ': not drawn'); return; }
        const x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2;
        const t = document.elementFromPoint(x, y);
        if (!t || !(t === el || el.contains(t))) out.push(`${label} at ${Math.round(x)},${Math.round(y)}: covered by ${nameOf(t)}`);
    };
    probe('locate button', document.querySelector('.locate-btn'));
    probe('basemap button', document.querySelector('.basemap-toggle-btn'));
    probe('credit link', document.querySelector('.leaflet-control-attribution a'));
    probe('selected pin', selectedPin.getElement());
    return out;
});

check('with a point open, the details never cover the map buttons, the credits or the selected pin (phones, both ways round)', async () => {
    const phones = [[568, 320], [667, 375], [740, 360], [320, 568], [360, 740], [390, 844], [768, 1024]];
    for (const [width, height] of phones) {
        const where = `${width}x${height}`;
        const { context, page, problems } = await openApp({ viewport: { width, height }, hasTouch: true, isMobile: true,
            geolocation: { latitude: TEL_AVIV.latitude, longitude: TEL_AVIV.longitude, accuracy: 30 }, permissions: ['geolocation'] });
        // 1. a point picked (as from a suggestion)
        const id = await page.evaluate(c => allLocations.find(l => l.city === c).id, CITY);
        await page.evaluate(id => focusOnLocation(id), id); await mapSettled(page); await page.waitForTimeout(400);
        try {
            const picked = await coveredControls(page);
            expect(picked.length === 0, `${where}, a picked point: ${picked.join(' ; ')}`);
            // 2. the nearest point, asked for with a real tap on the locate button
            await tapLocate(page);
            const nearest = await coveredControls(page);
            expect(nearest.length === 0, `${where}, the nearest point: ${nearest.join(' ; ')}`);
            const errors = problems.filter(p => p.startsWith('page error') || p.startsWith('console error'));
            expect(errors.length === 0, `${where}: ${errors.join(' ; ')}`);
        } finally {
            await context.close();
        }
    }
});

// The locate button: where it is, how big, what it says (a touch phone and a desktop)
const locateButtonState = page => page.evaluate(() => {
    const btn = document.querySelector('.locate-btn');
    const box = btn.getBoundingClientRect();
    const label = btn.querySelector('.locate-label');
    const credit = document.querySelector('.leaflet-control-attribution').getBoundingClientRect();
    const probe = document.createElement('div'); probe.style.color = 'var(--cw-accent)'; document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color; probe.remove();
    const overlaps = !(box.bottom <= credit.top || box.top >= credit.bottom || box.right <= credit.left || box.left >= credit.right);
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height,
        label: label && getComputedStyle(label).display !== 'none' ? label.textContent : '',
        labelLines: label ? Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight || 20)) : 0,
        aria: btn.getAttribute('aria-label'), filled: getComputedStyle(btn).backgroundColor === accent,
        overlapsCredit: overlaps, zoomShown: getComputedStyle(document.querySelector('.leaflet-control-zoom')).display !== 'none',
        screen: [window.innerWidth, window.innerHeight] };
});

check('the locate button is a labelled pill in the bottom right; +/- hidden on touch phones only', async () => {
    const LABEL = 'הנקודה הקרובה אליי';
    for (const [viewport, touch] of [[{ width: 390, height: 844 }, true], [{ width: 360, height: 800 }, true], [{ width: 1440, height: 900 }, false]]) {
        const where = `${viewport.width}x${viewport.height}`;
        const { context, page, problems } = await openApp({ viewport, hasTouch: touch, isMobile: touch, geolocation: { latitude: 32.08, longitude: 34.78, accuracy: 20 }, permissions: ['geolocation'] });
        const s = await locateButtonState(page);
        expect(s.label === LABEL && s.aria === LABEL && s.height >= 48 && s.filled && !s.overlapsCredit,
            `${where}: ${JSON.stringify(s)}`);
        expect(s.right >= viewport.width - 24 && s.top >= viewport.height * 2 / 3, `${where}: not in the bottom right: ${JSON.stringify(s)}`);
        expect(s.zoomShown === !touch, `${where}: +/- shown ${s.zoomShown} on a ${touch ? 'touch phone' : 'desktop'}`);
        // after the first fix it is a round re-centre button with the same name
        await tapLocate(page);
        await page.evaluate(() => hideSidebar()); await page.waitForTimeout(500);
        const after = await locateButtonState(page);
        const errors = problems.filter(p => p.startsWith('page error') || p.startsWith('console error'));
        await context.close();
        expect(after.label === '' && after.aria === LABEL && after.width >= 48 && after.width === after.height && after.filled,
            `${where}, after the first fix: ${JSON.stringify(after)}`);
        expect(errors.length === 0, `${where}: ${errors.join(' ; ')}`);
    }
});

// The open sheet, measured: order of its parts, the filled navigate buttons, labelled feedback
const sheetLayout = page => page.evaluate(() => {
    const top = selector => { const el = document.querySelector('#sidebar ' + selector); return el ? el.getBoundingClientRect() : null; };
    const probe = document.createElement('div'); probe.style.color = 'var(--cw-accent)'; document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color; probe.remove();
    const parts = ['h2', '.sidebar-meta', '.sidebar-nav', '.feedback-row'].map(top);
    const navs = [...document.querySelectorAll('#sidebar .sidebar-nav-btn')];
    const feedback = [...document.querySelectorAll('#sidebar .feedback-btn')];
    const sheet = document.getElementById('sidebar').getBoundingClientRect();
    return {
        inOrder: parts.every((box, i) => box && (i === 0 || box.top >= parts[i - 1].bottom - 1)),
        distanceGap: top('.distance') && parts[0] ? Math.round(top('.distance').top - parts[0].bottom) : null,
        navTexts: navs.map(a => a.textContent.trim()),
        navFilled: navs.length === 2 && navs.every(a => getComputedStyle(a).backgroundColor === accent),
        navSameSize: navs.length === 2 && Math.abs(navs[0].offsetWidth - navs[1].offsetWidth) <= 1 && navs[0].offsetHeight === navs[1].offsetHeight && navs[0].offsetHeight >= 48,
        navOneLine: navs.every(a => a.offsetHeight <= 48), // a second line of text makes the button taller than its 48 px minimum
        feedbackTexts: feedback.map(b => b.textContent.trim()),
        feedbackNames: feedback.map(b => b.getAttribute('aria-label')),
        feedbackHeight: Math.min(...feedback.map(b => b.offsetHeight)),
        navInView: navs.every(a => { const b = a.getBoundingClientRect(); return b.top >= sheet.top && b.bottom <= Math.min(sheet.bottom, window.innerHeight); }),
        sheetHeight: Math.round(sheet.height), titleLines: parts[0] ? Math.round(parts[0].height / parseFloat(getComputedStyle(document.querySelector('#sidebar h2')).lineHeight)) : 0
    };
});

check('the sheet: name, distance and address, filled navigate buttons, labelled feedback', async () => {
    const { context, page, problems } = await openApp({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, geolocation: { latitude: 32.08, longitude: 34.78, accuracy: 20 }, permissions: ['geolocation'] });
    await tapLocate(page);
    const s = await sheetLayout(page);
    // the longest name in the data still shows the navigate row without scrolling
    const longest = await page.evaluate(() => allLocations.reduce((a, b) => (b.name.length > a.name.length ? b : a)));
    await page.evaluate(id => focusOnLocation(id), longest.id); await mapSettled(page); await page.waitForTimeout(400);
    const long = await sheetLayout(page);
    const errors = problems.filter(p => p.startsWith('page error') || p.startsWith('console error'));
    await context.close();
    expect(s.inOrder, 'parts out of order: ' + JSON.stringify(s));
    expect(s.distanceGap !== null && s.distanceGap >= 0 && s.distanceGap <= 16, 'gap from the name to the distance: ' + s.distanceGap);
    expect(s.navTexts.join('|') === 'ניווט ב-Waze|ניווט ב-Google Maps' && s.navFilled && s.navSameSize, 'navigate buttons: ' + JSON.stringify(s));
    expect(s.feedbackTexts.join('|') === 'הנקודה קיימת|דיווח על בעיה' && s.feedbackNames[0].startsWith('הנקודה קיימת') && s.feedbackNames[1] === 'דיווח על בעיה' && s.feedbackHeight >= 44,
        'feedback buttons: ' + JSON.stringify(s));
    expect(s.titleLines !== 1 || s.sheetHeight <= 300, `the sheet is ${s.sheetHeight}px high for a one-line name`);
    expect(long.navInView, `"${longest.name}" (${longest.name.length} letters): navigate row not in view, ${JSON.stringify(long)}`);
    expect(s.navOneLine, 'a navigate label wraps on the phone: ' + JSON.stringify(s));
    expect(errors.length === 0, errors.join(' ; '));
    // the desktop sidebar is narrower than a phone sheet: the labels must still fit on one line
    const desk = await openApp({ viewport: { width: 1440, height: 900 }, geolocation: { latitude: 32.08, longitude: 34.78, accuracy: 20 }, permissions: ['geolocation'] });
    await tapLocate(desk.page);
    const d = await sheetLayout(desk.page);
    await desk.context.close();
    expect(d.inOrder && d.navFilled && d.navSameSize && d.navOneLine, 'desktop sidebar: ' + JSON.stringify(d));
});

check('pins: single pins at street level, larger hit areas, selected pin 1.4x, a shared coordinate still opens by spiderfy', async () => {
    const { context, page, problems } = await openApp({ viewport: { width: 390, height: 844 } });
    // 1. zoom 16 over Tel Aviv: every point is its own pin
    await page.evaluate(() => map.setView([32.08, 34.78], 16, { animate: false })); await mapSettled(page);
    const clustersAt16 = await page.evaluate(() => [...document.querySelectorAll('.marker-cluster')].filter(el => {
        const b = el.getBoundingClientRect(); return b.bottom > 0 && b.top < window.innerHeight && b.right > 0 && b.left < window.innerWidth; }).length);
    // 2. a tap just outside a pin, and just outside a small cluster, still lands on it
    const hit = kind => page.evaluate(kind => {
        const sel = kind === 'pin' ? '.battery-marker:not(.selected)' : '.marker-cluster-small';
        const others = [...document.querySelectorAll('.leaflet-marker-icon')];
        for (const el of document.querySelectorAll(sel)) {
            const b = el.getBoundingClientRect();
            if (b.top < 80 || b.bottom > window.innerHeight - 120 || b.left < 20 || b.right > window.innerWidth - 20) continue;
            const pad = kind === 'pin' ? 12 : 8;
            const crowded = others.some(o => { if (o === el) return false; const c = o.getBoundingClientRect();
                return c.right > b.left - pad && c.left < b.right + pad && c.bottom > b.top - pad && c.top < b.bottom + pad; });
            const centre = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            if (crowded || !centre || !el.contains(centre)) continue; // another marker or a map button is there
            const x = kind === 'pin' ? b.left - 6 : b.right + 3, y = kind === 'pin' ? b.top + b.height / 2 : b.top + b.height / 2;
            const at = document.elementFromPoint(x, y);
            if (at && at.closest('.leaflet-control')) continue;
            return { found: true, hit: !!at && el.contains(at), at: at ? at.className : null };
        }
        return { found: false };
    }, kind);
    const pinHit = await hit('pin');
    await page.evaluate(() => map.setView([32.08, 34.78], 13, { animate: false })); await mapSettled(page);
    const clusterHit = await hit('cluster');
    // 3. the selected pin is drawn 1.4 times larger
    await page.evaluate(() => showSidebar(allLocations[0])); await page.waitForTimeout(400);
    const scale = await page.evaluate(() => { const svg = document.querySelector('.battery-marker.selected svg');
        return svg ? new DOMMatrix(getComputedStyle(svg).transform).a : null; });
    await page.evaluate(() => hideSidebar()); await page.waitForTimeout(400);
    // 4. points on one exact coordinate: a tap on their bubble at the deepest zoom spreads them out
    const group = await page.evaluate(() => {
        const at = new Map();
        allLocations.forEach(l => { const k = l.lat + ',' + l.lng; at.set(k, (at.get(k) || []).concat(l)); });
        const g = [...at.values()].find(list => list.length >= 2 && list.length <= 4);
        return g ? g.map(l => ({ id: l.id, name: l.name, lat: l.lat, lng: l.lng })) : null;
    });
    expect(group, 'data changed: no points that share one coordinate');
    await page.evaluate(p => map.setView([p.lat, p.lng], map.getMaxZoom(), { animate: false }), group[0]); await mapSettled(page);
    await page.evaluate(() => { const c = map.latLngToContainerPoint(map.getCenter()); const m = map.getContainer().getBoundingClientRect();
        const el = document.elementFromPoint(m.left + c.x, m.top + c.y); const cluster = el && el.closest('.marker-cluster');
        if (cluster) cluster.setAttribute('data-smoke-tap', '1'); });
    await page.locator('[data-smoke-tap]').click(); await page.waitForTimeout(1000);
    const legs = await page.evaluate(ids => [...document.querySelectorAll('.battery-marker:not(.selected)')].filter(el =>
        allMarkers.some(item => ids.includes(item.location.id) && item.marker.getElement() === el)).length, group.map(p => p.id));
    const legName = await page.evaluate(ids => { const item = allMarkers.find(i => ids.includes(i.location.id) && i.marker.getElement());
        item.marker.getElement().setAttribute('data-smoke-leg', '1'); return item.location.name; }, group.map(p => p.id));
    await page.locator('[data-smoke-leg]').click({ force: true }); await page.waitForTimeout(600);
    const title = await page.evaluate(() => (document.querySelector('#sidebar h2') || {}).textContent);
    const errors = problems.filter(p => p.startsWith('page error') || p.startsWith('console error'));
    await context.close();
    expect(clustersAt16 === 0, `${clustersAt16} cluster bubbles on screen at zoom 16 over Tel Aviv`);
    expect(pinHit.found && pinHit.hit, '6 px beside a pin: ' + JSON.stringify(pinHit));
    expect(clusterHit.found && clusterHit.hit, '3 px outside a small cluster: ' + JSON.stringify(clusterHit));
    expect(Math.abs(scale - 1.4) < 0.01, 'selected pin scale: ' + scale);
    expect(legs === group.length && title === legName, `${group.length} points on one coordinate: ${legs} spread out, tapped "${legName}", details "${title}"`);
    expect(errors.length === 0, errors.join(' ; '));
});

check('text and icons: empty state says what to type, or that MAI does not list the chain; placeholder fits; nothing under the clear button', async () => {
    const NOT_LISTED = 'הרשת הזו לא מופיעה ברשימת נקודות האיסוף של תאגיד מ.א.י.';
    const panel = page => page.evaluate(() => ({ shown: getComputedStyle(document.getElementById('empty-state')).display !== 'none',
        title: document.querySelector('#empty-state h3').textContent, text: document.querySelector('#empty-state p').textContent,
        button: document.getElementById('clear-filters').textContent.trim(), emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.getElementById('empty-state').textContent) }));
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
        const where = `${viewport.width}px`;
        const { context, page, problems } = await openApp({ viewport, hasTouch: true, isMobile: true });
        // the whole placeholder can be read in the box
        const fit = await page.evaluate(async () => { await document.fonts.ready; const box = document.getElementById('search-input'); const cs = getComputedStyle(box);
            const ctx = document.createElement('canvas').getContext('2d'); ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            return { placeholder: box.placeholder, text: Math.ceil(ctx.measureText(box.placeholder).width),
                // clientWidth of a text input leaves out its padding in Chrome, so the room is measured from the box
                room: Math.floor(box.getBoundingClientRect().width - ['borderLeftWidth', 'borderRightWidth', 'paddingLeft', 'paddingRight'].reduce((sum, k) => sum + parseFloat(cs[k]), 0)) }; });
        expect(fit.placeholder === 'עיר, רחוב או חנות' && fit.text <= fit.room, `${where}: placeholder ${JSON.stringify(fit)}`);
        // a long text never runs under the clear button (the grey disc is drawn 8 px inside the button)
        await page.locator('#search-input').fill('אבגדהוזחטיכלמנסעפצקרשת אבגדהוזחטיכלמנסעפ');
        const under = await page.evaluate(() => { const box = document.getElementById('search-input'); const b = box.getBoundingClientRect();
            const disc = document.getElementById('search-clear').getBoundingClientRect();
            return { textStarts: Math.round(b.left + parseFloat(getComputedStyle(box).paddingLeft)), discEnds: Math.round(disc.right - 8) }; });
        expect(under.textStarts >= under.discEnds, `${where}: text area starts at ${under.textStarts}, the clear button ends at ${under.discEnds}`);
        await clearSearch(page);
        // suggestions carry drawn icons, no emoji
        await page.locator('#search-input').fill('חיפה'); await settle(page);
        const rows = await page.evaluate(() => [...document.querySelectorAll('.suggestion-item')].map(row => ({ type: row.dataset.type,
            svg: !!row.querySelector('.suggestion-icon svg'), sub: row.querySelector('.suggestion-city').textContent,
            emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(row.textContent) })));
        expect(rows.length > 1 && rows.every(r => r.svg && !r.emoji) && rows[0].type === 'city' && / נקודות איסוף$| נקודת איסוף אחת$|^נקודת איסוף אחת$/.test(rows[0].sub),
            `${where}: suggestion rows ${JSON.stringify(rows.slice(0, 3))}`);
        await clearSearch(page);
        // the empty state: a chain MAI does not list, then anything else
        await page.locator('#search-input').fill('סופר פארם'); await settle(page); await press(page, 'Escape');
        const chain = await panel(page);
        expect(chain.shown && chain.title === 'לא נמצאו נקודות איסוף' && chain.text === NOT_LISTED && chain.button === 'ניקוי החיפוש' && !chain.emoji, `${where}, "סופר פארם": ${JSON.stringify(chain)}`);
        await clearSearch(page);
        await page.locator('#search-input').fill('zzzzqqqq'); await settle(page); await press(page, 'Escape');
        const other = await panel(page);
        expect(other.shown && other.title === 'לא נמצאו נקודות איסוף' && other.text === 'אפשר לחפש עיר, רחוב או שם של חנות' && other.button === 'ניקוי החיפוש', `${where}, "zzzzqqqq": ${JSON.stringify(other)}`);
        await page.click('#clear-filters'); await settle(page);
        const after = await shown(page);
        const errors = problems.filter(p => p.startsWith('page error') || p.startsWith('console error'));
        await context.close();
        expect(after.box === '' && after.count === after.total, `${where}: after "ניקוי החיפוש": ${JSON.stringify(after)}`);
        expect(errors.length === 0, `${where}: ${errors.join(' ; ')}`);
    }
});

check('nearest fails well: denied and slow lead to the search box; nothing within 30 km flies nowhere', async () => {
    // 1. denied: the message, and the focus in the search box
    let { context, page } = await openApp({ viewport: PHONE });
    await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail({ code: 1 }), 50); });
    await page.click('.locate-btn'); await page.waitForTimeout(400);
    let s = await page.evaluate(() => ({ toast: document.getElementById('notification').textContent, focus: document.activeElement.id }));
    await context.close();
    expect(s.toast === 'לא הצלחנו לאתר מיקום. חפשו עיר או רחוב' && s.focus === 'search-input', 'denied: ' + JSON.stringify(s));
    // 2. a 9-second wait: "מאתר מיקום..." is shown the whole time, then the timeout gives the same message
    ({ context, page } = await openApp({ viewport: PHONE }));
    await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail({ code: 3 }), 9000); });
    await page.click('.locate-btn');
    const during = [];
    for (let t = 0; t < 8; t++) { await page.waitForTimeout(1000); during.push(await page.evaluate(() => document.getElementById('notification').style.display !== 'none' ? document.getElementById('notification').textContent : '')); }
    await page.waitForTimeout(1500);
    s = await page.evaluate(() => ({ toast: document.getElementById('notification').textContent, focus: document.activeElement.id }));
    await context.close();
    expect(during.every(text => text === 'מאתר מיקום...'), 'while waiting: ' + JSON.stringify(during));
    expect(s.toast === 'לא הצלחנו לאתר מיקום. חפשו עיר או רחוב' && s.focus === 'search-input', 'timeout: ' + JSON.stringify(s));
    // 3. Amman: inside the map's padded box, but no point within 30 km
    ({ context, page } = await openApp({ viewport: PHONE, geolocation: { latitude: 31.9539, longitude: 35.9106, accuracy: 20 }, permissions: ['geolocation'] }));
    const before = await page.evaluate(() => [map.getCenter().lat.toFixed(5), map.getCenter().lng.toFixed(5), map.getZoom()].join());
    await page.click('.locate-btn'); await page.waitForTimeout(1500);
    s = await page.evaluate(() => ({ view: [map.getCenter().lat.toFixed(5), map.getCenter().lng.toFixed(5), map.getZoom()].join(),
        toast: document.getElementById('notification').textContent, active: document.querySelector('.locate-btn').classList.contains('active'),
        open: document.getElementById('sidebar').style.display === 'flex' }));
    await context.close();
    expect(s.view === before && s.toast === 'אין נקודות איסוף עד 30 ק"מ ממך' && !s.active && !s.open, `Amman: view ${before} -> ${s.view}, ${JSON.stringify(s)}`);
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
    await page.evaluate(() => { window.smokeZoomEnds = 0; map.on('zoomend', () => { window.smokeZoomEnds++; }); });
    await page.locator(`.suggestion-item[data-id="${target.id}"]`).click({ timeout: 60000 });
    // wait until the map stops moving, not for a fixed time: a slowed-down browser needs longer
    await mapSettled(page);
    const result = { pins: await visibleSelectedPins(page), zoom: await page.evaluate(() => map.getZoom()),
        zoomEnds: await page.evaluate(() => window.smokeZoomEnds),
        title: await page.evaluate(() => (document.querySelector('#sidebar h2') || {}).textContent) };
    const errors = problems.filter(p => p.startsWith('page error'));
    // closing the details takes the "selected" mark off again
    await page.keyboard.press('Escape'); await page.waitForTimeout(600 * Math.max(1, cpuSlowdown / 2));
    const afterClose = await page.evaluate(() => document.querySelectorAll('.battery-marker.selected').length);
    // tapping a pin that is drawn on its own marks it selected too (the picked one
    // may still be counted inside a cluster: it was drawn on its own layer)
    let afterTap = { pins: 1, title: '', name: '' };
    if (cpuSlowdown === 1) {
        // on a phone the sheet had moved the map up; look for a pin around the picked point, not the screen centre
        await page.evaluate(id => { const l = allLocations.find(x => x.id === id); map.setView([l.lat, l.lng], map.getZoom(), { animate: false }); }, target.id);
        afterTap.name = await tagDrawnPin(page);
        expect(afterTap.name, `${viewport.width}px: no pin drawn on its own near "${target.name}" to tap`);
        await page.locator('[data-smoke-tap]').click({ force: true });
        await page.waitForTimeout(600);
        afterTap.pins = await visibleSelectedPins(page);
        afterTap.title = await page.evaluate(() => (document.querySelector('#sidebar h2') || {}).textContent);
    }
    await context.close();
    const where = `${viewport.width}px, CPU ${cpuSlowdown}x slower, "${target.name}"`;
    expect(errors.length === 0, `${where}: ${errors.join(' ; ')}`);
    expect(result.title === target.name, `${where}: details show "${result.title}"`);
    expect(result.pins === 1, `${where}: ${result.pins} visible selected pins at zoom ${result.zoom} (wanted exactly 1)`);
    expect(result.zoomEnds === 1, `${where}: the map zoomed ${result.zoomEnds} times to show the pick (wanted one flight)`);
    expect(afterClose === 0, `${where}: ${afterClose} pins still marked selected after the details were closed`);
    expect(afterTap.pins === 1, `${where}: ${afterTap.pins} visible selected pins after tapping a pin (wanted exactly 1)`);
    expect(cpuSlowdown > 1 || afterTap.title === afterTap.name, `${where}: tapped "${afterTap.name}", details show "${afterTap.title}"`);
}
// Marks one ordinary pin that is drawn on its own in the open part of the screen
// (data-smoke-tap) and returns its location name, or null. "skip": a name not to pick.
const tagDrawnPin = (page, skip = null) => page.evaluate(async skip => {
    document.querySelectorAll('[data-smoke-tap]').forEach(el => el.removeAttribute('data-smoke-tap'));
    const nameOf = el => el.getAttribute('aria-label').slice(0, el.getAttribute('aria-label').lastIndexOf(' - '));
    const find = () => [...document.querySelectorAll('.battery-marker:not(.selected)[aria-label]')].find(el => {
        const box = el.getBoundingClientRect();
        if (nameOf(el) === skip || box.top <= 80 || box.bottom >= window.innerHeight - 80 || box.left <= 20 || box.right >= window.innerWidth - 20) return false;
        const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2); // not under the sidebar
        return !!hit && el.contains(hit);
    });
    let el = find();
    // around an isolated mall every neighbour may still be in a cluster at 16-18 on a narrow phone; zoom 15 shows the streets around it
    for (const zoom of [16, 15, 18]) {
        if (el) break;
        map.setZoom(zoom, { animate: false }); await new Promise(done => setTimeout(done, 800)); el = find();
    }
    if (!el) return null;
    el.dataset.smokeTap = '1';
    return nameOf(el);
}, skip);
check('picking a location inside a tight cluster shows it as the one selected pin (desktop)', () => pickFromSuggestions(DESKTOP, 1));
check('picking a location inside a tight cluster shows it as the one selected pin (phone)', () => pickFromSuggestions(PHONE, 1));
check('the same on a slow phone (CPU 4x slower): pins are still being added when it is picked', () => pickFromSuggestions(PHONE, 4));
check('the same on a very slow phone (CPU 6x slower)', () => pickFromSuggestions(PHONE, 6));

// The details surfaces open right now: the sidebar/sheet and any Leaflet popup
const surfaces = page => page.evaluate(() => {
    const sheet = document.getElementById('sidebar');
    return { popups: document.querySelectorAll('.leaflet-popup').length,
        open: sheet.style.display !== 'none' && !sheet.classList.contains('hidden'),
        title: (document.querySelector('#sidebar h2') || {}).textContent || '',
        focus: document.activeElement === document.querySelector('#sidebar h2') ? 'heading'
            : document.activeElement === document.getElementById('sidebar-close') ? 'close' : document.activeElement.tagName };
});

check('one details surface: click, Enter on a pin and a suggestion pick open the sidebar only; Escape closes it', async () => {
    for (const viewport of [DESKTOP, PHONE]) {
        const { context, page, problems } = await openApp({ viewport });
        const where = `${viewport.width}px`;
        // the close button is hidden on the phone sheet, so the focus goes to its heading
        const focusWanted = viewport === PHONE ? 'heading' : 'close';
        await page.evaluate(() => map.setView([32.0853, 34.7818], 17, { animate: false }));
        await page.waitForTimeout(1000);
        const closed = async step => { await page.keyboard.press('Escape'); await page.waitForTimeout(500);
            const s = await surfaces(page); expect(!s.open && s.popups === 0, `${where}, ${step}, Escape: ${JSON.stringify(s)}`); };
        // 1. click
        const name = await tagDrawnPin(page);
        expect(name, `${where}: no pin drawn on its own in Tel Aviv`);
        await page.locator('[data-smoke-tap]').click({ force: true }); await page.waitForTimeout(600);
        let s = await surfaces(page);
        expect(s.open && s.title === name && s.popups === 0 && s.focus === focusWanted, `${where}, click: ${JSON.stringify(s)}`);
        await closed('click');
        // 2. keyboard: focus the pin, press Enter
        const name2 = await tagDrawnPin(page, name);
        await page.locator('[data-smoke-tap]').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
        s = await surfaces(page);
        expect(s.open && s.title === name2 && s.popups === 0 && s.focus === focusWanted, `${where}, Enter on a pin: ${JSON.stringify(s)}`);
        await closed('Enter');
        // 3. a location suggestion
        await page.locator('#search-input').fill(name2);
        await page.locator('.suggestion-item[data-type="location"]').first().click();
        await mapSettled(page);
        s = await surfaces(page);
        expect(s.open && s.popups === 0 && s.focus === focusWanted, `${where}, suggestion pick: ${JSON.stringify(s)}`);
        await closed('suggestion pick');
        const errors = problems.filter(p => p.startsWith('page error') || p.startsWith('console error'));
        await context.close();
        expect(errors.length === 0, `${where}: ${errors.join(' ; ')}`);
    }
});

// How many listeners of one type are on window (asked from the browser, not the app)
const windowListeners = async (context, page, type) => {
    const cdp = await context.newCDPSession(page);
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    return listeners.filter(l => l.type === type).length;
};
const pageState = page => page.evaluate(() => ({
    search: window.location.search, path: window.location.pathname, length: history.length,
    open: document.getElementById('sidebar').style.display === 'flex' && !document.getElementById('sidebar').classList.contains('hidden'),
    title: (document.querySelector('#sidebar h2') || {}).textContent || '',
    box: document.getElementById('search-input').value, injected: window.injected
}));

check('a point and a city have a URL; Back closes the details and stays; reload keeps the place', async () => {
    const LINKED = 343455; // "AM.PM - אבן גבירול 91" in תל אביב
    // 1. ?id= opens that point; Back closes it and stays on the page; one popstate listener
    let { context, page, problems } = await openApp({ viewport: PHONE }, '?id=' + LINKED);
    const name = await page.evaluate(id => (allLocations.find(l => l.id === id) || {}).name, LINKED);
    expect(name, `data changed: no location ${LINKED}; pick another LINKED`);
    await mapSettled(page);
    let s = await pageState(page);
    const pins = await visibleSelectedPins(page);
    expect(s.open && s.title === name && s.search === '?id=' + LINKED && pins === 1, `?id=${LINKED}: ${JSON.stringify(s)}, ${pins} visible selected pins`);
    await page.reload(); await dataLoaded(page); await mapSettled(page);
    s = await pageState(page);
    expect(s.open && s.title === name && s.search === '?id=' + LINKED, 'reload with the point open: ' + JSON.stringify(s));
    await page.goBack(); await page.waitForTimeout(600);
    s = await pageState(page);
    expect(!s.open && s.search === '' && s.path === '/', 'Back after opening a link: ' + JSON.stringify(s));
    expect(await windowListeners(context, page, 'popstate') === 1, 'popstate listeners on window: ' + await windowListeners(context, page, 'popstate'));
    await context.close();

    // 2. opening points: one history step, replaced by the next point; Back closes, stays
    ({ context, page, problems } = await openApp());
    await page.evaluate(() => map.setView([32.0853, 34.7818], 17, { animate: false })); await page.waitForTimeout(1000);
    const before = (await pageState(page)).length;
    const first = await tagDrawnPin(page);
    await page.locator('[data-smoke-tap]').click({ force: true }); await page.waitForTimeout(500);
    const afterFirst = await pageState(page);
    const second = await tagDrawnPin(page, first);
    await page.locator('[data-smoke-tap]').click({ force: true }); await page.waitForTimeout(500);
    const afterSecond = await pageState(page);
    expect(afterFirst.open && /^\?id=\d+$/.test(afterFirst.search) && afterFirst.length === before + 1, `first point: ${JSON.stringify(afterFirst)} (history was ${before})`);
    expect(afterSecond.title === second && /^\?id=\d+$/.test(afterSecond.search) && afterSecond.search !== afterFirst.search && afterSecond.length === before + 1,
        `second point "${second}" (first "${first}", history was ${before}): ${JSON.stringify(afterSecond)}, first: ${JSON.stringify(afterFirst)}`);
    await page.goBack(); await page.waitForTimeout(600);
    s = await pageState(page);
    expect(!s.open && s.search === '' && page.url().startsWith(server.base), 'Back with a point open: ' + JSON.stringify(s));
    // closing with the button takes the step back too: Back afterwards leaves nothing open behind
    await page.locator('[data-smoke-tap]').click({ force: true }); await page.waitForTimeout(500);
    await page.click('#sidebar-close'); await page.waitForTimeout(600);
    s = await pageState(page);
    expect(!s.open && s.search === '' && s.length === afterSecond.length, 'closed with the button: ' + JSON.stringify(s));
    // close and open again at once: the address ends on the new point
    await page.evaluate(() => { const a = allLocations[0], b = allLocations[1]; showSidebar(a); hideSidebar(); showSidebar(b); });
    await page.waitForTimeout(800);
    s = await pageState(page);
    const bId = await page.evaluate(() => allLocations[1].id);
    expect(s.open && s.search === '?id=' + bId, 'close and open at once: ' + JSON.stringify(s));
    const errors = problems.filter(p => p.startsWith('page error') || p.startsWith('console error'));
    await context.close();
    expect(errors.length === 0, errors.join(' ; '));

    // 3. ?city= picks that city; reload keeps it; clearing the box clears the address
    ({ context, page, problems } = await openApp({ viewport: PHONE }, '?city=' + encodeURIComponent(CITY)));
    const own = await inCity(page, CITY);
    await mapSettled(page);
    let shownNow = await shown(page);
    expect(shownNow.count === own && shownNow.cities.join() === CITY && shownNow.box === CITY, `?city=${CITY}: ${JSON.stringify(shownNow)}`);
    await page.reload(); await dataLoaded(page); await mapSettled(page);
    shownNow = await shown(page);
    expect(shownNow.count === own && shownNow.box === CITY && (await pageState(page)).search === '?city=' + encodeURIComponent(CITY), 'reload with a city: ' + JSON.stringify(shownNow));
    await clearSearch(page);
    expect((await pageState(page)).search === '', 'after clearing the box: ' + (await pageState(page)).search);
    await type(page, CITY); await press(page, 'Enter'); await settle(page);
    expect((await pageState(page)).search === '?city=' + encodeURIComponent(CITY), 'Enter on a city: ' + (await pageState(page)).search);
    await context.close();

    // 4. unknown or malformed values open the plain map, inject nothing, log nothing
    for (const query of ['?id=%3Cscript%3Ewindow.injected%3D1%3C%2Fscript%3E', '?id=99999999', '?id=1.5', '?id=-3', '?id=343455abc',
        '?city=%3Cimg%20src%3Dx%20onerror%3D%22window.injected%3D1%22%3E', '?city=' + encodeURIComponent('עיר שאינה קיימת'), '?city=']) {
        ({ context, page, problems } = await openApp({}, query));
        await page.waitForTimeout(500);
        s = await pageState(page);
        const all = await shown(page);
        await context.close();
        expect(!s.open && s.injected === undefined && s.box === '' && all.count === all.total && s.search === '' && problems.length === 0,
            `${query}: ${JSON.stringify(s)}, ${all.count} of ${all.total} shown, ${problems.join(' ; ')}`);
    }
});

check('reloading with a point open adds no history step; Back closes it, the next Back leaves', async () => {
    const LINKED = 343455; // "AM.PM - אבן גבירול 91" in תל אביב
    const { context, page } = await openApp({ viewport: PHONE }, '?id=' + LINKED);
    try {
        await mapSettled(page);
        const first = await pageState(page);
        expect(first.open && first.search === '?id=' + LINKED, 'first open: ' + JSON.stringify(first));
        for (let i = 1; i <= 3; i++) {
            await page.reload(); await dataLoaded(page); await mapSettled(page);
            const s = await pageState(page);
            expect(s.open && s.search === '?id=' + LINKED && s.length === first.length,
                `reload ${i}: history ${s.length} (was ${first.length} on first open), ${JSON.stringify(s)}`);
        }
        await page.goBack(); await page.waitForTimeout(600);
        const back = await pageState(page);
        expect(!back.open && back.search === '' && back.path === '/', 'first Back after the reloads: ' + JSON.stringify(back));
        await page.goBack(); await page.waitForTimeout(600);
        expect(!page.url().startsWith(server.base), 'the second Back stayed on the page: ' + page.url());
    } finally {
        await context.close();
    }
});

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
// The map is flying somewhere: watchFlights() must run before the pick that starts the flight
const watchFlights = page => page.evaluate(() => {
    window.smokeMoving = false;
    map.on('movestart', () => { window.smokeMoving = true; });
    map.on('moveend', () => { window.smokeMoving = false; });
});
const flightRunning = page => page.waitForFunction(() => window.smokeMoving, null, { polling: 'raf', timeout: 15000 });
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
    // 2. the second pick while the map is still flying to the first one
    ({ context, page, problems } = await openApp());
    await watchFlights(page);
    await pickInPage(page, first); await flightRunning(page); await pickInPage(page, second);
    await endsAt(page, second, 'second pick while flying to the first');
    await context.close();
    // 3. on a phone, the second pick while the map is flying the last stretch to the first one
    ({ context, page, problems } = await openApp({ viewport: PHONE }));
    await watchFlights(page);
    await pickInPage(page, first); await flightRunning(page); await page.waitForTimeout(600); await pickInPage(page, second);
    await endsAt(page, second, 'second pick during the flight to the first (phone)');
    const errors = problems.filter(p => p.startsWith('page error'));
    await context.close();
    expect(errors.length === 0, 'page errors: ' + errors[0]);
});

check('picking a city while a point is open closes the point; the map ends on the city', async () => {
    const HAIFA = 'חיפה';
    const where = '390x844';
    const { context, page, problems } = await openApp({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
        const cityState = city => page.evaluate(city => {
            const bounds = map.getBounds();
            const own = allLocations.filter(l => l.city === city);
            const sheet = document.getElementById('sidebar');
            return { inView: own.filter(l => bounds.contains([l.lat, l.lng])).length, total: own.length, selected: selectedLocationId,
                open: sheet.style.display !== 'none' && !sheet.classList.contains('hidden'), search: window.location.search,
                pins: document.querySelectorAll('.battery-marker.selected').length };
        }, city);
        // 1. a shop picked, then 150 ms later a city typed and Enter, while the map still flies to the shop
        await type(page, SHOP_TEXT, 20);
        await page.waitForSelector('.suggestion-item[data-type=location]');
        await page.click('.suggestion-item[data-type=location] >> nth=0');
        await page.waitForTimeout(150);
        await page.locator('#search-input').fill(HAIFA); await press(page, 'Enter');
        await mapSettled(page); await page.waitForTimeout(400);
        let s = await cityState(HAIFA);
        expect(s.inView > s.total / 2 && s.selected === null && !s.open && s.pins === 0 && s.search === '?city=' + encodeURIComponent(HAIFA),
            `${where}, a shop picked then Enter on ${HAIFA}: ${JSON.stringify(s)}`);
        // 2. a point open and at rest, then a city suggestion picked
        await clearSearch(page);
        const id = await page.evaluate(c => allLocations.find(l => l.city === c).id, HAIFA);
        await page.evaluate(id => focusOnLocation(id), id); await mapSettled(page);
        await type(page, CITY, 20);
        await page.waitForSelector('.suggestion-item[data-type=city]');
        await page.click('.suggestion-item[data-type=city] >> nth=0');
        await mapSettled(page); await page.waitForTimeout(400);
        s = await cityState(CITY);
        expect(s.inView > s.total / 2 && s.selected === null && !s.open && s.pins === 0 && s.search === '?city=' + encodeURIComponent(CITY),
            `${where}, a point open then the ${CITY} suggestion: ${JSON.stringify(s)}`);
        // 3. a point open, then text that is not a city: the point stays open
        await clearSearch(page);
        await page.evaluate(id => focusOnLocation(id), id); await mapSettled(page);
        await type(page, SHOP_TEXT, 20); await settle(page);
        s = await cityState(HAIFA);
        expect(s.selected === id && s.open && s.search === '?id=' + id, `${where}, a point open then "${SHOP_TEXT}" typed: ${JSON.stringify(s)}`);
        const errors = problems.filter(p => p.startsWith('page error') || p.startsWith('console error'));
        expect(errors.length === 0, `${where}: ${errors.join(' ; ')}`);
    } finally {
        await context.close();
    }
});

check('a search while the map is zooming to a picked place leaves no broken listener behind', async () => {
    const { context, page, problems } = await openApp();
    const [first] = await farApartPlaces(page);
    const own = await inCity(page, CITY);
    await watchFlights(page);
    await pickInPage(page, first); await flightRunning(page);
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
    expect(failed.title === 'שגיאה בטעינת הנתונים' && failed.button === 'ניסיון נוסף' && failed.legend === 'none', 'after the failed load: ' + JSON.stringify(failed));
    await page.click('#clear-filters'); await dataLoaded(page);
    expect(!(await panel()).shown, 'the panel is still shown after a successful retry');
    await type(page, 'zzzzqqqq', 5); await settle(page);
    const empty = await panel();
    await context.close();
    expect(empty.shown && empty.title === 'לא נמצאו נקודות איסוף' && empty.button === 'ניקוי החיפוש', 'a search with no results after the retry shows: ' + JSON.stringify(empty));
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
    const opened = await page.evaluate(() => { window.open = function (url) { window.openedUrl = url; return null; }; document.querySelector('[data-confirm-url]').click(); return { url: window.openedUrl || '', liked: document.querySelectorAll('.like-btn.liked').length }; });
    await context.close();
    expect(JSON.stringify(bad.loaded) === '[5002]' && bad.suggestions === 0, 'loaded ids: ' + JSON.stringify(bad));
    const sent = opened.url ? new URL(opened.url).searchParams.get('entry.1466478113') : '';
    expect(opened.url.indexOf('https://docs.google.com/forms/') === 0 && sent === '✔ הנקודה קיימת: טובה' && opened.liked > 0, 'thumbs-up opens the form marked "the point exists": ' + JSON.stringify(opened) + ' name field: ' + sent);
    expect(after.injected === undefined && after.images === 0 && after.likeIds.join() === '5002', 'after opening the good record: ' + JSON.stringify(after));
});

check('if Leaflet does not arrive, an error panel with a reload button replaces the loading screen', async () => {
    const { context, page } = await openPage();
    await page.route('**/vendor/leaflet/leaflet.js', route => route.abort());
    await page.goto(server.base); await page.waitForTimeout(1500);
    const panel = await page.evaluate(() => ({ title: document.querySelector('#empty-state h3').textContent, button: document.getElementById('clear-filters').textContent,
        panel: getComputedStyle(document.getElementById('empty-state')).display, loading: getComputedStyle(document.getElementById('loading-overlay')).display }));
    expect(panel.title === 'שגיאה בטעינת המפה' && panel.button === 'טעינה מחדש' && panel.panel === 'block' && panel.loading === 'none', JSON.stringify(panel));
    await page.unroute('**/vendor/leaflet/leaflet.js');
    await Promise.all([page.waitForNavigation(), page.click('#clear-filters')]);
    await dataLoaded(page);
    await context.close();
});

check('page hygiene: tight CSP with no violation on either basemap; the test pages are noindex', async () => {
    const { context, page, problems } = await openPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.addInitScript(() => {
        window.cspViolations = [];
        document.addEventListener('securitypolicyviolation', e => window.cspViolations.push(e.violatedDirective + ' ' + e.blockedURI));
    });
    await page.goto(server.base);
    await dataLoaded(page);
    const tilesDone = () => page.waitForFunction(() => { const t = [...document.querySelectorAll('img.leaflet-tile')]; return t.length > 0 && t.every(i => i.complete && i.naturalWidth > 0); }, null, { timeout: 20000 });
    await tilesDone();
    await page.click('.basemap-toggle-btn');
    await tilesDone();
    await page.evaluate(() => showSidebar(allLocations[0])); // the details with the navigate and feedback links
    await page.waitForTimeout(800);
    const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
    const violations = await page.evaluate(() => window.cspViolations);
    await context.close();
    const directives = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]).map(([name, ...values]) => [name, values.join(' ')]));
    // every tile host the page or the worker uses, and nothing else
    const tileHosts = [...new Set([...fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').matchAll(/'(https:\/\/[^/'{]+)\/\{z\}/g)].map(m => m[1]))];
    expect(tileHosts.length > 0, 'no tile URL found in app.js');
    expect(directives['img-src'] === ["'self'", 'data:', ...tileHosts].join(' '), `img-src "${directives['img-src']}", tile hosts ${tileHosts.join(' ')}`);
    expect(directives['base-uri'] === "'self'" && directives['form-action'] === "'none'", `base-uri "${directives['base-uri']}", form-action "${directives['form-action']}"`);
    expect(violations.length === 0, 'CSP violations: ' + violations.join(' ; '));
    expect(problems.length === 0, problems.join(' ; '));
    for (const file of ['test.html', 'test-map.html']) {
        expect(/<meta name="robots" content="noindex">/.test(fs.readFileSync(path.join(ROOT, file), 'utf8')), file + ' has no robots noindex meta');
    }
});

// PNG facts read from the file itself: size, colour type (2 = RGB, 3 = palette,
// 4 and 6 have alpha) and whether a tRNS chunk adds transparency
function pngInfo(file) {
    const b = fs.readFileSync(path.join(ROOT, file));
    const info = { bytes: b.length, width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25], tRNS: false };
    for (let at = 8; at < b.length; at += 12 + b.readUInt32BE(at)) if (b.toString('latin1', at + 4, at + 8) === 'tRNS') info.tRNS = true;
    info.opaque = (info.colourType === 2 || info.colourType === 3) && !info.tRNS;
    return info;
}
const headMeta = page => page.evaluate(() => {
    const out = { title: document.title };
    for (const m of document.querySelectorAll('meta[property], meta[name]')) out[m.getAttribute('property') || m.getAttribute('name')] = m.getAttribute('content');
    return out;
});

check('share preview: a 1200x630 opaque image under 300 KB, a title that says what the page is, neutral Hebrew', async () => {
    const { context, page, problems } = await openApp();
    const meta = await headMeta(page);
    await context.close();
    const image = 'https://zeevmala.github.io/solelot/icons/og-image.png';
    expect(meta.title === 'מפת מיחזור סוללות - נקודות איסוף סוללות בישראל', 'title: ' + meta.title);
    expect(meta['og:title'] === meta.title && meta['twitter:title'] === meta.title, `og/twitter title: ${meta['og:title']} / ${meta['twitter:title']}`);
    expect(meta['og:image'] === image && meta['twitter:image'] === image, `share image: ${meta['og:image']} / ${meta['twitter:image']}`);
    expect(meta['og:image:width'] === '1200' && meta['og:image:height'] === '630', `og:image size ${meta['og:image:width']}x${meta['og:image:height']}`);
    expect(meta['og:image:alt'] && meta['og:site_name'], `og:image:alt "${meta['og:image:alt']}", og:site_name "${meta['og:site_name']}"`);
    expect(meta['twitter:card'] === 'summary_large_image', 'twitter:card: ' + meta['twitter:card']);
    for (const key of ['description', 'og:description', 'twitter:description']) {
        expect(meta[key] && !/(^|\s)מצא(\s|$)/.test(meta[key]), `${key} is missing or uses the masculine imperative: ${meta[key]}`);
    }
    const png = pngInfo('icons/og-image.png');
    expect(png.width === 1200 && png.height === 630 && png.opaque && png.bytes < 300 * 1024, 'icons/og-image.png: ' + JSON.stringify(png));
    expect(!fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('og-image'), 'sw.js precaches the share image (only share previews use it)');
    expect(problems.length === 0, problems.join(' ; '));
});

check('install: maskable icon, opaque Apple touch icon, SVG favicon, manifest id, no installability errors', async () => {
    const { context, page, problems } = await openPage({ serviceWorkers: 'allow' });
    await page.goto(server.base);
    await dataLoaded(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await context.newCDPSession(page);
    const installability = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors;
    const manifestErrors = (await cdp.send('Page.getAppManifest')).errors;
    const links = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')]
        .map(l => ({ rel: l.getAttribute('rel'), type: l.getAttribute('type'), href: l.getAttribute('href') })));
    await context.close();
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    expect(installability.length === 0, 'installability errors: ' + JSON.stringify(installability));
    expect(manifestErrors.length === 0, 'manifest errors: ' + JSON.stringify(manifestErrors));
    expect(manifest.id === './', 'manifest id: ' + manifest.id);
    for (const key of ['description']) expect(!/(^|\s)מצא(\s|$)/.test(manifest[key]), `manifest ${key} uses the masculine imperative: ${manifest[key]}`);
    const maskable = manifest.icons.filter(i => (i.purpose || '').split(' ').includes('maskable'));
    expect(maskable.length === 1 && maskable[0].sizes === '512x512', 'maskable icons: ' + JSON.stringify(maskable));
    const mask = pngInfo(maskable[0].src);
    expect(mask.width === 512 && mask.height === 512 && mask.opaque, maskable[0].src + ': ' + JSON.stringify(mask));
    const apple = links.find(l => l.rel === 'apple-touch-icon');
    expect(apple && apple.href === 'icons/apple-touch-icon.png', 'apple-touch-icon link: ' + JSON.stringify(apple));
    const appleInfo = pngInfo(apple.href);
    expect(appleInfo.width === 180 && appleInfo.height === 180 && appleInfo.opaque, apple.href + ': ' + JSON.stringify(appleInfo));
    expect(links.some(l => l.rel === 'icon' && l.type === 'image/svg+xml' && l.href === 'icons/icon.svg'), 'no SVG favicon link: ' + JSON.stringify(links));
    expect(problems.length === 0, problems.join(' ; '));
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
    const wanted = expectedUpdated();
    const dated = worked && await page.waitForFunction(w => document.querySelector('.leaflet-control-attribution').textContent.includes(w), wanted, { timeout: 5000 }).then(() => true, () => false);
    await context.close();
    expect(worked && count > 1000, `offline reload: page loaded ${worked}, ${count} markers`);
    expect(dated, `offline reload: the credit line does not say "${wanted}"`);
});

// A deploy: the next sw.js has a new cache name and index.html a new title
const deploy = title => { server.swVersion = 'static-smoke-deploy'; server.indexTitle = title; };
const undeploy = () => { server.swVersion = null; server.indexTitle = null; server.maxAge = null; server.faults = {}; };

check('a deploy reaches a returning visitor on the next load, unless the page was already touched; offline still works', async () => {
    const NEW = 'גרסה חדשה מהשרת';
    // 1. not touched: load, deploy, load again -> the new page within 10 s (the HTTP cache must not hand the old files to the new worker)
    server.maxAge = 600;
    let { context, page, problems } = await openWithServiceWorker();
    try {
        deploy(NEW);
        await page.goto(server.base); // a plain visit, as from the home screen (a reload would revalidate the HTTP cache by itself)
        const arrived = await page.waitForFunction(t => document.title === t, NEW, { timeout: 10000 }).then(() => true, () => false);
        const title = await page.title();
        expect(arrived, `the page still says "${title}" 10 s after loading it again following a deploy`);
        await dataLoaded(page);
        // 3. offline reload of the new version still shows the map and the points
        await context.setOffline(true);
        await page.reload();
        const offline = await dataLoaded(page).then(() => true, () => false);
        const count = offline ? (await shown(page)).count : 0;
        expect(offline && count > 1000 && (await page.title()) === NEW, `offline reload after the update: loaded ${offline}, ${count} markers, title "${await page.title()}"`);
        const own = problems.filter(p => !p.includes('Failed to load resource') && !p.includes('net::ERR_INTERNET_DISCONNECTED'));
        expect(own.length === 0, own.join(' ; '));
    } finally {
        undeploy();
        await context.close();
    }
    // 2. touched: a tap, then a deploy and the new worker taking over -> no reload under the user's finger
    ({ context, page } = await openWithServiceWorker());
    try {
        await page.evaluate(() => { window.smokeSamePage = true; });
        await page.mouse.click(60, 400); // a tap on the map
        deploy(NEW);
        const took = await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            const changed = new Promise(done => navigator.serviceWorker.addEventListener('controllerchange', () => done(true), { once: true }));
            await registration.update();
            return Promise.race([changed, new Promise(done => setTimeout(() => done(false), 10000))]);
        });
        await page.waitForTimeout(1500);
        const same = await page.evaluate(() => window.smokeSamePage === true).catch(() => false);
        expect(took, 'the new worker did not take over the page, so nothing was tested');
        expect(same && (await page.title()) !== NEW, 'the page reloaded although it had been tapped');
    } finally {
        undeploy();
        await context.close();
    }
});

check('the automatic reload after a deploy, with a point open, adds no history step', async () => {
    const LINKED = 343455;
    const NEW = 'גרסה חדשה מהשרת';
    const { context, page } = await openPage({ serviceWorkers: 'allow', viewport: PHONE });
    try {
        await page.goto(server.base + '?id=' + LINKED); await dataLoaded(page);
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.reload(); await dataLoaded(page); // now controlled by the worker
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
        const before = await pageState(page);
        deploy(NEW);
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
        const reloaded = await page.waitForFunction(t => document.title === t, NEW, { timeout: 15000 }).then(() => true, () => false);
        expect(reloaded, 'the page did not reload itself after the deploy, so nothing was tested');
        await dataLoaded(page); await mapSettled(page);
        const after = await pageState(page);
        expect(after.open && after.search === '?id=' + LINKED && after.length === before.length,
            `after the automatic reload: history ${after.length} (was ${before.length}), ${JSON.stringify(after)}`);
        await page.goBack(); await page.waitForTimeout(600);
        const back = await pageState(page);
        expect(!back.open && back.search === '' && back.path === '/', 'Back after the automatic reload: ' + JSON.stringify(back));
    } finally {
        undeploy();
        await context.close();
    }
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
