// ============================================
// Battery Recycling Map - Israel
// Enhanced with favorites, filters, list view,
// dark mode, autocomplete, and PWA support
// ============================================

// === THEME MANAGEMENT ===
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    // Update map tiles for dark mode
    updateMapTiles();
}

// Initialize theme immediately
initTheme();

// === FAVORITES MANAGEMENT ===
const favoritesKey = 'battery-recycling-favorites';

function getFavorites() {
    const saved = localStorage.getItem(favoritesKey);
    return saved ? JSON.parse(saved) : [];
}

function saveFavorites(favorites) {
    localStorage.setItem(favoritesKey, JSON.stringify(favorites));
}

function isFavorite(locationId) {
    return getFavorites().includes(locationId);
}

function toggleFavorite(locationId) {
    const favorites = getFavorites();
    const index = favorites.indexOf(locationId);

    if (index > -1) {
        favorites.splice(index, 1);
        showNotification('הוסר מהמועדפים');
    } else {
        favorites.push(locationId);
        showNotification('נוסף למועדפים');
    }

    saveFavorites(favorites);

    // Update UI
    updateFavoriteButtons(locationId);

    // Update markers if favorites filter is active
    if (showFavoritesOnly) {
        updateMarkers();
    }

    return !index > -1;
}

function updateFavoriteButtons(locationId) {
    const isFav = isFavorite(locationId);

    // Update all favorite buttons for this location
    document.querySelectorAll(`[data-favorite-id="${locationId}"]`).forEach(btn => {
        btn.classList.toggle('active', isFav);
        btn.textContent = isFav ? '❤️' : '🤍';
        btn.setAttribute('aria-pressed', isFav);
    });
}

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

// === MAP INITIALIZATION ===
const map = L.map('map').setView([31.5, 34.9], 8);

// Define multiple basemap options
const baseMaps = {
    'רחובות': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }),
    'בהיר': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB'
    }),
    'לוויין': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri'
    })
};

// Dark mode basemap
const darkBasemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB'
});

// Track current basemap
let currentBasemap = baseMaps['רחובות'];
currentBasemap.addTo(map);

// Add layer control
L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

// Update map tiles based on theme
function updateMapTiles() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    // Dark mode is handled via CSS filter for simplicity
}

// Custom SVG Battery Icons
const batterySvg = {
    store: `<svg viewBox="0 0 24 36" width="28" height="42">
        <defs>
            <linearGradient id="storeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#4caf50"/>
                <stop offset="100%" style="stop-color:#2e7d32"/>
            </linearGradient>
        </defs>
        <rect x="7" y="0" width="10" height="4" rx="1" fill="#388e3c"/>
        <rect x="3" y="4" width="18" height="30" rx="3" fill="url(#storeGrad)" stroke="#1b5e20" stroke-width="1"/>
        <rect x="6" y="8" width="12" height="6" rx="1" fill="#81c784" opacity="0.6"/>
        <rect x="6" y="16" width="12" height="6" rx="1" fill="#81c784" opacity="0.4"/>
        <rect x="6" y="24" width="12" height="6" rx="1" fill="#81c784" opacity="0.2"/>
    </svg>`,
    facility: `<svg viewBox="0 0 24 36" width="28" height="42">
        <defs>
            <linearGradient id="facilityGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#ef5350"/>
                <stop offset="100%" style="stop-color:#c62828"/>
            </linearGradient>
        </defs>
        <rect x="7" y="0" width="10" height="4" rx="1" fill="#d32f2f"/>
        <rect x="3" y="4" width="18" height="30" rx="3" fill="url(#facilityGrad)" stroke="#b71c1c" stroke-width="1"/>
        <path d="M12 10 L15 18 H13 L14 28 L9 18 H11 L10 10 Z" fill="#ffcdd2" opacity="0.9"/>
    </svg>`,
    user: `<svg viewBox="0 0 24 36" width="28" height="42">
        <defs>
            <linearGradient id="userGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#42a5f5"/>
                <stop offset="100%" style="stop-color:#1565c0"/>
            </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="10" fill="url(#userGrad)" stroke="#0d47a1" stroke-width="1"/>
        <circle cx="12" cy="12" r="4" fill="white"/>
        <path d="M12 22 L12 34" stroke="#1565c0" stroke-width="3" stroke-linecap="round"/>
    </svg>`
};

// Create L.divIcon for custom markers
function createBatteryIcon(type) {
    return L.divIcon({
        html: batterySvg[type],
        className: 'battery-marker',
        iconSize: [28, 42],
        iconAnchor: [14, 42],
        popupAnchor: [0, -42]
    });
}

const icons = {
    store: createBatteryIcon('store'),
    facility: createBatteryIcon('facility'),
    user: createBatteryIcon('user')
};

// Add enhanced legend with cluster info
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function() {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
        <h4>
            מקרא
            <button class="legend-toggle" onclick="toggleLegend()" aria-label="הרחב/כווץ מקרא">▼</button>
        </h4>
        <div class="legend-content">
            <div class="legend-section">
                <div class="legend-section-title">סוגי נקודות</div>
                <div class="legend-item">
                    <div class="legend-icon">${batterySvg.store.replace('width="28" height="42"', 'width="20" height="30"')}</div>
                    <span>נקודת איסוף</span>
                </div>
                <div class="legend-item">
                    <div class="legend-icon">${batterySvg.facility.replace('width="28" height="42"', 'width="20" height="30"')}</div>
                    <span>מתקן מיחזור</span>
                </div>
                <div class="legend-item">
                    <div class="legend-icon">${batterySvg.user.replace('width="28" height="42"', 'width="20" height="30"')}</div>
                    <span>המיקום שלך</span>
                </div>
            </div>
            <div class="legend-section">
                <div class="legend-section-title">צבעי קבוצות</div>
                <div class="legend-item">
                    <span class="cluster-indicator cluster-small"></span>
                    <span>עד 20 נקודות</span>
                </div>
                <div class="legend-item">
                    <span class="cluster-indicator cluster-medium"></span>
                    <span>20-100 נקודות</span>
                </div>
                <div class="legend-item">
                    <span class="cluster-indicator cluster-large"></span>
                    <span>מעל 100 נקודות</span>
                </div>
            </div>
        </div>
    `;
    return div;
};
legend.addTo(map);

// Toggle legend on mobile
window.toggleLegend = function() {
    const content = document.querySelector('.legend-content');
    const btn = document.querySelector('.legend-toggle');
    if (content) {
        content.classList.toggle('collapsed');
        btn.textContent = content.classList.contains('collapsed') ? '▲' : '▼';
    }
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
let radiusCircle = null;

// Marker cluster group
const markerCluster = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 50,
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

// Current filter state
let currentFilter = 'all';
let currentSearch = '';
let currentCity = 'all';
let currentChain = 'all';
let currentRadius = 50;
let showFavoritesOnly = false;
let currentView = 'map';
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
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Create enhanced popup content for a location
function createPopupContent(location) {
    const typeIcon = location.type === 'store'
        ? batterySvg.store.replace('width="28" height="42"', 'width="18" height="27"')
        : batterySvg.facility.replace('width="28" height="42"', 'width="18" height="27"');

    const isFav = isFavorite(location.id);
    const favClass = isFav ? 'active' : '';
    const favIcon = isFav ? '❤️' : '🤍';

    let content = `
        <div class="popup-header">
            <h3>
                <span class="popup-icon">${typeIcon}</span>
                ${location.name}
            </h3>
            <button class="popup-favorite-btn ${favClass}"
                    data-favorite-id="${location.id}"
                    onclick="toggleFavorite(${location.id})"
                    aria-label="${isFav ? 'הסר מהמועדפים' : 'הוסף למועדפים'}"
                    aria-pressed="${isFav}">
                ${favIcon}
            </button>
        </div>
        <div class="popup-row">
            <span class="icon">📍</span>
            <span>${location.address}</span>
        </div>
        <div class="popup-row">
            <span class="icon">🕐</span>
            <span>${location.hours}</span>
        </div>
    `;

    if (location.description) {
        content += `
        <div class="popup-row">
            <span class="icon">ℹ️</span>
            <span>${location.description}</span>
        </div>`;
    }

    // Add distance if user location is known
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

    // Add navigation links
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
    const typeIcon = location.type === 'store'
        ? batterySvg.store.replace('width="28" height="42"', 'width="32" height="48"')
        : batterySvg.facility.replace('width="28" height="42"', 'width="32" height="48"');

    const isFav = isFavorite(location.id);
    const favClass = isFav ? 'active' : '';
    const favIcon = isFav ? '❤️' : '🤍';
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
                <h2>${location.name}</h2>
                <span class="type-badge">${typeNames[location.type]}${chainName ? ' - ' + chainName : ''}</span>
            </div>
            <button class="sidebar-favorite-btn ${favClass}"
                    data-favorite-id="${location.id}"
                    onclick="toggleFavorite(${location.id})"
                    aria-label="${isFav ? 'הסר מהמועדפים' : 'הוסף למועדפים'}"
                    aria-pressed="${isFav}">
                ${favIcon}
            </button>
        </div>

        <div class="sidebar-info">
            <div class="info-row">
                <span class="info-icon">📍</span>
                <span class="info-text">${location.address}</span>
            </div>
            <div class="info-row">
                <span class="info-icon">🏙️</span>
                <span class="info-text">${location.city}</span>
            </div>
            <div class="info-row">
                <span class="info-icon">🕐</span>
                <span class="info-text">${location.hours}</span>
            </div>
            ${location.description ? `
            <div class="info-row">
                <span class="info-icon">ℹ️</span>
                <span class="info-text">${location.description}</span>
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

    // Focus management for accessibility
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

// Show/hide empty state
function showEmptyState(show) {
    const emptyState = document.getElementById('empty-state');
    if (emptyState) {
        emptyState.style.display = show ? 'block' : 'none';
    }
}

// Update which markers are visible based on filters
function updateMarkers() {
    let visibleCount = 0;
    const visibleMarkers = [];
    const visibleLocations = [];

    allMarkers.forEach((item, index) => {
        const location = allLocations[index];
        const chain = detectChain(location.name);

        // Check filter match
        const filterMatch = currentFilter === 'all' || location.type === currentFilter;

        // Check city match
        const cityMatch = currentCity === 'all' || location.city === currentCity;

        // Check chain match
        const chainMatch = currentChain === 'all' || chain === currentChain;

        // Check search match (search in city name, location name, address)
        const searchMatch = currentSearch === '' ||
            location.city.includes(currentSearch) ||
            location.name.includes(currentSearch) ||
            location.address.includes(currentSearch);

        // Check favorites filter
        const favoritesMatch = !showFavoritesOnly || isFavorite(location.id);

        // Check radius filter (only if user location is known)
        let radiusMatch = true;
        if (userLocation && currentRadius < 50) {
            const distance = getDistance(
                userLocation.lat, userLocation.lng,
                location.lat, location.lng
            );
            radiusMatch = distance <= currentRadius;
        }

        // Collect visible markers
        if (filterMatch && cityMatch && chainMatch && searchMatch && favoritesMatch && radiusMatch) {
            visibleMarkers.push(item.marker);
            visibleLocations.push(location);
            visibleCount++;
        }
    });

    // Update cluster with visible markers
    markerCluster.clearLayers();
    markerCluster.addLayers(visibleMarkers);

    // Show/hide empty state
    showEmptyState(visibleCount === 0 && allLocations.length > 0);

    // Update count display with "X of Y" format
    const countEl = document.getElementById('location-count');
    if (countEl) {
        if (visibleCount === totalLocations) {
            countEl.textContent = `${visibleCount} נקודות`;
        } else {
            countEl.textContent = `${visibleCount} מתוך ${totalLocations}`;
        }
    }

    // Update list view if active
    if (currentView === 'list') {
        updateListView(visibleLocations);
    }

    return visibleMarkers;
}

// Update radius circle on map
function updateRadiusCircle() {
    // Remove existing circle
    if (radiusCircle) {
        map.removeLayer(radiusCircle);
        radiusCircle = null;
    }

    const radiusInfo = document.getElementById('radius-info');

    // Only show if user location exists and radius is limited
    if (userLocation && currentRadius < 50) {
        radiusCircle = L.circle([userLocation.lat, userLocation.lng], {
            radius: currentRadius * 1000, // Convert km to meters
            color: '#1976d2',
            fillColor: '#1976d2',
            fillOpacity: 0.1,
            weight: 2
        }).addTo(map);

        if (radiusInfo) {
            radiusInfo.textContent = `מציג נקודות בטווח ${currentRadius} ק"מ מהמיקום שלך`;
            radiusInfo.style.display = 'block';
        }
    } else {
        if (radiusInfo) {
            radiusInfo.style.display = 'none';
        }
    }
}

// Auto-zoom to visible markers when city changes
function zoomToVisibleMarkers(visibleMarkers) {
    if (visibleMarkers.length === 0) return;

    if (visibleMarkers.length === 1) {
        // Single result: zoom in and open popup
        const marker = visibleMarkers[0];
        const latlng = marker.getLatLng();
        map.flyTo(latlng, 15, { duration: 0.8 });
        setTimeout(() => {
            markerCluster.zoomToShowLayer(marker, () => {
                marker.openPopup();
            });
        }, 900);
    } else {
        // Multiple results: fit bounds
        const group = L.featureGroup(visibleMarkers);
        map.flyToBounds(group.getBounds(), {
            padding: [50, 50],
            duration: 0.8,
            maxZoom: 14
        });
    }
}

// Populate city dropdown with top cities
function populateCityDropdown() {
    const citySelect = document.getElementById('city-filter');
    if (!citySelect) return;

    // Count locations per city
    const cityCounts = {};
    allLocations.forEach(loc => {
        cityCounts[loc.city] = (cityCounts[loc.city] || 0) + 1;
    });

    // Sort by count and get top 20
    const topCities = Object.entries(cityCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);

    // Add options
    topCities.forEach(([city, count]) => {
        const option = document.createElement('option');
        option.value = city;
        option.textContent = `${city} (${count})`;
        citySelect.appendChild(option);
    });
}

// Clear all filters
function clearFilters() {
    currentFilter = 'all';
    currentCity = 'all';
    currentChain = 'all';
    currentSearch = '';
    currentRadius = 50;
    showFavoritesOnly = false;

    // Reset UI
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
    });
    const allFilterBtn = document.querySelector('.filter-btn[data-filter="all"]');
    if (allFilterBtn) {
        allFilterBtn.classList.add('active');
        allFilterBtn.setAttribute('aria-pressed', 'true');
    }

    const citySelect = document.getElementById('city-filter');
    if (citySelect) citySelect.value = 'all';

    const chainSelect = document.getElementById('chain-filter');
    if (chainSelect) chainSelect.value = 'all';

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';

    const radiusSlider = document.getElementById('radius-slider');
    const radiusValue = document.getElementById('radius-value');
    if (radiusSlider) radiusSlider.value = 50;
    if (radiusValue) radiusValue.textContent = 'ללא הגבלה';

    const favoritesBtn = document.getElementById('favorites-filter');
    if (favoritesBtn) {
        favoritesBtn.classList.remove('active');
        favoritesBtn.setAttribute('aria-pressed', 'false');
    }

    updateRadiusCircle();
    updateMarkers();

    // Reset map view
    map.flyTo([31.5, 34.9], 8, { duration: 0.8 });
}

// === LIST VIEW ===
function updateListView(locations) {
    const container = document.getElementById('list-container');
    if (!container) return;

    // Sort locations based on current sort
    const sortSelect = document.getElementById('sort-select');
    const sortBy = sortSelect ? sortSelect.value : 'name';

    const sortedLocations = [...locations].sort((a, b) => {
        if (sortBy === 'name') {
            return a.name.localeCompare(b.name, 'he');
        } else if (sortBy === 'distance' && userLocation) {
            const distA = getDistance(userLocation.lat, userLocation.lng, a.lat, a.lng);
            const distB = getDistance(userLocation.lat, userLocation.lng, b.lat, b.lng);
            return distA - distB;
        } else if (sortBy === 'type') {
            return a.type.localeCompare(b.type);
        }
        return 0;
    });

    container.innerHTML = sortedLocations.map(location => {
        const typeIcon = location.type === 'store'
            ? batterySvg.store.replace('width="28" height="42"', 'width="24" height="36"')
            : batterySvg.facility.replace('width="28" height="42"', 'width="24" height="36"');

        const isFav = isFavorite(location.id);
        const favIcon = isFav ? '❤️' : '🤍';

        let distanceHtml = '';
        if (userLocation) {
            const distance = getDistance(
                userLocation.lat, userLocation.lng,
                location.lat, location.lng
            );
            distanceHtml = `<span class="card-distance">📏 ${distance.toFixed(1)} ק"מ</span>`;
        }

        return `
            <div class="location-card"
                 role="listitem"
                 tabindex="0"
                 data-location-id="${location.id}"
                 onclick="focusOnLocation(${location.id})"
                 onkeypress="if(event.key==='Enter')focusOnLocation(${location.id})">
                <div class="card-icon">${typeIcon}</div>
                <div class="card-content">
                    <div class="card-header">
                        <span class="card-name">${location.name}</span>
                        <button class="card-favorite-btn ${isFav ? 'active' : ''}"
                                data-favorite-id="${location.id}"
                                onclick="event.stopPropagation(); toggleFavorite(${location.id})"
                                aria-label="${isFav ? 'הסר מהמועדפים' : 'הוסף למועדפים'}"
                                aria-pressed="${isFav}">
                            ${favIcon}
                        </button>
                    </div>
                    <div class="card-address">${location.address}</div>
                    <div class="card-meta">
                        <span class="card-type">${typeNames[location.type]}</span>
                        ${distanceHtml}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Focus on a location (show on map and sidebar)
window.focusOnLocation = function(locationId) {
    const location = allLocations.find(l => l.id === locationId);
    if (!location) return;

    // Switch to map view
    switchView('map');

    // Find the marker
    const markerItem = allMarkers.find(item => item.location.id === locationId);
    if (markerItem) {
        // Zoom to location
        map.flyTo([location.lat, location.lng], 16, { duration: 0.8 });

        // Open popup after animation
        setTimeout(() => {
            markerCluster.zoomToShowLayer(markerItem.marker, () => {
                markerItem.marker.openPopup();
            });
        }, 900);
    }

    // Show sidebar
    showSidebar(location);
};

// Switch between map and list view
function switchView(view) {
    currentView = view;

    const mapEl = document.getElementById('map');
    const listView = document.getElementById('list-view');
    const mapBtn = document.getElementById('map-view-btn');
    const listBtn = document.getElementById('list-view-btn');

    if (view === 'map') {
        mapEl.style.display = 'block';
        listView.style.display = 'none';
        mapBtn.classList.add('active');
        mapBtn.setAttribute('aria-selected', 'true');
        listBtn.classList.remove('active');
        listBtn.setAttribute('aria-selected', 'false');

        // Invalidate map size after showing
        setTimeout(() => map.invalidateSize(), 100);
    } else {
        mapEl.style.display = 'none';
        listView.style.display = 'flex';
        listBtn.classList.add('active');
        listBtn.setAttribute('aria-selected', 'true');
        mapBtn.classList.remove('active');
        mapBtn.setAttribute('aria-selected', 'false');

        // Update list content
        updateMarkers();
    }
}

// === AUTOCOMPLETE SEARCH ===
function setupAutocomplete() {
    const searchInput = document.getElementById('search-input');
    const suggestions = document.getElementById('search-suggestions');
    if (!searchInput || !suggestions) return;

    let highlightedIndex = -1;

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();

        if (query.length < 2) {
            suggestions.classList.remove('active');
            suggestions.innerHTML = '';
            highlightedIndex = -1;
            return;
        }

        // Find matching locations and cities
        const matches = [];
        const addedCities = new Set();

        // Search locations
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

            // Add unique cities
            if (location.city.includes(query) && !addedCities.has(location.city)) {
                addedCities.add(location.city);
                matches.unshift({
                    type: 'city',
                    name: location.city,
                    count: allLocations.filter(l => l.city === location.city).length
                });
            }
        });

        // Limit results
        const limitedMatches = matches.slice(0, 8);

        if (limitedMatches.length === 0) {
            suggestions.classList.remove('active');
            suggestions.innerHTML = '';
            return;
        }

        suggestions.innerHTML = limitedMatches.map((match, index) => {
            if (match.type === 'city') {
                return `
                    <div class="suggestion-item"
                         role="option"
                         data-type="city"
                         data-value="${match.name}"
                         tabindex="-1">
                        <span class="suggestion-icon">🏙️</span>
                        <div class="suggestion-text">
                            <div class="suggestion-name">${match.name}</div>
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
                            <div class="suggestion-name">${match.name}</div>
                            <div class="suggestion-city">${match.city}</div>
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
            currentCity = city;
            currentSearch = '';

            const citySelect = document.getElementById('city-filter');
            if (citySelect) citySelect.value = city;

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

    // Click on suggestion
    suggestions.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (item) selectSuggestion(item);
    });

    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestions.contains(e.target)) {
            suggestions.classList.remove('active');
        }
    });
}

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

// === PWA INSTALL PROMPT ===
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    const installBtn = document.getElementById('install-btn');
    if (installBtn) {
        installBtn.style.display = 'flex';
    }
});

function setupInstallButton() {
    const installBtn = document.getElementById('install-btn');
    if (!installBtn) return;

    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            showNotification('האפליקציה הותקנה בהצלחה!');
        }

        deferredPrompt = null;
        installBtn.style.display = 'none';
    });
}

// === INITIALIZATION ===
showLoading('טוען נקודות מיחזור...');

fetch('locations.json')
    .then(response => response.json())
    .then(data => {
        allLocations = data.locations;
        totalLocations = allLocations.length;

        // Update loading text
        const loadingText = document.getElementById('loading-text');
        if (loadingText) {
            loadingText.textContent = `טוען ${totalLocations} נקודות...`;
        }

        // Create markers for all locations
        allLocations.forEach(location => {
            const icon = icons[location.type] || icons.store;
            const marker = L.marker([location.lat, location.lng], { icon: icon });

            marker.bindPopup(createPopupContent(location));

            // Show sidebar on marker click
            marker.on('click', () => {
                showSidebar(location);
            });

            allMarkers.push({ marker, location });
        });

        // Populate city dropdown
        populateCityDropdown();

        // Setup autocomplete
        setupAutocomplete();

        // Update initial count
        updateMarkers();

        // Hide loading after a short delay
        setTimeout(() => {
            hideLoading();
        }, 300);

        console.log('Loaded', allLocations.length, 'locations');
    })
    .catch(error => {
        console.error('Error loading locations:', error);
        hideLoading();

        const loadingText = document.getElementById('loading-text');
        if (loadingText) {
            loadingText.textContent = 'שגיאה בטעינת הנתונים';
        }
    });

// === EVENT LISTENERS ===

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
}

// Clear Filters Button
const clearFiltersBtn = document.getElementById('clear-filters');
if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', clearFilters);
}

// City Filter Dropdown
const citySelect = document.getElementById('city-filter');
if (citySelect) {
    citySelect.addEventListener('change', () => {
        currentCity = citySelect.value;
        const visibleMarkers = updateMarkers();

        // Auto-zoom when city changes (but not for "all")
        if (currentCity !== 'all') {
            zoomToVisibleMarkers(visibleMarkers);
        }
    });
}

// Chain Filter Dropdown
const chainSelect = document.getElementById('chain-filter');
if (chainSelect) {
    chainSelect.addEventListener('change', () => {
        currentChain = chainSelect.value;
        updateMarkers();
    });
}

// Filter Buttons
const filterButtons = document.querySelectorAll('.filter-btn');
filterButtons.forEach(button => {
    button.addEventListener('click', () => {
        // Update active button style
        filterButtons.forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
        });
        button.classList.add('active');
        button.setAttribute('aria-pressed', 'true');

        // Update filter and refresh markers
        currentFilter = button.dataset.filter;
        updateMarkers();
    });
});

// Favorites Filter
const favoritesFilterBtn = document.getElementById('favorites-filter');
if (favoritesFilterBtn) {
    favoritesFilterBtn.addEventListener('click', () => {
        showFavoritesOnly = !showFavoritesOnly;
        favoritesFilterBtn.classList.toggle('active', showFavoritesOnly);
        favoritesFilterBtn.setAttribute('aria-pressed', showFavoritesOnly);
        updateMarkers();
    });
}

// Search Box (basic filtering, autocomplete handles the rest)
const searchInput = document.getElementById('search-input');
if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = searchInput.value.trim();
            // Only update if no autocomplete is showing
            const suggestions = document.getElementById('search-suggestions');
            if (!suggestions || !suggestions.classList.contains('active')) {
                updateMarkers();
            }
        }, 300);
    });
}

// Radius Slider
const radiusSlider = document.getElementById('radius-slider');
const radiusValue = document.getElementById('radius-value');
if (radiusSlider && radiusValue) {
    radiusSlider.addEventListener('input', () => {
        const value = parseInt(radiusSlider.value);
        currentRadius = value;

        if (value >= 50) {
            radiusValue.textContent = 'ללא הגבלה';
        } else {
            radiusValue.textContent = `${value} ק"מ`;
        }

        radiusSlider.setAttribute('aria-valuenow', value);
        updateRadiusCircle();
        updateMarkers();
    });
}

// View Toggle
const mapViewBtn = document.getElementById('map-view-btn');
const listViewBtn = document.getElementById('list-view-btn');

if (mapViewBtn) {
    mapViewBtn.addEventListener('click', () => switchView('map'));
}
if (listViewBtn) {
    listViewBtn.addEventListener('click', () => switchView('list'));
}

// Sort Select
const sortSelect = document.getElementById('sort-select');
if (sortSelect) {
    sortSelect.addEventListener('change', () => {
        updateMarkers();
    });
}

// Sidebar Close
const sidebarClose = document.getElementById('sidebar-close');
if (sidebarClose) {
    sidebarClose.addEventListener('click', hideSidebar);
}

// Close sidebar on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideSidebar();

        // Also close autocomplete
        const suggestions = document.getElementById('search-suggestions');
        if (suggestions) suggestions.classList.remove('active');
    }
});

// Find Nearest Button
const findNearestBtn = document.getElementById('find-nearest');
if (findNearestBtn) {
    findNearestBtn.addEventListener('click', () => {
        // Check if browser supports geolocation
        if (!navigator.geolocation) {
            alert('הדפדפן שלך לא תומך באיתור מיקום');
            return;
        }

        // Disable button while getting location
        findNearestBtn.disabled = true;
        findNearestBtn.innerHTML = '<span>⏳</span> מאתר...';

        navigator.geolocation.getCurrentPosition(
            // Success
            (position) => {
                userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };

                // Remove old user marker if exists
                if (userMarker) {
                    map.removeLayer(userMarker);
                }

                // Add marker for user location
                userMarker = L.marker([userLocation.lat, userLocation.lng], { icon: icons.user })
                    .addTo(map)
                    .bindPopup('<h3>📍 המיקום שלך</h3>')
                    .openPopup();

                // Find nearest location
                let nearest = null;
                let nearestDistance = Infinity;

                allLocations.forEach(location => {
                    // Only consider visible locations (matching current filter)
                    const filterMatch = currentFilter === 'all' || location.type === currentFilter;
                    if (!filterMatch) return;

                    const distance = getDistance(
                        userLocation.lat, userLocation.lng,
                        location.lat, location.lng
                    );

                    if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearest = location;
                    }
                });

                if (nearest) {
                    // Update all popups with distance
                    allMarkers.forEach((item) => {
                        item.marker.setPopupContent(createPopupContent(item.location));
                    });

                    // Update radius circle
                    updateRadiusCircle();

                    // Zoom to show user and nearest location
                    const bounds = L.latLngBounds(
                        [userLocation.lat, userLocation.lng],
                        [nearest.lat, nearest.lng]
                    );
                    map.fitBounds(bounds, { padding: [50, 50] });

                    // Open popup of nearest location
                    const nearestMarkerItem = allMarkers.find(item => item.location.id === nearest.id);
                    if (nearestMarkerItem) {
                        setTimeout(() => {
                            markerCluster.zoomToShowLayer(nearestMarkerItem.marker, () => {
                                nearestMarkerItem.marker.openPopup();
                            });
                            showSidebar(nearest);
                        }, 500);
                    }

                    showNotification(`הנקודה הקרובה: ${nearestDistance.toFixed(1)} ק"מ`);
                }

                // Reset button
                findNearestBtn.disabled = false;
                findNearestBtn.innerHTML = '<span>📍</span> מצא הקרוב אליי';

                // Update list view with distances
                if (currentView === 'list') {
                    updateMarkers();
                }
            },
            // Error
            (error) => {
                findNearestBtn.disabled = false;
                findNearestBtn.innerHTML = '<span>📍</span> מצא הקרוב אליי';

                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        alert('נא לאשר גישה למיקום בדפדפן');
                        break;
                    case error.POSITION_UNAVAILABLE:
                        alert('לא ניתן לאתר את המיקום שלך');
                        break;
                    case error.TIMEOUT:
                        alert('תם הזמן לאיתור מיקום');
                        break;
                    default:
                        alert('שגיאה באיתור מיקום');
                }
            },
            // Options
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

// Setup PWA install button
setupInstallButton();

// Make toggleFavorite globally available
window.toggleFavorite = toggleFavorite;
