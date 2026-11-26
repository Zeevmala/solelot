// ============================================
// Battery Recycling Map - Israel
// ============================================

// === NOTIFICATION SYSTEM ===
let notificationTimeout;
let notificationFadeTimeout;
function showNotification(message, duration = 2000) {
    const notification = document.getElementById('notification');
    if (!notification) return;

    clearTimeout(notificationTimeout);
    clearTimeout(notificationFadeTimeout);
    notification.textContent = message;
    notification.style.display = 'block';
    notification.classList.add('show');

    notificationTimeout = setTimeout(() => {
        notification.classList.remove('show');
        notificationFadeTimeout = setTimeout(() => {
            notification.style.display = 'none';
        }, 300);
    }, duration);
}

// Take a message away before its time is up (the answer is shown somewhere else)
function hideNotification() {
    const notification = document.getElementById('notification');
    if (!notification) return;
    clearTimeout(notificationTimeout);
    clearTimeout(notificationFadeTimeout);
    notification.classList.remove('show');
    notification.style.display = 'none';
}

// Report form URL
const REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSey-yMW6dMKCiq0mPqdWdNTa3ccg0xQ6zn-Ca_3f6jiOMCbng/viewform';

// Activate deferred stylesheets (replaces inline onload="this.media='all'")
document.querySelectorAll('link[data-deferred]').forEach(link => { link.media = 'all'; });

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('Service Worker registered'))
            .catch(err => console.log('Service Worker registration failed:', err));
    });
}

// === FEEDBACK SYSTEM (Like / Dislike) ===

// Shared AudioContext — created once, reused (required for iOS Safari)
let audioCtx = null;

// Unlock AudioContext on first user interaction (mobile browsers block audio until a gesture)
function unlockAudio() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        // Play silent buffer to fully unlock audio on iOS
        const buf = audioCtx.createBuffer(1, 1, 22050);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        src.start(0);
    } catch (e) { /* Web Audio not supported */ }
}
document.addEventListener('touchstart', unlockAudio, { once: true });
document.addEventListener('click', unlockAudio, { once: true });

// Play a satisfying "ding" sound using Web Audio API
function playLikeSound() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const now = audioCtx.currentTime;

        // Main tone — warm sine
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(660, now);
        osc1.frequency.setValueAtTime(880, now + 0.08);
        gain1.gain.setValueAtTime(0.7, now);
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        osc1.start(now);
        osc1.stop(now + 0.35);

        // Harmonic — adds brightness/richness
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1320, now);
        osc2.frequency.setValueAtTime(1760, now + 0.08);
        gain2.gain.setValueAtTime(0.25, now);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc2.start(now);
        osc2.stop(now + 0.25);
    } catch (e) {
        // Web Audio not supported — fail silently
    }
}

// Handle like button click — mark the button, then open the report form
// already filled in and marked "the point exists", so the map owner gets the confirmation
function handleLike(locationId, confirmUrl) {
    playLikeSound();
    const btns = document.querySelectorAll('.like-btn[data-like-id="' + locationId + '"]');
    btns.forEach(function(btn) {
        btn.classList.add('liked');
        btn.classList.add('pop');
        setTimeout(function() { btn.classList.remove('pop'); }, 400);
    });
    window.open(confirmUrl, '_blank', 'noopener,noreferrer');
}

// Handle dislike button click — open report form
function handleDislike(reportUrl) {
    window.open(reportUrl, '_blank', 'noopener,noreferrer');
}


// Named constants
const MOBILE_BREAKPOINT = 768;
const EARTH_RADIUS_KM = 6371;

// === HTML ESCAPING ===
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// === FUZZY SEARCH ===
// Returns true if query approximately matches any substring of text
// with at most maxDist character differences (insertions, deletions, substitutions)
function fuzzyMatch(text, query, maxDist = 2) {
    if (!text || !query) return false;
    if (text.includes(query)) return true;
    if (query.length <= 2) return false; // too short for fuzzy
    if (Math.abs(text.length - query.length) > 3) return false; // too different to match

    // Sliding window Levenshtein: check if any substring of text
    // of length ~query.length is within maxDist edits
    const qLen = query.length;
    const tLen = text.length;

    // Initialize DP row — allow free start position in text
    let prev = new Array(qLen + 1);
    for (let j = 0; j <= qLen; j++) prev[j] = j;

    for (let i = 1; i <= tLen; i++) {
        const curr = new Array(qLen + 1);
        curr[0] = 0; // free start position
        for (let j = 1; j <= qLen; j++) {
            const cost = text[i - 1] === query[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,      // deletion
                curr[j - 1] + 1,  // insertion
                prev[j - 1] + cost // substitution
            );
        }
        // Check if we found a good enough match ending here
        if (curr[qLen] <= maxDist) return true;
        prev = curr;
    }
    return false;
}

// === SEARCH ===
// Makes two spellings of the same thing equal before they are compared:
// Latin letters in lower case, no quote marks (מתנ"ס = מתנס), hyphens as spaces,
// and a doubled י or ו as a single one (תקווה = תקוה, קריית = קרית).
// keepDoubled leaves a doubled י or ו as it is (for the "as typed" search below).
function normalizeText(text, keepDoubled = false) {
    let result = String(text || '')
        .toLowerCase()
        .replace(/["'\u05F4\u201C\u201D\u05F3\u2018\u2019]/g, '')
        .replace(/[-\u05BE\u2013]/g, ' ');
    if (!keepDoubled) result = result.replace(/י+/g, 'י').replace(/ו+/g, 'ו');
    return result.replace(/\s+/g, ' ').trim();
}

// Short and old names people type for a city -> the city name used in the data.
// Both sides are compared after normalizeText(), so write them the readable way.
// The old names are the ones scraper.js folds in CITY_ALIASES.
const QUERY_ALIASES = {
    'ת"א': 'תל אביב',
    'תל אביב יפו': 'תל אביב',
    'tel aviv': 'תל אביב',
    'ראשל"צ': 'ראשון לציון',
    'ראשלצ': 'ראשון לציון',
    'פ"ת': 'פתח תקווה',
    'ב"ש': 'באר שבע',
    'ר"ג': 'רמת גן',
    'כפ"ס': 'כפר סבא',
    'י-ם': 'ירושלים',
    'נצרת עילית': 'נוף הגליל',
    'נצרת עלית': 'נוף הגליל',
    'זכרון יעקב': 'זיכרון יעקב',
    'יקנעם': 'יוקנעם',
    'יקנעם עילית': 'יוקנעם',
    'יוקנעם עילית': 'יוקנעם',
    'שוהם': 'שהם',
    'יהוד מונוסון': 'יהוד',
    'מודיעין מכבים רעות': 'מודיעין',
    'פרדס חנה כרכור': 'פרדס חנה',
    'כ"ס': 'כפר סבא',
    // English names of the large cities
    'jerusalem': 'ירושלים',
    'haifa': 'חיפה',
    'beer sheva': 'באר שבע',
    'petah tikva': 'פתח תקווה',
    'rishon lezion': 'ראשון לציון',
    'netanya': 'נתניה',
    'ashdod': 'אשדוד',
    'holon': 'חולון',
    'ramat gan': 'רמת גן',
    'bnei brak': 'בני ברק',
    'eilat': 'אילת',
    // Chains, as people type them
    'bug': 'באג',
    'ikea': 'איקאה',
    'ace': 'אייס',
    'אם פם': 'am.pm',
    'ampm': 'am.pm',
    'am:pm': 'am.pm'
};

// The search text as it is compared with the data
// A short name written with a quote mark (ב"ש) counts only when the quote mark was
// typed: the bare letters "בש" are also part of ordinary words and names.
// keepDoubled: see normalizeText().
function normalizeQuery(text, keepDoubled = false) {
    const query = normalizeText(text);
    const typedQuote = /["\u05F4\u201C\u201D]/.test(String(text || ''));
    const alias = Object.keys(QUERY_ALIASES).find(name =>
        normalizeText(name) === query && (typedQuote || !name.includes('"')));
    return normalizeText(alias ? QUERY_ALIASES[alias] : text, keepDoubled);
}

// What a search looks through for one location: name, address and city as one text,
// commas as spaces ("החרש 1, רמת השרון"). "folded" is compared normally; "asTyped"
// keeps a doubled י or ו. loadLocations() builds it once per location (location.searchText).
function locationSearchText(location) {
    const text = [location.name, location.address, location.city].join(' ').replace(/,/g, ' ');
    return { folded: normalizeText(text), asTyped: normalizeText(text, true) };
}

// The locations whose text contains every typed word, in any order
// ("אבן גבירול תל אביב" finds "אבן גבירול 91, תל אביב").
// A doubled י or ו that was typed is looked for as typed first: "אייס" must not turn
// into "איס", which is inside every "מוקד איסוף". Only when that finds nothing is it
// folded, so "קריית אתא" still finds a record spelled "קרית אתא".
function findContaining(locations, query) {
    const texts = locations.map(location => location.searchText || locationSearchText(location));
    const withAll = (words, kind) => locations.filter((location, i) => words.every(word => texts[i][kind].includes(word)));
    const typed = String(query || '').replace(/,/g, ' '); // an address pasted as written
    const asTyped = normalizeQuery(typed, true);
    const folded = normalizeQuery(typed);
    if (asTyped !== folded) {
        const found = withAll(asTyped.split(' '), 'asTyped');
        if (found.length > 0) return found;
    }
    return withAll(folded.split(' '), 'folded');
}

// How many wrong letters a query may have: none in a short word, where one
// changed letter already makes a different word (לוד / לוט)
function fuzzyTolerance(queryLength) {
    if (queryLength < 5) return 0;
    if (queryLength < 8) return 1;
    return 2;
}

// The locations a search shows on the map.
// A city picked from the suggestions shows exactly that city. Typed text shows the
// locations that contain it; only when there are none does it fall back to
// near matches (typing mistakes).
function searchLocations(locations, query, cityFilter) {
    if (cityFilter) return locations.filter(location => location.city === cityFilter);

    const q = normalizeQuery(query);
    if (q === '') return locations.slice();

    const exact = findContaining(locations, query);
    if (exact.length > 0) return exact;

    const maxDist = fuzzyTolerance(q.length);
    if (maxDist === 0) return [];
    const fields = locations.map(location => [
        normalizeText(location.name),
        normalizeText(location.address),
        normalizeText(location.city)
    ]);
    return locations.filter((location, i) => fields[i].some(text => fuzzyMatch(text, q, maxDist)));
}

// The cities offered in the suggestion list for a typed text.
// cityCounts is a Map of city name -> number of locations. "same" marks the city
// that IS the typed text (or what its short name stands for): the only kind of
// suggestion Enter may pick by itself.
// Near spellings (typing mistakes) are offered only when no city contains the text
// and no location does (exactLocationCount: how many findContaining() found):
// "ספריה" is found in 11 places, so the cities סתריה and קיסריה are not offered.
function matchCities(cityCounts, text, exactLocationCount = 0) {
    const query = normalizeQuery(text);
    const maxDist = fuzzyTolerance(query.length);
    const matches = [];
    if (query === '') return matches;
    cityCounts.forEach((count, name) => {
        const city = normalizeText(name);
        if (city.includes(query)) matches.push({ type: 'city', name, count, exact: true, same: city === query });
    });
    if (matches.length === 0 && exactLocationCount === 0 && maxDist > 0) {
        cityCounts.forEach((count, name) => {
            if (fuzzyMatch(normalizeText(name), query, maxDist)) {
                matches.push({ type: 'city', name, count, exact: false, same: false });
            }
        });
    }
    // The city that is the typed text first, then cities containing it, then near
    // matches; inside each group the city with more locations first
    matches.sort((a, b) => {
        if (a.same !== b.same) return a.same ? -1 : 1;
        if (a.exact !== b.exact) return a.exact ? -1 : 1;
        return b.count - a.count;
    });
    return matches;
}

// === DATA CHECK ===
// A record from locations.json is shown only if it has everything the page needs.
// The id must be a whole number: it is written into HTML attributes.
function isValidLocation(loc) {
    if (!loc || !Number.isInteger(loc.id) || loc.id <= 0) return false;
    if (!loc.name || !loc.address || !loc.city || !loc.type) return false;
    if (!['store', 'facility'].includes(loc.type)) return false;
    if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return false;
    if (!isFinite(loc.lat) || !isFinite(loc.lng)) return false;
    if (loc.lat < 29 || loc.lat > 34 || loc.lng < 34 || loc.lng > 36) return false;
    return true;
}

// === EMPTY STATE TEXT ===
// The same panel says "no results" for a search and "error" when loading failed
function setEmptyStateText(title, text, buttonText) {
    const emptyState = document.getElementById('empty-state');
    if (!emptyState) return;
    const h3 = emptyState.querySelector('h3');
    const p = emptyState.querySelector('p');
    const btn = emptyState.querySelector('.clear-filters-btn');
    if (h3) h3.textContent = title;
    if (p) p.textContent = text;
    if (btn) btn.textContent = buttonText;
}

// The map library is a separate file (vendor/leaflet). If it did not arrive, nothing
// below can work: show the error panel instead of leaving the loading screen forever.
if (typeof L === 'undefined' || typeof L.markerClusterGroup !== 'function') {
    setEmptyStateText('שגיאה בטעינת המפה', 'בדוק את החיבור לאינטרנט ונסה שוב', 'טען מחדש');
    const libraryErrorPanel = document.getElementById('empty-state');
    const reloadBtn = document.getElementById('clear-filters');
    if (reloadBtn) reloadBtn.addEventListener('click', () => window.location.reload());
    if (libraryErrorPanel) libraryErrorPanel.style.display = 'block';
    hideLoading();
    // Stops the rest of this file, which needs the map library
    throw new Error('Leaflet did not load');
}

// === MAP INITIALIZATION ===
// The box that frames the whole country, Metula to Eilat.
// fitBounds picks the zoom for the screen size (a fixed zoom left Israel tiny on desktop).
const ISRAEL_BOUNDS = L.latLngBounds([29.45, 34.2], [33.35, 35.95]);
const map = L.map('map', {
    zoomSnap: 0.5,                        // lets fitBounds land between whole zoom levels
    minZoom: 7,
    maxBounds: ISRAEL_BOUNDS.pad(0.75),   // no panning far away from the data
    maxBoundsViscosity: 0.8,
    zoomControl: false                    // added below, on the right side
});
map.fitBounds(ISRAEL_BOUNDS);

// All map buttons sit on the right edge: the details panel opens on the left
// (bottom on phones) and used to cover the zoom / locate / basemap buttons.
L.control.zoom({ position: 'topright', zoomInTitle: 'התקרב', zoomOutTitle: 'התרחק' }).addTo(map);

// Define multiple basemap options
// CARTO raster tiles now require an API key (keyless requests return
// "API KEY REQUIRED" watermark tiles), so both styles use OpenStreetMap's
// keyless tiles. The light style is the same tiles desaturated via CSS
// (.basemap-light in style.css). maxZoom 19 = OSM's max native zoom.
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const baseMaps = {
    'רחובות': L.tileLayer(OSM_TILE_URL, {
        maxZoom: 19,
        crossOrigin: true, // lets the service worker read and cache the tiles
        attribution: OSM_ATTRIBUTION
    }),
    'בהיר': L.tileLayer(OSM_TILE_URL, {
        maxZoom: 19,
        className: 'basemap-light',
        crossOrigin: true,
        attribution: OSM_ATTRIBUTION
    })
};

// Credit for the location data, shown next to the map credit
map.attributionControl.addAttribution('<a href="https://mai.org.il" target="_blank" rel="noopener">נתונים: תאגיד מ.א.י</a>');

// Track current basemap
let currentBasemapName = 'בהיר';
baseMaps['בהיר'].addTo(map);

// Create toggle button for basemap with layers icon
const basemapToggle = L.control({ position: 'topright' });
basemapToggle.onAdd = function() {
    const btn = L.DomUtil.create('button', 'basemap-toggle-btn');
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
    </svg>`;
    btn.title = 'החלף ל: רחובות';
    btn.setAttribute('aria-label', 'החלף סגנון מפה');

    L.DomEvent.disableClickPropagation(btn);

    btn.onclick = function() {
        map.removeLayer(baseMaps[currentBasemapName]);

        if (currentBasemapName === 'בהיר') {
            currentBasemapName = 'רחובות';
            btn.title = 'החלף ל: בהיר';
        } else {
            currentBasemapName = 'בהיר';
            btn.title = 'החלף ל: רחובות';
        }

        baseMaps[currentBasemapName].addTo(map);
    };

    return btn;
};
basemapToggle.addTo(map);

// Wire up header search (search bar lives in the HTML header, not a Leaflet control)
(function initHeaderSearch() {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');
    if (!input || !clearBtn) return;

    input.addEventListener('input', () => {
        clearBtn.style.display = input.value.length > 0 ? 'flex' : 'none';
    });
    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        setSearch('', null);
        const suggestions = document.getElementById('search-suggestions');
        if (suggestions) {
            suggestions.classList.remove('active');
            suggestions.innerHTML = '';
        }
        input.setAttribute('aria-expanded', 'false');
        input.focus();
    });
})();

// Custom SVG marker icons.
// Each pin is flat (no gradients or filters): thousands of markers share the page,
// and per-marker <defs> meant repeated element ids plus slow filter rendering.
// The white outline keeps pins readable on any basemap and where they overlap.
const PIN_PATH = 'M18 1C9.7 1 3 7.7 3 16c0 10.5 15 30 15 30s15-19.5 15-30C33 7.7 26.3 1 18 1z';

// Small pictures drawn inside the white circle of a pin
const pinGlyphs = {
    // Battery
    store: `<rect x="15.5" y="8.5" width="5" height="2" rx="0.8" fill="currentColor"/>
        <rect x="13.5" y="10.5" width="9" height="11" rx="1.5" fill="currentColor"/>
        <path class="pin-casing" d="M19.2 12.2l-2.7 4.3h1.9l-.9 3.3 2.9-4.4h-1.9z"/>`,
    // Factory: a different shape, not just a different colour,
    // so the two types can be told apart without relying on colour vision
    facility: `<path d="M11.5 21.5v-7.2l4.2 2.6v-2.6l4.2 2.6V9.5h3.6v12z" fill="currentColor"/>
        <rect class="pin-casing" x="13.6" y="18" width="2" height="2"/>
        <rect class="pin-casing" x="17.4" y="18" width="2" height="2"/>`
};

// Colours are NOT written here. Every coloured shape uses fill="currentColor" and the
// white parts use the class "pin-casing"; style.css sets both from the design tokens
// (.battery-marker-store / .type-icon-store and so on).

function pinSvg(type, width, height) {
    return `<svg class="type-icon-${type}" viewBox="0 0 36 48" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path class="pin-casing-stroke" d="${PIN_PATH}" fill="currentColor" stroke-width="1.5"/>
        <circle class="pin-casing" cx="18" cy="15.5" r="9.5"/>
        ${pinGlyphs[type]}
    </svg>`;
}

const userSvg = `<svg viewBox="0 0 28 28" width="28" height="28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle class="pin-casing-stroke" cx="14" cy="14" r="11" fill="currentColor" stroke-width="3"/>
        <circle class="pin-casing" cx="14" cy="14" r="4"/>
    </svg>`;

function createMarkerIcon(type, width, height, extraClass = '') {
    return L.divIcon({
        html: pinSvg(type, width, height),
        className: 'battery-marker battery-marker-' + type + extraClass,
        iconSize: [width, height],
        iconAnchor: [width / 2, height],
        popupAnchor: [0, -height]
    });
}

// Facilities are rare (a handful among thousands), so their pin is slightly larger
const icons = {
    store: createMarkerIcon('store', 30, 40),
    facility: createMarkerIcon('facility', 34, 46),
    user: L.divIcon({
        html: userSvg,
        className: 'user-marker',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
    })
};

// The same pins with the class "selected" (drawn larger, see style.css)
const selectedIcons = {
    store: createMarkerIcon('store', 30, 40, ' selected'),
    facility: createMarkerIcon('facility', 34, 46, ' selected')
};

// Hebrew names for types
const typeNames = {
    store: 'נקודת איסוף',
    facility: 'מתקן מיחזור'
};

// Plural names, used in the map legend
const typeNamesPlural = {
    store: 'נקודות איסוף',
    facility: 'מתקני מיחזור'
};

// Small battery icons for popups (20×20, no pin shape)
const popupBatterySvg = {
    store: `<svg class="type-icon-store" viewBox="0 0 20 20" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
        <rect x="7" y="1" width="6" height="2.5" rx="1" fill="currentColor"/>
        <rect x="3" y="3.5" width="14" height="14" rx="2.5" fill="currentColor"/>
        <path class="pin-casing" d="M11.2 5.5l-2.6 5h2.1l-1 4 3.7-5.4h-2.2z"/>
    </svg>`,
    facility: `<svg class="type-icon-facility" viewBox="0 0 20 20" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 18V7.5l5.5 3.4V7.5l5.5 3.4V2h5v16z" fill="currentColor"/>
        <rect class="pin-casing" x="4.8" y="13" width="2.6" height="2.6"/>
        <rect class="pin-casing" x="9.8" y="13" width="2.6" height="2.6"/>
    </svg>`
};

// Inline SVG icons for like/dislike buttons (18×18, stroke-based)
const thumbsUpSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3m7-2V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg>';
const thumbsDownSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17m-7 2v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/></svg>';

// Store all locations and markers
let allLocations = [];
let allMarkers = [];
let userMarker = null;
let userLocation = null;
let totalLocations = 0;

// Which location types are switched on in the legend
const visibleTypes = { store: true, facility: true };

// Marker cluster group (collection points only).
// A cluster's size shows how many points it holds; colour only deepens slightly,
// staying in the app's teal so clusters and pins read as the same data.
const markerCluster = L.markerClusterGroup({
    chunkedLoading: true, // pins are added in small batches, so a slow phone does not freeze
    // Called after every batch. The last batch is still being finished at that moment,
    // so the "all added" step waits for the current piece of work to end (a microtask).
    chunkProgress: (processed, total) => {
        if (processed === total) queueMicrotask(markerBatchesDone);
    },
    // Wider grouping when zoomed out keeps bubbles from piling on top of each other
    maxClusterRadius: zoom => (zoom <= 9 ? 70 : zoom <= 13 ? 55 : 40),
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        let size = 'small';
        let diameter = 36;
        if (count >= 1000) { size = 'xlarge'; diameter = 60; }
        else if (count >= 100) { size = 'large'; diameter = 52; }
        else if (count >= 10) { size = 'medium'; diameter = 44; }

        const ariaLabel = count === 1 ? 'נקודת איסוף אחת' : `${count} נקודות איסוף`;

        return L.divIcon({
            html: `<div aria-label="${ariaLabel}"><span>${count.toLocaleString('he-IL')}</span></div>`,
            className: `marker-cluster marker-cluster-${size}`,
            iconSize: L.point(diameter, diameter)
        });
    }
});
map.addLayer(markerCluster);

// Facilities live in their own layer and are never clustered:
// inside a cluster of hundreds of collection points they would be invisible.
const facilityLayer = L.layerGroup().addTo(map);

// Pre-computed city counts for O(1) lookup in autocomplete
const cityCounts = new Map();

// Current state
let currentSearch = '';       // the text in the search box
let currentCity = null;       // a city picked from the suggestions, or null
let searchTimeout = null;     // the short wait after typing, before the map updates
let selectedLocationId = null;

// Calculate distance between two points (in km)
function getDistance(lat1, lng1, lat2, lng2) {
    const R = EARTH_RADIUS_KM;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// A distance as people read it: metres (rounded to 10) under 1 km, km above
function formatDistance(km) {
    const metres = Math.round(km * 100) * 10;
    if (metres < 1000) return `${metres} מ׳`;
    return `${km.toFixed(1)} ק"מ`;
}

// Build report URL with pre-filled location name, address, and city
function getReportUrl(location) {
    const params = new URLSearchParams({
        'entry.1466478113': location.name,
        'entry.1234054889': location.address,
        'entry.1388870063': location.city,
        'hl': 'he'
    });
    return `${REPORT_FORM_URL}?${params.toString()}`;
}

// Same form, for the thumbs-up button: the name field starts with "✔ הנקודה קיימת:"
// so a confirmation is easy to tell from a problem report in the form's answers
function getConfirmUrl(location) {
    const params = new URLSearchParams({
        'entry.1466478113': '✔ הנקודה קיימת: ' + location.name,
        'entry.1234054889': location.address,
        'entry.1388870063': location.city,
        'hl': 'he'
    });
    return `${REPORT_FORM_URL}?${params.toString()}`;
}

// Create sidebar content for a location
function createSidebarContent(location) {
    const hasAddress = location.address && location.address !== 'Unknown' && location.address !== location.name;

    let distanceHtml = '';
    if (userLocation) {
        const distance = getDistance(
            userLocation.lat, userLocation.lng,
            location.lat, location.lng
        );
        distanceHtml = `
            <div class="info-row">
                <span class="info-icon">📏</span>
                <span class="info-text distance">${formatDistance(distance)} בקו אווירי</span>
            </div>
        `;
    }

    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`;
    const wazeUrl = `https://waze.com/ul?ll=${location.lat},${location.lng}&navigate=yes`;

    return `
        <div class="sidebar-header">
            <div class="sidebar-title">
                <h2 tabindex="-1">${escapeHtml(location.name)}</h2>
                ${location.type === 'facility' ? `<span class="type-badge">${typeNames.facility}</span>` : ''}
            </div>
        </div>

        <div class="sidebar-info">
            ${hasAddress ? `<div class="info-row">
                <span class="info-text">${escapeHtml(location.address)}</span>
            </div>` : ''}
            ${location.hours && location.hours !== 'בדוק באתר' ? `
            <div class="info-row">
                <span class="info-icon">🕐</span>
                <span class="info-text">${escapeHtml(location.hours)}</span>
            </div>
            ` : ''}
            ${location.description ? `
            <div class="info-row">
                <span class="info-icon">ℹ️</span>
                <span class="info-text">${escapeHtml(location.description)}</span>
            </div>
            ` : ''}
            ${distanceHtml}
        </div>

        <div class="sidebar-nav">
            <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="sidebar-nav-btn google">
                נווט ב-Google
            </a>
            <a href="${wazeUrl}" target="_blank" rel="noopener noreferrer" class="sidebar-nav-btn waze">
                נווט ב-Waze
            </a>
        </div>

        <div class="feedback-row">
            <button class="feedback-btn like-btn" data-like-id="${location.id}" data-confirm-url="${escapeHtml(getConfirmUrl(location))}" aria-label="הנקודה קיימת - אישור בטופס">
                ${thumbsUpSvg}
            </button>
            <button class="feedback-btn dislike-btn" data-report-url="${escapeHtml(getReportUrl(location))}" aria-label="דווח על בעיה">
                ${thumbsDownSvg}
            </button>
        </div>
    `;
}

// Cached sidebar DOM references (set once after DOMContentLoaded)
const cachedSidebar = document.getElementById('sidebar');
const cachedSidebarContent = document.getElementById('sidebar-content');
const cachedSidebarClose = document.getElementById('sidebar-close');

// The point whose details are open gets a pin of its own, larger, on a layer above
// the clusters. So it can be seen at any zoom, also while its ordinary pin is still
// counted inside a cluster bubble. The "selected" class is styled in style.css.
const selectedLayer = L.layerGroup().addTo(map);
const selectedPin = L.marker([0, 0], {
    icon: selectedIcons.store,
    zIndexOffset: 1500, // above facilities (1000), below the user dot (2000)
    keyboard: false     // the ordinary pin under it is the one the keyboard reaches
});
function setSelectedLocation(location) {
    if (!location) {
        selectedLayer.removeLayer(selectedPin);
        return;
    }
    selectedPin.setLatLng([location.lat, location.lng]);
    selectedPin.setIcon(selectedIcons[location.type] || selectedIcons.store);
    selectedLayer.addLayer(selectedPin);
}

// On phones the details open as a sheet over the bottom of the map.
// sheetHeight() is how much of the map's bottom the open sheet covers (0 on a desktop).
function sheetHeight() {
    if (!cachedSidebar || window.innerWidth > MOBILE_BREAKPOINT) return 0;
    if (cachedSidebar.style.display === 'none') return 0;
    if (cachedSidebar.offsetWidth < map.getSize().x) return 0; // landscape: a side panel, not a sheet
    return cachedSidebar.offsetHeight;
}

// Move the map just enough for the pin to stay visible above the sheet.
function keepPinAboveSheet(location) {
    const covered = sheetHeight();
    if (covered === 0) return;
    map.panInside([location.lat, location.lng], {
        paddingTopLeft: [20, 60], // room for the pin itself, which is drawn above its point
        paddingBottomRight: [20, covered + 20]
    });
}

// Show sidebar with location details
let sidebarHideTimer = null;
function showSidebar(location) {
    if (!cachedSidebar || !cachedSidebarContent) return;

    // Cancel a hide that is still animating, or it would hide the sidebar we are about to show
    clearTimeout(sidebarHideTimer);

    selectedLocationId = location.id;
    setSelectedLocation(location);
    cachedSidebarContent.innerHTML = createSidebarContent(location);
    cachedSidebar.style.transform = ''; // clear leftover swipe position
    cachedSidebar.style.display = 'flex';
    cachedSidebar.classList.remove('hidden');

    // Focus goes into the details, so a screen reader says they opened. The phone
    // sheet hides its close button (swipe down or Escape closes it): then the heading.
    if (cachedSidebarClose && cachedSidebarClose.offsetParent !== null) {
        cachedSidebarClose.focus({ preventScroll: true });
    } else {
        const heading = cachedSidebarContent.querySelector('h2');
        if (heading) heading.focus({ preventScroll: true });
    }
}

// Hide sidebar
function hideSidebar() {
    if (cachedSidebar && cachedSidebar.style.display !== 'none') {
        cachedSidebar.classList.add('hidden');
        clearTimeout(sidebarHideTimer);
        sidebarHideTimer = setTimeout(() => {
            cachedSidebar.style.display = 'none';
            cachedSidebar.style.transform = '';
        }, 300);
    }
    selectedLocationId = null;
    setSelectedLocation(null);
}

// Adding thousands of pins to the cluster layer takes several batches, with pauses
// in between so a slow phone does not freeze.
// Never start a new add while one is running: the cluster layer would go on adding
// the rest of the OLD list, and the map would show pins the search does not match.
// A change that arrives meanwhile is remembered and drawn once, when the add ends.
let markerAddRunning = false;   // markerCluster.addLayers() has not finished
let redrawWanted = false;       // the search or the legend changed during that add
function markerBatchesDone() {
    // The cluster layer also reports an (empty) add of its own when it is put on the map
    if (!markerAddRunning) return;
    markerAddRunning = false;
    if (redrawWanted) {
        redrawWanted = false;
        drawMarkers(); // reads the search as it is now, so states in between are skipped
    }
}

// Set what the map is filtered by, and redraw. Every change of the search goes
// through here, so a typing timer that is still waiting can never bring old text back.
function setSearch(text, city) {
    clearTimeout(searchTimeout);
    currentSearch = text;
    currentCity = city;
    return updateMarkers();
}

// The markers that the search text and the legend switches leave visible right now
function visibleMarkerItems() {
    const matches = new Set(searchLocations(allLocations, currentSearch, currentCity));
    return allMarkers.filter(item => visibleTypes[item.location.type] && matches.has(item.location));
}

// Put those markers on the map, replacing what was there
function drawMarkers() {
    const clusteredMarkers = [];
    facilityLayer.clearLayers();
    visibleMarkerItems().forEach(item => {
        if (item.location.type === 'facility') {
            facilityLayer.addLayer(item.marker);
        } else {
            clusteredMarkers.push(item.marker);
        }
    });
    markerCluster.clearLayers();
    markerAddRunning = true; // markerBatchesDone() switches it off, also for an empty list
    markerCluster.addLayers(clusteredMarkers);
}

// Update which markers are visible based on search and the legend switches.
// Returns the markers that will be shown; they may still be on their way to the map.
function updateMarkers() {
    const visibleMarkers = visibleMarkerItems().map(item => item.marker);

    if (markerAddRunning) redrawWanted = true;
    else drawMarkers();

    visibleMarkerCount = visibleMarkers.length;
    updateEmptyState();

    return visibleMarkers;
}

// Show the "no results" panel only when the search or the legend hides every pin.
// While the suggestion list is open the panel stays hidden, because the list may be
// offering the right spelling (typing "ירושלם" suggests ירושלים) and the two would overlap.
let visibleMarkerCount = 0;
function updateEmptyState() {
    const emptyState = document.getElementById('empty-state');
    if (!emptyState) return;
    const suggestions = document.getElementById('search-suggestions');
    const listOpen = suggestions && suggestions.classList.contains('active') && suggestions.children.length > 0;
    const isFiltered = currentSearch !== '' || !visibleTypes.store || !visibleTypes.facility;
    const isEmpty = visibleMarkerCount === 0 && isFiltered && allMarkers.length > 0;
    emptyState.style.display = isEmpty && !listOpen ? 'block' : 'none';
}

// Close the suggestion list without picking from it
function closeSuggestions() {
    const suggestions = document.getElementById('search-suggestions');
    const searchInput = document.getElementById('search-input');
    if (!suggestions || !suggestions.classList.contains('active')) return;
    suggestions.classList.remove('active');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'false');
    updateEmptyState(); // it may have been waiting for the list to close
}

// Auto-zoom to visible markers
function zoomToVisibleMarkers(visibleMarkers) {
    if (visibleMarkers.length === 0) return;

    if (visibleMarkers.length === 1) {
        // One result: open it, the same as picking it from the suggestions
        const only = allMarkers.find(item => item.marker === visibleMarkers[0]);
        if (only) focusOnLocation(only.location.id);
    } else {
        const group = L.featureGroup(visibleMarkers);
        map.flyToBounds(group.getBounds(), {
            padding: [50, 50],
            duration: 0.8,
            maxZoom: 14
        });
    }
}

// === AUTOCOMPLETE SEARCH ===
let autocompleteInitialized = false;
function setupAutocomplete() {
    if (autocompleteInitialized) return;
    autocompleteInitialized = true;

    const searchInput = document.getElementById('search-input');
    const suggestions = document.getElementById('search-suggestions');
    if (!searchInput || !suggestions) return;

    let highlightedIndex = -1;

    searchInput.addEventListener('input', () => {
        const text = searchInput.value.trim().substring(0, 50);
        const query = normalizeQuery(text);

        // The map follows the text in the box, with or without a suggestion list.
        // Typing also ends an earlier city pick.
        clearTimeout(searchTimeout);
        currentCity = null;

        if (query.length < 2) {
            suggestions.classList.remove('active');
            searchInput.setAttribute('aria-expanded', 'false');
            suggestions.innerHTML = '';
            highlightedIndex = -1;
            setSearch(text, null);
            return;
        }

        searchTimeout = setTimeout(() => setSearch(text, null), 300);

        // Cities with a near spelling are offered only when no location has the text itself
        const cityMatches = matchCities(cityCounts, text, findContaining(allLocations, text).length);

        // Locations: the same ones the map will show for this text
        const locationMatches = searchLocations(allLocations, text, null).map(location => ({
            type: 'location',
            id: location.id,
            name: location.name,
            address: location.address, // it ends with the city
            locationType: location.type
        }));

        const limitedMatches = [...cityMatches, ...locationMatches].slice(0, 8);

        if (limitedMatches.length === 0) {
            suggestions.classList.remove('active');
            searchInput.setAttribute('aria-expanded', 'false');
            suggestions.innerHTML = '';
            return;
        }

        suggestions.innerHTML = limitedMatches.map((match) => {
            if (match.type === 'city') {
                return `
                    <div class="suggestion-item"
                         role="option"
                         data-type="city"
                         data-value="${escapeHtml(match.name)}"
                         tabindex="-1">
                        <span class="suggestion-icon">🏙️</span>
                        <div class="suggestion-text">
                            <div class="suggestion-name">${escapeHtml(match.name)}</div>
                            <div class="suggestion-city">${match.count === 1 ? 'נקודה אחת' : `${match.count} נקודות`}</div>
                        </div>
                    </div>
                `;
            } else {
                const icon = match.locationType === 'facility' ? '🏭' : '🟢';
                return `
                    <div class="suggestion-item"
                         role="option"
                         data-type="location"
                         data-id="${match.id}"
                         tabindex="-1">
                        <span class="suggestion-icon">${icon}</span>
                        <div class="suggestion-text">
                            <div class="suggestion-name">${escapeHtml(match.name)}</div>
                            <div class="suggestion-city">${escapeHtml(match.address)}</div>
                        </div>
                    </div>
                `;
            }
        }).join('');

        suggestions.classList.add('active');
        searchInput.setAttribute('aria-expanded', 'true');
        highlightedIndex = -1;
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        const items = suggestions.querySelectorAll('.suggestion-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
            updateHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, -1);
            updateHighlight(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const listOpen = suggestions.classList.contains('active') && items.length > 0;
            const text = searchInput.value.trim().substring(0, 50);
            // Decided from the text, not from the list: the list may be closed already
            // (a second Enter, or Escape first) and the answer must stay the same
            const typedCity = matchCities(cityCounts, text)[0];
            if (listOpen && highlightedIndex >= 0) {
                selectSuggestion(items[highlightedIndex]);
            } else if (typedCity && typedCity.same) {
                // The text is a city name (or a short name for one): show that city
                pickCity(typedCity.name);
            } else {
                // Anything else (a shop name, part of a word): show the typed text on the map
                const visibleMarkers = setSearch(text, null);
                closeSuggestions();
                highlightedIndex = -1;
                zoomToVisibleMarkers(visibleMarkers);
            }
        } else if (e.key === 'Escape') {
            closeSuggestions();
            highlightedIndex = -1;
        }
    });

    function updateHighlight(items) {
        items.forEach((item, index) => {
            const isActive = index === highlightedIndex;
            item.classList.toggle('highlighted', isActive);
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
            if (isActive) {
                item.id = 'suggestion-active';
                searchInput.setAttribute('aria-activedescendant', 'suggestion-active');
            } else {
                if (item.id === 'suggestion-active') item.removeAttribute('id');
            }
        });
        if (highlightedIndex < 0) {
            searchInput.removeAttribute('aria-activedescendant');
        }
    }

    function emptySuggestions() {
        suggestions.classList.remove('active');
        searchInput.setAttribute('aria-expanded', 'false');
        suggestions.innerHTML = '';
        highlightedIndex = -1;
    }

    // Show exactly one city on the map
    function pickCity(city) {
        searchInput.value = city;
        const visibleMarkers = setSearch(city, city);
        zoomToVisibleMarkers(visibleMarkers);
        emptySuggestions();
    }

    function selectSuggestion(item) {
        if (item.dataset.type === 'city') {
            pickCity(item.dataset.value);
            return;
        }
        const locationId = parseInt(item.dataset.id, 10);
        if (isNaN(locationId)) return;
        // The box is emptied, so the map goes back to showing everything
        searchInput.value = '';
        const clearBtn = document.getElementById('search-clear');
        if (clearBtn) clearBtn.style.display = 'none';
        setSearch('', null);
        focusOnLocation(locationId);
        emptySuggestions();
    }

    suggestions.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (item) selectSuggestion(item);
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestions.contains(e.target)) {
            closeSuggestions();
        }
    });
}

// Focus on a location: open its details and fly the map to it
function focusOnLocation(locationId) {
    const location = allLocations.find(l => l.id === locationId);
    if (!location) return;

    // Details first: the flight below needs to know how high the sheet is
    showSidebar(location);

    // On a phone the sheet covers the bottom of the map, so aim for the middle of
    // the part that stays visible: the map centre goes half a sheet below the point.
    const zoom = Math.max(map.getZoom(), 16);
    const centre = map.unproject(map.project([location.lat, location.lng], zoom).add([0, sheetHeight() / 2]), zoom);

    // flyTo ends a flight or pan that is still running, and ending a pan fires
    // "moveend" at once. So the listener is added after flyTo: the next "moveend"
    // is then the end of this flight.
    map.flyTo(centre, zoom, { duration: 0.8 });
    map.once('moveend', () => {
        // The details may be closed or show another place by now: then do nothing
        if (selectedLocationId === locationId) keepPinAboveSheet(location);
    });
}

// === GPS GEOLOCATION ===
const locateIconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
    </svg>`;
let gpsActive = false;
let userAccuracyCircle = null;

// Beyond this distance "nearest" is not useful: the map stays where it is
const NEAREST_MAX_KM = 30;

// Closest collection point to a position (facilities are not public drop-off points)
function findNearestLocation(lat, lng) {
    let best = null;
    for (const location of allLocations) {
        if (location.type !== 'store') continue;
        const distance = getDistance(lat, lng, location.lat, location.lng);
        if (!best || distance < best.distance) best = { location, distance };
    }
    return best;
}

// Open the details of the nearest point and frame it together with the user,
// both above the sheet on a phone. Used by the first tap and by every later tap.
function showNearest(nearest) {
    const location = nearest.location;
    showSidebar(location); // first: the framing below needs the height of the sheet
    const view = L.latLngBounds([[userLocation.lat, userLocation.lng], [location.lat, location.lng]]);
    // On a desktop the details panel covers the map's left side
    const panel = sheetHeight() === 0 && cachedSidebar && window.innerWidth > MOBILE_BREAKPOINT ? cachedSidebar.offsetWidth : 0;
    map.flyToBounds(view, {
        paddingTopLeft: [40 + panel, 80], // room above for the pin, which is drawn above its point
        paddingBottomRight: [40, sheetHeight() + 40],
        maxZoom: 17,
        duration: 0.8
    });
    map.once('moveend', () => {
        if (selectedLocationId === location.id) keepPinAboveSheet(location);
    });
}

const locateControl = L.control({ position: 'topright' });
locateControl.onAdd = function() {
    const btn = L.DomUtil.create('button', 'locate-btn');
    btn.innerHTML = locateIconSvg;
    btn.title = 'מצא את מיקומי';
    btn.setAttribute('aria-label', 'מצא את מיקומי');

    L.DomEvent.disableClickPropagation(btn);

    btn.onclick = function() {
        // Already located: go back to the user and the nearest point (like a map app's re-centre)
        if (gpsActive && userLocation) {
            const nearest = findNearestLocation(userLocation.lat, userLocation.lng);
            if (nearest && nearest.distance <= NEAREST_MAX_KM) {
                showNearest(nearest);
                return;
            }
        }

        // Find my location
        if (!navigator.geolocation) {
            showNotification('הדפדפן לא תומך באיתור מיקום');
            return;
        }

        // Prevent concurrent geolocation requests
        if (btn.classList.contains('loading')) return;

        btn.classList.add('loading');
        // Shown for the whole wait (the browser gives up after 10 s); the answer replaces it
        showNotification('מאתר מיקום...', 11000);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                btn.classList.remove('loading');
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;

                // The map only covers Israel; don't fly to a location it cannot show
                if (!map.options.maxBounds.contains([lat, lng])) {
                    showNotification('המיקום שלך מחוץ לאזור המפה', 3000);
                    return;
                }

                userLocation = { lat, lng };

                // Place/update user marker. It cannot be tapped: it often sits on top
                // of the nearest pin and would take the tap meant for that pin.
                if (userMarker) {
                    userMarker.setLatLng([lat, lng]);
                } else {
                    userMarker = L.marker([lat, lng], { icon: icons.user, zIndexOffset: 2000, keyboard: false, interactive: false })
                        .addTo(map);
                }

                // Circle showing how precise the GPS fix is (radius in metres)
                const accuracy = Math.min(position.coords.accuracy || 0, 2000);
                if (userAccuracyCircle) {
                    userAccuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
                } else {
                    userAccuracyCircle = L.circle([lat, lng], {
                        radius: accuracy,
                        className: 'user-accuracy', // colour comes from style.css
                        weight: 1,
                        fillOpacity: 0.12,
                        interactive: false
                    }).addTo(map);
                }

                // Open the nearest collection point. Its details say what was found,
                // so no message is needed. Nothing near: the map stays where it is.
                const nearest = findNearestLocation(lat, lng);
                if (nearest && nearest.distance <= NEAREST_MAX_KM) {
                    hideNotification();
                    gpsActive = true;
                    btn.classList.add('active');
                    showNearest(nearest);
                } else {
                    gpsActive = false;
                    btn.classList.remove('active');
                    showNotification('אין נקודות איסוף עד 30 ק"מ ממך', 4000);
                }
            },
            () => {
                // Denied, unavailable or too slow: searching is the other way to a point
                btn.classList.remove('loading');
                showNotification('לא הצלחנו לאתר מיקום. חפשו עיר או רחוב', 5000);
                const searchInput = document.getElementById('search-input');
                if (searchInput) searchInput.focus();
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    };

    return btn;
};
locateControl.addTo(map);

// === LEGEND ===
// Explains the two pin types and doubles as an on/off filter for each.
const legendControl = L.control({ position: 'bottomright' });
legendControl.onAdd = function() {
    const container = L.DomUtil.create('div', 'map-legend');
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'מקרא וסינון לפי סוג');
    container.hidden = true; // shown by updateLegendCounts() once the data has loaded
    container.innerHTML = Object.keys(visibleTypes).map(type => `
        <button type="button" class="legend-item" data-legend-type="${type}" aria-pressed="true">
            <span class="legend-icon">${pinSvg(type, 18, 24)}</span>
            <span class="legend-label">${typeNamesPlural[type]}</span>
            <span class="legend-count" data-legend-count="${type}"></span>
        </button>`).join('');

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    // One listener on the container handles both buttons (control is created once)
    container.addEventListener('click', (e) => {
        const item = e.target.closest('[data-legend-type]');
        if (!item) return;
        const type = item.dataset.legendType;
        setTypeVisible(type, !visibleTypes[type]);
        updateMarkers();
    });

    return container;
};
legendControl.addTo(map);

function setTypeVisible(type, isVisible) {
    visibleTypes[type] = isVisible;
    const item = document.querySelector(`[data-legend-type="${type}"]`);
    if (item) item.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
}

function updateLegendCounts() {
    let typesWithData = 0;
    Object.keys(visibleTypes).forEach(type => {
        const count = allLocations.filter(loc => loc.type === type).length;
        if (count > 0) typesWithData++;

        const el = document.querySelector(`[data-legend-count="${type}"]`);
        if (el) el.textContent = count.toLocaleString('he-IL');

        // A type with no locations gets no legend row
        const item = document.querySelector(`[data-legend-type="${type}"]`);
        if (item) item.hidden = count === 0;
    });

    // With only one kind of pin on the map there is nothing to explain or filter
    const legend = document.querySelector('.map-legend');
    if (legend) legend.hidden = typesWithData < 2;
}

// Clicking the map background closes the details panel
map.on('click', hideSidebar);

// Loading functions
function showLoading(text) {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    if (overlay) {
        overlay.classList.remove('fade-out');
        overlay.style.display = 'flex';
    }
    if (loadingText && text) {
        loadingText.textContent = text;
    }
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('fade-out');
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 400);
    }
}

// === INITIALIZATION ===
function loadLocations() {
    autocompleteInitialized = false;
    showLoading('טוען נקודות איסוף...');

    fetch('locations.json')
        .then(response => {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(data => {
            // Validate and filter location data
            allLocations = data.locations.filter(isValidLocation);
            totalLocations = allLocations.length;
            // The text each search looks through, built once instead of on every keystroke
            allLocations.forEach(location => { location.searchText = locationSearchText(location); });

            // Pre-compute city counts for fast autocomplete
            cityCounts.clear();
            allLocations.forEach(loc => {
                cityCounts.set(loc.city, (cityCounts.get(loc.city) || 0) + 1);
            });

            const loadingText = document.getElementById('loading-text');
            if (loadingText) {
                loadingText.textContent = `טוען ${totalLocations} נקודות איסוף...`;
            }

            // Clear previous markers if retrying
            setSelectedLocation(null);
            allMarkers = [];
            markerCluster.clearLayers();

            allLocations.forEach(location => {
                const isFacility = location.type === 'facility';
                const marker = L.marker([location.lat, location.lng], {
                    icon: icons[location.type] || icons.store,
                    zIndexOffset: isFacility ? 1000 : 0 // facilities draw above other pins
                });

                // A tap, a click and Enter on a focused pin all open the same details
                // (sidebar, or the sheet on a phone). There is no pin popup.
                marker.on('click', () => {
                    showSidebar(location);
                    keepPinAboveSheet(location);
                });
                marker.on('keypress', (e) => {
                    if (e.originalEvent.key !== 'Enter') return;
                    showSidebar(location);
                    keepPinAboveSheet(location);
                });

                // Add aria-label when marker is added to map.
                // No escapeHtml here: setAttribute takes plain text, so escaping
                // would make screen readers read out "&quot;" in names like ביה"ס
                marker.on('add', () => {
                    const element = marker.getElement();
                    if (element) {
                        element.setAttribute('aria-label', `${location.name} - ${typeNames[location.type]}`);
                    }
                });

                allMarkers.push({ marker, location });
            });

            setupAutocomplete();
            updateLegendCounts();

            // After a failed load the panel still holds the error texts: put the
            // "no results" texts back. updateMarkers() then shows or hides the panel.
            setEmptyStateText('לא נמצאו תוצאות', 'נסה לשנות את הסינון או לחפש מונח אחר', 'נקה סינון');
            updateMarkers();

            // PWA shortcut ?action=nearest: only now is there data to find the nearest point in
            if (pendingNearest) {
                pendingNearest = false;
                const locateBtn = document.querySelector('.locate-btn');
                if (locateBtn) locateBtn.click();
            }

            setTimeout(() => {
                hideLoading();
            }, 300);
        })
        .catch(error => {
            console.error('Error loading locations:', error);
            hideLoading();

            // Show empty state with retry option
            setEmptyStateText('שגיאה בטעינת הנתונים', 'בדוק את החיבור לאינטרנט ונסה שוב', 'נסה שוב');
            const emptyState = document.getElementById('empty-state');
            if (emptyState) emptyState.style.display = 'block';
        });
}

// PWA shortcut ?action=nearest: remembered here, carried out when the data has loaded
let pendingNearest = new URLSearchParams(window.location.search).get('action') === 'nearest';

loadLocations();

// === EVENT LISTENERS ===

// Sidebar Close
const sidebarClose = document.getElementById('sidebar-close');
if (sidebarClose) {
    sidebarClose.addEventListener('click', hideSidebar);
}

// Sidebar swipe-to-close on mobile
const sidebarEl = document.getElementById('sidebar');
const sidebarContentEl = document.getElementById('sidebar-content');
if (sidebarEl && sidebarContentEl) {
    let touchStartY = 0;
    let touchCurrentY = 0;
    let isDragging = false;

    sidebarEl.addEventListener('touchstart', (e) => {
        if (window.innerWidth > MOBILE_BREAKPOINT) return;
        touchStartY = e.touches[0].clientY;
        touchCurrentY = touchStartY;
        isDragging = false;
    }, { passive: true });

    sidebarEl.addEventListener('touchmove', (e) => {
        if (window.innerWidth > MOBILE_BREAKPOINT) return;
        touchCurrentY = e.touches[0].clientY;
        const deltaY = touchCurrentY - touchStartY;

        // Only start drag when content is scrolled to top AND swiping down
        if (!isDragging) {
            if (sidebarContentEl.scrollTop <= 0 && deltaY > 0) {
                isDragging = true;
                sidebarEl.style.transition = 'none';
            } else {
                return; // let normal scroll happen
            }
        }

        // Block scroll and pull-to-refresh during drag
        e.preventDefault();
        if (deltaY > 0) {
            sidebarEl.style.transform = `translateY(${deltaY}px)`;
        }
    }, { passive: false });

    sidebarEl.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        sidebarEl.style.transition = '';
        const deltaY = touchCurrentY - touchStartY;
        const threshold = sidebarEl.offsetHeight * 0.4;
        // Clearing the inline position lets the CSS transition finish the movement
        sidebarEl.style.transform = '';
        if (deltaY > threshold) hideSidebar();
        touchStartY = 0;
        touchCurrentY = 0;
    });
}

// Clear filters / empty state / retry
const clearFiltersBtn = document.getElementById('clear-filters');
if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
        if (allLocations.length === 0) {
            // No data loaded — this is a retry
            loadLocations();
        } else {
            // Clear the search and switch every legend type back on
            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = '';
            const clearBtn = document.getElementById('search-clear');
            if (clearBtn) clearBtn.style.display = 'none';
            Object.keys(visibleTypes).forEach(type => setTypeVisible(type, true));
            setSearch('', null);
        }
    });
}

// Close sidebar and autocomplete on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideSidebar();
        closeSuggestions();
    }
});

// Delegated click handler for feedback buttons (avoids inline onclick)
document.addEventListener('click', (e) => {
    const likeBtn = e.target.closest('[data-like-id]');
    if (likeBtn) { handleLike(Number(likeBtn.dataset.likeId), likeBtn.dataset.confirmUrl); return; }
    const dislikeBtn = e.target.closest('[data-report-url]');
    if (dislikeBtn) { handleDislike(dislikeBtn.dataset.reportUrl); return; }
});

