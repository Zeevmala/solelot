// ============================================
// Battery Recycling Map - Israel
// ============================================

// === NOTIFICATION SYSTEM ===
let notificationTimeout;
function showNotification(message, duration = 2000) {
    const notification = document.getElementById('notification');
    if (!notification) return;

    clearTimeout(notificationTimeout);
    notification.textContent = message;
    notification.style.display = 'block';
    notification.classList.add('show');

    notificationTimeout = setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.style.display = 'none';
        }, 300);
    }, duration);
}

// Report form URL
const REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSey-yMW6dMKCiq0mPqdWdNTa3ccg0xQ6zn-Ca_3f6jiOMCbng/viewform';

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

// === MAP INITIALIZATION ===
const map = L.map('map').setView([31.5, 34.9], 7);

// Define multiple basemap options
const baseMaps = {
    'רחובות': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB © OpenStreetMap'
    }),
    'בהיר': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB'
    })
};

// Track current basemap
let currentBasemapName = 'בהיר';
baseMaps['בהיר'].addTo(map);

// Create toggle button for basemap with layers icon
const basemapToggle = L.control({ position: 'bottomleft' });
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

// Create search control on map
const searchControl = L.control({ position: 'topright' });
searchControl.onAdd = function() {
    const container = L.DomUtil.create('div', 'map-search-container');
    container.innerHTML = `
        <input type="text" id="search-input" class="map-search-input" placeholder="חיפוש נקודה..." aria-label="חיפוש נקודה" autocomplete="off">
        <button id="search-clear" class="search-clear-btn" aria-label="נקה חיפוש" type="button">✕</button>
        <div id="search-suggestions" class="search-suggestions" role="listbox"></div>
    `;

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const input = container.querySelector('#search-input');
    L.DomEvent.on(input, 'keydown keyup keypress', L.DomEvent.stopPropagation);

    // Clear search button — show/hide based on input content
    const clearBtn = container.querySelector('#search-clear');
    input.addEventListener('input', () => {
        clearBtn.style.display = input.value.length > 0 ? 'flex' : 'none';
    });
    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        currentSearch = '';
        updateMarkers();
        const suggestions = document.getElementById('search-suggestions');
        if (suggestions) {
            suggestions.classList.remove('active');
            suggestions.innerHTML = '';
        }
        input.focus();
    });

    return container;
};
searchControl.addTo(map);

// Custom SVG Marker Icons — rounded Google-style pins
const markerSvg = {
    store: `<svg viewBox="0 0 36 48" width="36" height="48" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="storeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#26A69A"/>
                <stop offset="100%" stop-color="#00796B"/>
            </linearGradient>
            <filter id="storeShadow" x="-25%" y="-15%" width="150%" height="150%">
                <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.25"/>
            </filter>
        </defs>
        <path d="M18 1C9.7 1 3 7.7 3 16c0 10.5 15 30 15 30s15-19.5 15-30C33 7.7 26.3 1 18 1z" fill="url(#storeGrad)" filter="url(#storeShadow)"/>
        <circle cx="18" cy="15" r="9" fill="white" opacity="0.95"/>
        <rect x="15" y="9.5" width="6" height="2" rx="1" fill="#00796B"/>
        <rect x="13" y="11.5" width="10" height="7" rx="1.5" fill="#26A69A"/>
        <rect x="14.5" y="13" width="7" height="1.5" rx="0.5" fill="#80CBC4"/>
        <rect x="14.5" y="15.5" width="7" height="1.5" rx="0.5" fill="#B2DFDB"/>
    </svg>`,
    facility: `<svg viewBox="0 0 36 48" width="36" height="48" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="facilityGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#FFA726"/>
                <stop offset="100%" stop-color="#EF6C00"/>
            </linearGradient>
            <filter id="facilityShadow" x="-25%" y="-15%" width="150%" height="150%">
                <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.25"/>
            </filter>
        </defs>
        <path d="M18 1C9.7 1 3 7.7 3 16c0 10.5 15 30 15 30s15-19.5 15-30C33 7.7 26.3 1 18 1z" fill="url(#facilityGrad)" filter="url(#facilityShadow)"/>
        <circle cx="18" cy="15" r="9" fill="white" opacity="0.95"/>
        <path d="M13 18v-5l3.5 2.5L20 13v5h-1.5v-3l-2 1.5L14.5 15v3z" fill="#EF6C00"/>
        <rect x="14" y="10" width="8" height="1.5" rx="0.5" fill="#FFA726"/>
    </svg>`,
    user: `<svg viewBox="0 0 36 48" width="36" height="48" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="userGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#42A5F5"/>
                <stop offset="100%" stop-color="#1565C0"/>
            </linearGradient>
            <filter id="userShadow" x="-25%" y="-15%" width="150%" height="150%">
                <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.25"/>
            </filter>
        </defs>
        <circle cx="18" cy="16" r="13" fill="url(#userGrad)" filter="url(#userShadow)" stroke="white" stroke-width="3"/>
        <circle cx="18" cy="16" r="5" fill="white"/>
        <circle cx="18" cy="16" r="2" fill="#1565C0"/>
    </svg>`
};

function createMarkerIcon(type) {
    return L.divIcon({
        html: markerSvg[type],
        className: 'battery-marker',
        iconSize: [36, 48],
        iconAnchor: [18, 48],
        popupAnchor: [0, -48]
    });
}

const icons = {
    store: createMarkerIcon('store'),
    facility: createMarkerIcon('facility'),
    user: createMarkerIcon('user')
};

// Hebrew names for types
const typeNames = {
    store: 'נקודת איסוף',
    facility: 'מתקן מיחזור'
};

// Chain names in Hebrew
const chainNames = {
    superpharm: 'סופר פארם',
    shufersal: 'שופרסל',
    rami_levy: 'רמי לוי',
    victory: 'ויקטורי',
    ikea: 'איקאה',
    home_center: 'הום סנטר',
    office_depot: 'אופיס דיפו',
    pelephone: 'פלאפון',
    cellcom: 'סלקום',
    partner: 'פרטנר',
    medton: 'מדטון',
    big_electric: 'ביג אלקטריק',
    bug: 'באג',
    municipality: 'עירייה/מועצה',
    school: 'בית ספר',
    other: 'אחר'
};

// Hebrew explanations for location types
const tagExplanations = {
    store: 'נקודת איסוף שבה ניתן להשאיר סוללות משומשות למיחזור',
    facility: 'מתקן תעשייתי המעבד ומפרק סוללות לחומרי גלם'
};

// Chain-specific descriptions
const chainExplanations = {
    superpharm: 'רשת בתי מרקחת עם עמדות איסוף סוללות בסניפים',
    shufersal: 'רשת סופרמרקטים עם מכלי איסוף סוללות בכניסה',
    rami_levy: 'רשת מזון עם נקודות איסוף סוללות',
    victory: 'רשת מזון עם נקודות איסוף סוללות',
    ikea: 'חנות רהיטים עם עמדת מיחזור סוללות',
    home_center: 'רשת לבית ולגינה עם נקודות איסוף סוללות',
    office_depot: 'רשת ציוד משרדי עם נקודות איסוף סוללות',
    pelephone: 'רשת סלולר המקבלת סוללות ומכשירים ישנים',
    cellcom: 'רשת סלולר המקבלת סוללות ומכשירים ישנים',
    partner: 'רשת סלולר המקבלת סוללות ומכשירים ישנים',
    medton: 'חברת איסוף וטיפול בפסולת אלקטרונית',
    big_electric: 'רשת מוצרי חשמל עם נקודות איסוף סוללות',
    bug: 'רשת מוצרי חשמל עם נקודות איסוף סוללות',
    municipality: 'נקודת איסוף עירונית בניהול הרשות המקומית',
    school: 'נקודת איסוף סוללות בבית ספר',
    other: 'נקודת איסוף סוללות'
};

// Small battery icons for popups (20×20, no pin shape)
const popupBatterySvg = {
    store: `<svg viewBox="0 0 20 20" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
        <rect x="7" y="1" width="6" height="2.5" rx="1" fill="#00796B"/>
        <rect x="3" y="3.5" width="14" height="14" rx="2.5" fill="#26A69A"/>
        <rect x="5.5" y="6" width="9" height="2" rx="0.7" fill="#B2DFDB"/>
        <rect x="5.5" y="9.5" width="9" height="2" rx="0.7" fill="#B2DFDB"/>
        <rect x="5.5" y="13" width="9" height="2" rx="0.7" fill="#B2DFDB"/>
    </svg>`,
    facility: `<svg viewBox="0 0 20 20" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
        <rect x="7" y="1" width="6" height="2.5" rx="1" fill="#EF6C00"/>
        <rect x="3" y="3.5" width="14" height="14" rx="2.5" fill="#FFA726"/>
        <rect x="5.5" y="6" width="9" height="2" rx="0.7" fill="#FFF3E0"/>
        <rect x="5.5" y="9.5" width="9" height="2" rx="0.7" fill="#FFF3E0"/>
        <rect x="5.5" y="13" width="9" height="2" rx="0.7" fill="#FFF3E0"/>
    </svg>`
};

// Store all locations and markers
let allLocations = [];
let allMarkers = [];
let userMarker = null;
let userLocation = null;
let totalLocations = 0;

// Marker cluster group
const markerCluster = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 35,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        let size = 'small';
        if (count > 100) size = 'large';
        else if (count > 20) size = 'medium';

        // Hebrew plural: 1 מיקום, 2+ מיקומים
        const locationText = count === 1 ? 'מיקום' : 'מיקומים';
        const ariaLabel = `${count} ${locationText}`;

        return L.divIcon({
            html: `<div aria-label="${ariaLabel}"><span>${count}</span></div>`,
            className: `marker-cluster marker-cluster-${size}`,
            iconSize: L.point(40, 40)
        });
    }
});
map.addLayer(markerCluster);

// Pre-computed city counts for O(1) lookup in autocomplete
const cityCounts = new Map();

// Current state
let currentSearch = '';
let selectedLocationId = null;

// Chain detection from name — data-driven lookup
const CHAIN_PATTERNS = [
    { patterns: ['סופר פארם', 'סופר-פארם'], chain: 'superpharm' },
    { patterns: ['שופרסל'], chain: 'shufersal' },
    { patterns: ['רמי לוי'], chain: 'rami_levy' },
    { patterns: ['ויקטורי'], chain: 'victory' },
    { patterns: ['איקאה', 'ikea'], chain: 'ikea' },
    { patterns: ['הום סנטר'], chain: 'home_center' },
    { patterns: ['אופיס דיפו'], chain: 'office_depot' },
    { patterns: ['פלאפון'], chain: 'pelephone' },
    { patterns: ['סלקום'], chain: 'cellcom' },
    { patterns: ['פרטנר'], chain: 'partner' },
    { patterns: ['מדטון'], chain: 'medton' },
    { patterns: ['ביג אלקטריק'], chain: 'big_electric' },
    { patterns: ['באג'], chain: 'bug' },
    { patterns: ['עיריי', 'מועצה', 'רשות מקומית'], chain: 'municipality' },
    { patterns: ['בית ספר', 'ביה"ס'], chain: 'school' },
];

function detectChain(name) {
    const n = name.toLowerCase();
    for (const { patterns, chain } of CHAIN_PATTERNS) {
        if (patterns.some(p => n.includes(p))) return chain;
    }
    return 'other';
}

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

// Create popup content for a location
function createPopupContent(location) {
    const safeType = ['store', 'facility'].includes(location.type) ? location.type : 'store';
    const typeIcon = popupBatterySvg[safeType];

    const hasAddress = location.address && location.address !== 'Unknown' && location.address !== location.name;

    let content = `
        <div class="popup-header">
            <h3>
                <span class="popup-icon">${typeIcon}</span>
                ${escapeHtml(location.name)}
            </h3>
        </div>
        ${hasAddress ? `<div class="popup-row">
            <span>${escapeHtml(location.address)}</span>
        </div>` : ''}
    `;

    if (location.hours && location.hours !== 'בדוק באתר') {
        content += `
        <div class="popup-row">
            <span class="icon">🕐</span>
            <span>${escapeHtml(location.hours)}</span>
        </div>`;
    }

    if (location.description) {
        content += `
        <div class="popup-row">
            <span class="icon">ℹ️</span>
            <span>${escapeHtml(location.description)}</span>
        </div>`;
    }

    if (userLocation) {
        const distance = getDistance(
            userLocation.lat, userLocation.lng,
            location.lat, location.lng
        );
        content += `
        <div class="popup-row distance">
            <span class="icon">📏</span>
            <span>${distance.toFixed(1)} ק"מ ממיקומך</span>
        </div>`;
    }

    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`;
    const wazeUrl = `https://waze.com/ul?ll=${location.lat},${location.lng}&navigate=yes`;

    const reportUrl = getReportUrl(location);

    content += `
        <div class="nav-links">
            <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="nav-btn google">Google Maps</a>
            <a href="${wazeUrl}" target="_blank" rel="noopener noreferrer" class="nav-btn waze">Waze</a>
        </div>
        <a href="${reportUrl}" target="_blank" rel="noopener noreferrer" class="report-link">דווח על בעיה</a>
    `;

    return content;
}

// Create sidebar content for a location
function createSidebarContent(location) {
    const chain = detectChain(location.name);
    const chainName = chainNames[chain] || '';
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
                <span class="info-text distance">${distance.toFixed(1)} ק"מ ממיקומך</span>
            </div>
        `;
    }

    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`;
    const wazeUrl = `https://waze.com/ul?ll=${location.lat},${location.lng}&navigate=yes`;

    return `
        <div class="sidebar-header">
            <div class="sidebar-title">
                <h2>${escapeHtml(location.name)}</h2>
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

        <a href="${getReportUrl(location)}" target="_blank" rel="noopener noreferrer" class="report-link">
            ⚠️ דווח על בעיה בנקודה זו
        </a>
    `;
}

// Cached sidebar DOM references (set once after DOMContentLoaded)
const cachedSidebar = document.getElementById('sidebar');
const cachedSidebarContent = document.getElementById('sidebar-content');
const cachedSidebarClose = document.getElementById('sidebar-close');

// Show sidebar with location details
function showSidebar(location) {
    if (!cachedSidebar || !cachedSidebarContent) return;

    map.closePopup();
    selectedLocationId = location.id;
    cachedSidebarContent.innerHTML = createSidebarContent(location);
    cachedSidebar.style.display = 'flex';
    cachedSidebar.classList.remove('hidden');

    if (cachedSidebarClose) cachedSidebarClose.focus();
}

// Hide sidebar
function hideSidebar() {
    if (cachedSidebar) {
        cachedSidebar.classList.add('hidden');
        setTimeout(() => {
            cachedSidebar.style.display = 'none';
        }, 300);
    }
    selectedLocationId = null;
}

// Update which markers are visible based on search
function updateMarkers() {
    const visibleMarkers = [];

    allMarkers.forEach((item) => {
        const location = item.location;

        const searchMatch = currentSearch === '' ||
            location.city.includes(currentSearch) ||
            location.name.includes(currentSearch) ||
            location.address.includes(currentSearch) ||
            fuzzyMatch(location.city, currentSearch) ||
            fuzzyMatch(location.name, currentSearch) ||
            fuzzyMatch(location.address, currentSearch);

        if (searchMatch) {
            visibleMarkers.push(item.marker);
        }
    });

    markerCluster.clearLayers();
    markerCluster.addLayers(visibleMarkers);

    // Show/hide empty state
    const emptyState = document.getElementById('empty-state');
    if (emptyState) {
        if (visibleMarkers.length === 0 && currentSearch !== '') {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
        }
    }

    return visibleMarkers;
}

// Auto-zoom to visible markers
function zoomToVisibleMarkers(visibleMarkers) {
    if (visibleMarkers.length === 0) return;

    if (visibleMarkers.length === 1) {
        const marker = visibleMarkers[0];
        const latlng = marker.getLatLng();
        map.flyTo(latlng, 15, { duration: 0.8 });
        setTimeout(() => {
            markerCluster.zoomToShowLayer(marker, () => {
                marker.openPopup();
            });
        }, 900);
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

    let searchTimeout;
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();

        // Debounced marker update when suggestions aren't showing
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = query;
            if (!suggestions.classList.contains('active')) {
                updateMarkers();
            }
        }, 300);

        if (query.length < 2) {
            suggestions.classList.remove('active');
            suggestions.innerHTML = '';
            highlightedIndex = -1;
            currentSearch = query;
            updateMarkers();
            return;
        }

        const matches = [];
        const addedCities = new Set();

        allLocations.forEach(location => {
            if (location.name.includes(query) ||
                location.address.includes(query) ||
                fuzzyMatch(location.name, query) ||
                fuzzyMatch(location.address, query)) {
                matches.push({
                    type: 'location',
                    id: location.id,
                    name: location.name,
                    city: location.city,
                    locationType: location.type
                });
            }

            if ((location.city.includes(query) || fuzzyMatch(location.city, query)) && !addedCities.has(location.city)) {
                addedCities.add(location.city);
                matches.unshift({
                    type: 'city',
                    name: location.city,
                    count: cityCounts.get(location.city) || 0
                });
            }
        });

        const limitedMatches = matches.slice(0, 8);

        if (limitedMatches.length === 0) {
            suggestions.classList.remove('active');
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
                            <div class="suggestion-city">${match.count} נקודות</div>
                        </div>
                    </div>
                `;
            } else {
                const icon = '🟢';
                return `
                    <div class="suggestion-item"
                         role="option"
                         data-type="location"
                         data-id="${match.id}"
                         tabindex="-1">
                        <span class="suggestion-icon">${icon}</span>
                        <div class="suggestion-text">
                            <div class="suggestion-name">${escapeHtml(match.name)}</div>
                            <div class="suggestion-city">${escapeHtml(match.city)}</div>
                        </div>
                    </div>
                `;
            }
        }).join('');

        suggestions.classList.add('active');
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
        } else if (e.key === 'Enter' && highlightedIndex >= 0) {
            e.preventDefault();
            selectSuggestion(items[highlightedIndex]);
        } else if (e.key === 'Escape') {
            suggestions.classList.remove('active');
            highlightedIndex = -1;
        }
    });

    function updateHighlight(items) {
        items.forEach((item, index) => {
            item.classList.toggle('highlighted', index === highlightedIndex);
        });
    }

    function selectSuggestion(item) {
        const type = item.dataset.type;

        if (type === 'city') {
            const city = item.dataset.value;
            searchInput.value = city;
            currentSearch = city;
            const visibleMarkers = updateMarkers();
            zoomToVisibleMarkers(visibleMarkers);
        } else {
            const locationId = parseInt(item.dataset.id, 10);
            if (isNaN(locationId)) return;
            searchInput.value = '';
            focusOnLocation(locationId);
        }

        suggestions.classList.remove('active');
        suggestions.innerHTML = '';
        highlightedIndex = -1;
    }

    suggestions.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (item) selectSuggestion(item);
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestions.contains(e.target)) {
            suggestions.classList.remove('active');
        }
    });
}

// Focus on a location (show on map and sidebar)
function focusOnLocation(locationId) {
    const location = allLocations.find(l => l.id === locationId);
    if (!location) return;

    const markerItem = allMarkers.find(item => item.location.id === locationId);
    if (markerItem) {
        map.flyTo([location.lat, location.lng], 16, { duration: 0.8 });
        setTimeout(() => {
            markerCluster.zoomToShowLayer(markerItem.marker, () => {
                markerItem.marker.openPopup();
            });
        }, 900);
    }

    showSidebar(location);
}
window.focusOnLocation = focusOnLocation;

// === GPS GEOLOCATION ===
const locateIconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
    </svg>`;
const extentIconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>
        <path d="M12 8v8M8 12h8"/>
    </svg>`;

let gpsActive = false;

const locateControl = L.control({ position: 'bottomleft' });
locateControl.onAdd = function() {
    const btn = L.DomUtil.create('button', 'locate-btn');
    btn.innerHTML = locateIconSvg;
    btn.title = 'מצא את מיקומי';
    btn.setAttribute('aria-label', 'מצא את מיקומי');

    L.DomEvent.disableClickPropagation(btn);

    btn.onclick = function() {
        // Toggle: if GPS is active, zoom to full extent
        if (gpsActive) {
            gpsActive = false;
            btn.classList.remove('active');
            btn.innerHTML = locateIconSvg;
            btn.title = 'מצא את מיקומי';
            btn.setAttribute('aria-label', 'מצא את מיקומי');

            // Remove user marker
            if (userMarker) {
                map.removeLayer(userMarker);
                userMarker = null;
            }
            userLocation = null;

            map.flyTo([31.5, 34.9], 7, { duration: 0.8 });
            showNotification('תצוגה מלאה');
            return;
        }

        // Find my location
        if (!navigator.geolocation) {
            showNotification('הדפדפן לא תומך באיתור מיקום');
            return;
        }

        // Prevent concurrent geolocation requests
        if (btn.classList.contains('loading')) return;

        btn.classList.add('loading');
        showNotification('מאתר מיקום...');

        navigator.geolocation.getCurrentPosition(
            (position) => {
                btn.classList.remove('loading');
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;

                userLocation = { lat, lng };

                // Place/update user marker
                if (userMarker) {
                    userMarker.setLatLng([lat, lng]);
                } else {
                    userMarker = L.marker([lat, lng], { icon: icons.user })
                        .addTo(map)
                        .bindPopup('המיקום שלך');
                }

                map.flyTo([lat, lng], 14, { duration: 0.8 });
                showNotification('מיקום נמצא');

                // Switch to "full extent" mode
                gpsActive = true;
                btn.classList.add('active');
                btn.innerHTML = extentIconSvg;
                btn.title = 'הצג מפה מלאה';
                btn.setAttribute('aria-label', 'הצג מפה מלאה');
            },
            (error) => {
                btn.classList.remove('loading');
                let msg = 'שגיאה באיתור מיקום';
                if (error.code === 1) msg = 'גישה למיקום נדחתה';
                else if (error.code === 2) msg = 'מיקום לא זמין';
                else if (error.code === 3) msg = 'זמן איתור מיקום עבר';
                showNotification(msg);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    };

    return btn;
};
locateControl.addTo(map);

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
    showLoading('טוען נקודות מיחזור...');

    fetch('locations.json')
        .then(response => response.json())
        .then(data => {
            // Validate and filter location data
            allLocations = data.locations.filter(loc => {
                if (!loc.id || !loc.name || !loc.address || !loc.city || !loc.type) return false;
                if (!isFinite(loc.lat) || !isFinite(loc.lng)) return false;
                if (loc.lat < 29 || loc.lat > 34 || loc.lng < 34 || loc.lng > 36) return false;
                return true;
            });
            totalLocations = allLocations.length;

            // Pre-compute city counts for fast autocomplete
            cityCounts.clear();
            allLocations.forEach(loc => {
                cityCounts.set(loc.city, (cityCounts.get(loc.city) || 0) + 1);
            });

            const loadingText = document.getElementById('loading-text');
            if (loadingText) {
                loadingText.textContent = `טוען ${totalLocations} נקודות...`;
            }

            // Clear previous markers if retrying
            allMarkers = [];
            markerCluster.clearLayers();

            allLocations.forEach(location => {
                const icon = icons[location.type] || icons.store;
                const marker = L.marker([location.lat, location.lng], { icon: icon });

                // Lazy-load popup HTML on first open (desktop only)
                if (window.innerWidth > MOBILE_BREAKPOINT) {
                    marker.once('popupopen', () => {
                        marker.setPopupContent(createPopupContent(location));
                    });
                    marker.bindPopup('', { maxWidth: 300 });
                }

                marker.on('click', () => {
                    showSidebar(location);
                });

                // Add aria-label when marker is added to map
                marker.on('add', () => {
                    const element = marker.getElement();
                    if (element) {
                        const ariaLabel = `${escapeHtml(location.name)} - ${typeNames[location.type]}`;
                        element.setAttribute('aria-label', ariaLabel);
                    }
                });

                allMarkers.push({ marker, location });
            });

            setupAutocomplete();
            updateMarkers();

            // Hide error state if it was showing
            const emptyState = document.getElementById('empty-state');
            if (emptyState) emptyState.style.display = 'none';

            setTimeout(() => {
                hideLoading();
            }, 300);
        })
        .catch(error => {
            console.error('Error loading locations:', error);
            hideLoading();

            // Show empty state with retry option
            const emptyState = document.getElementById('empty-state');
            if (emptyState) {
                const h3 = emptyState.querySelector('h3');
                const p = emptyState.querySelector('p');
                if (h3) h3.textContent = 'שגיאה בטעינת הנתונים';
                if (p) p.textContent = 'בדוק את החיבור לאינטרנט ונסה שוב';
                const retryBtn = emptyState.querySelector('.clear-filters-btn');
                if (retryBtn) retryBtn.textContent = 'נסה שוב';
                emptyState.style.display = 'block';
            }
        });
}

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
        if (deltaY > threshold) {
            hideSidebar();
        } else {
            sidebarEl.style.transform = '';
        }
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
            // Clear search filters
            currentSearch = '';
            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = '';
            updateMarkers();
        }
    });
}

// Close sidebar and autocomplete on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideSidebar();

        const suggestions = document.getElementById('search-suggestions');
        if (suggestions) suggestions.classList.remove('active');
    }
});

