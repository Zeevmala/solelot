// ============================================
// Battery Recycling Map - Israel
// ============================================

// === NOTIFICATION SYSTEM ===
function showNotification(message, duration = 2000) {
    const notification = document.getElementById('notification');
    if (!notification) return;

    notification.textContent = message;
    notification.style.display = 'block';
    notification.classList.add('show');

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.style.display = 'none';
        }, 300);
    }, duration);
}

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
        <input type="text" id="search-input" class="map-search-input" placeholder="חיפוש נקודה..." autocomplete="off">
        <div id="search-suggestions" class="search-suggestions" role="listbox"></div>
    `;

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const input = container.querySelector('#search-input');
    L.DomEvent.on(input, 'keydown keyup keypress', L.DomEvent.stopPropagation);

    return container;
};
searchControl.addTo(map);

// Custom SVG Battery Icons - Simplified pin style
const batterySvg = {
    store: `<svg viewBox="0 0 32 44" width="32" height="44">
        <defs>
            <linearGradient id="storeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#4CAF50"/>
                <stop offset="100%" style="stop-color:#2E7D32"/>
            </linearGradient>
            <filter id="storeShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
            </filter>
        </defs>
        <path d="M16 0C8 0 2 6 2 14C2 24 16 44 16 44S30 24 30 14C30 6 24 0 16 0Z" fill="url(#storeGrad)" filter="url(#storeShadow)"/>
        <circle cx="16" cy="14" r="8" fill="white" opacity="0.95"/>
        <rect x="13" y="9" width="6" height="2" rx="1" fill="#2E7D32"/>
        <rect x="11" y="11" width="10" height="8" rx="1" fill="#4CAF50"/>
        <rect x="12" y="12" width="8" height="2" rx="0.5" fill="#81C784"/>
        <rect x="12" y="15" width="8" height="2" rx="0.5" fill="#A5D6A7"/>
    </svg>`,
    facility: `<svg viewBox="0 0 32 44" width="32" height="44">
        <defs>
            <linearGradient id="facilityGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#EF5350"/>
                <stop offset="100%" style="stop-color:#C62828"/>
            </linearGradient>
            <filter id="facilityShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
            </filter>
        </defs>
        <path d="M16 0C8 0 2 6 2 14C2 24 16 44 16 44S30 24 30 14C30 6 24 0 16 0Z" fill="url(#facilityGrad)" filter="url(#facilityShadow)"/>
        <circle cx="16" cy="14" r="8" fill="white" opacity="0.95"/>
        <path d="M16 7L18 12H16.5L17 20L13 12H14.5L14 7Z" fill="#C62828" transform="translate(0, 1)"/>
    </svg>`,
    user: `<svg viewBox="0 0 32 44" width="32" height="44">
        <defs>
            <linearGradient id="userGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#42A5F5"/>
                <stop offset="100%" style="stop-color:#1565C0"/>
            </linearGradient>
            <filter id="userShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
            </filter>
        </defs>
        <circle cx="16" cy="14" r="12" fill="url(#userGrad)" filter="url(#userShadow)" stroke="white" stroke-width="3"/>
        <circle cx="16" cy="14" r="5" fill="white"/>
        <circle cx="16" cy="14" r="2" fill="#1565C0"/>
    </svg>`
};

function createBatteryIcon(type) {
    return L.divIcon({
        html: batterySvg[type],
        className: 'battery-marker',
        iconSize: [32, 44],
        iconAnchor: [16, 44],
        popupAnchor: [0, -44]
    });
}

const icons = {
    store: createBatteryIcon('store'),
    facility: createBatteryIcon('facility'),
    user: createBatteryIcon('user')
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

        return L.divIcon({
            html: `<div><span>${count}</span></div>`,
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

// Chain detection from name
function detectChain(name) {
    const n = name.toLowerCase();
    if (n.includes('סופר פארם') || n.includes('סופר-פארם')) return 'superpharm';
    if (n.includes('שופרסל')) return 'shufersal';
    if (n.includes('רמי לוי')) return 'rami_levy';
    if (n.includes('ויקטורי')) return 'victory';
    if (n.includes('איקאה') || n.includes('ikea')) return 'ikea';
    if (n.includes('הום סנטר')) return 'home_center';
    if (n.includes('אופיס דיפו')) return 'office_depot';
    if (n.includes('פלאפון')) return 'pelephone';
    if (n.includes('סלקום')) return 'cellcom';
    if (n.includes('פרטנר')) return 'partner';
    if (n.includes('מדטון')) return 'medton';
    if (n.includes('ביג אלקטריק')) return 'big_electric';
    if (n.includes('באג')) return 'bug';
    if (n.includes('עיריי') || n.includes('מועצה') || n.includes('רשות מקומית')) return 'municipality';
    if (n.includes('בית ספר') || n.includes('ביה"ס')) return 'school';
    return 'other';
}

// Calculate distance between two points (in km)
function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Create popup content for a location
function createPopupContent(location) {
    const svgType = location.type === 'facility' ? 'facility' : 'store';
    const typeIcon = batterySvg[svgType].replace('width="32" height="44"', 'width="20" height="28"');

    let content = `
        <div class="popup-header">
            <h3>
                <span class="popup-icon">${typeIcon}</span>
                ${escapeHtml(location.name)}
            </h3>
        </div>
        <div class="popup-row">
            <span class="icon">📍</span>
            <span>${escapeHtml(location.address)}</span>
        </div>
        <div class="popup-row">
            <span class="icon">🕐</span>
            <span>${escapeHtml(location.hours || 'לא צוין')}</span>
        </div>
    `;

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

    content += `
        <div class="nav-links">
            <a href="${googleMapsUrl}" target="_blank" class="nav-btn google">🗺️ Google</a>
            <a href="${wazeUrl}" target="_blank" class="nav-btn waze">🚗 Waze</a>
        </div>
    `;

    return content;
}

// Create sidebar content for a location
function createSidebarContent(location) {
    const svgType = location.type === 'facility' ? 'facility' : 'store';
    const typeIcon = batterySvg[svgType].replace('width="32" height="44"', 'width="36" height="50"');
    const chain = detectChain(location.name);
    const chainName = chainNames[chain] || '';

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
            <div class="sidebar-icon">${typeIcon}</div>
            <div class="sidebar-title">
                <h2>${escapeHtml(location.name)}</h2>
                <span class="type-badge">${escapeHtml(typeNames[location.type])}${chainName ? ' - ' + escapeHtml(chainName) : ''}</span>
            </div>
        </div>

        <div class="sidebar-info">
            <div class="info-row">
                <span class="info-icon">📍</span>
                <span class="info-text">${escapeHtml(location.address)}</span>
            </div>
            <div class="info-row">
                <span class="info-icon">🏙️</span>
                <span class="info-text">${escapeHtml(location.city)}</span>
            </div>
            <div class="info-row">
                <span class="info-icon">🕐</span>
                <span class="info-text">${escapeHtml(location.hours || 'לא צוין')}</span>
            </div>
            ${location.description ? `
            <div class="info-row">
                <span class="info-icon">ℹ️</span>
                <span class="info-text">${escapeHtml(location.description)}</span>
            </div>
            ` : ''}
            ${distanceHtml}
        </div>

        <div class="sidebar-nav">
            <a href="${googleMapsUrl}" target="_blank" class="sidebar-nav-btn google">
                🗺️ נווט ב-Google
            </a>
            <a href="${wazeUrl}" target="_blank" class="sidebar-nav-btn waze">
                🚗 נווט ב-Waze
            </a>
        </div>
    `;
}

// Show sidebar with location details
function showSidebar(location) {
    const sidebar = document.getElementById('sidebar');
    const sidebarContent = document.getElementById('sidebar-content');

    if (!sidebar || !sidebarContent) return;

    selectedLocationId = location.id;
    sidebarContent.innerHTML = createSidebarContent(location);
    sidebar.style.display = 'flex';
    sidebar.classList.remove('hidden');

    const closeBtn = document.getElementById('sidebar-close');
    if (closeBtn) closeBtn.focus();
}

// Hide sidebar
function hideSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.add('hidden');
        setTimeout(() => {
            sidebar.style.display = 'none';
        }, 300);
    }
    selectedLocationId = null;
}

// Update which markers are visible based on search
function updateMarkers() {
    const visibleMarkers = [];

    allMarkers.forEach((item, index) => {
        const location = allLocations[index];

        const searchMatch = currentSearch === '' ||
            location.city.includes(currentSearch) ||
            location.name.includes(currentSearch) ||
            location.address.includes(currentSearch);

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
function setupAutocomplete() {
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
                location.address.includes(query)) {
                matches.push({
                    type: 'location',
                    id: location.id,
                    name: location.name,
                    city: location.city,
                    locationType: location.type
                });
            }

            if (location.city.includes(query) && !addedCities.has(location.city)) {
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
                const icon = match.locationType === 'store' ? '🟢' : '🔴';
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
            const locationId = parseInt(item.dataset.id);
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
const locateControl = L.control({ position: 'bottomleft' });
locateControl.onAdd = function() {
    const btn = L.DomUtil.create('button', 'locate-btn');
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
    </svg>`;
    btn.title = 'מצא את מיקומי';
    btn.setAttribute('aria-label', 'מצא את מיקומי');

    L.DomEvent.disableClickPropagation(btn);

    btn.onclick = function() {
        if (!navigator.geolocation) {
            showNotification('הדפדפן לא תומך באיתור מיקום');
            return;
        }

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
            allLocations = data.locations;
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

                marker.bindPopup(createPopupContent(location));

                marker.on('click', () => {
                    showSidebar(location);
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
                emptyState.querySelector('h3').textContent = 'שגיאה בטעינת הנתונים';
                emptyState.querySelector('p').textContent = 'בדוק את החיבור לאינטרנט ונסה שוב';
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

