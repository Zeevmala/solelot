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
    expect(errors.length === 0, errors.join(' ; '));
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
    expect(panel.title === 'שגיאה בטעינת המפה' && panel.button === 'טען מחדש' && panel.panel === 'block' && panel.loading === 'none', JSON.stringify(panel));
    await page.unroute('**/vendor/leaflet/leaflet.js');
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
