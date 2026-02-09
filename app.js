// Initialize the map centered on Israel
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

// Add default basemap
baseMaps['רחובות'].addTo(map);

// Add layer control
L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

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
            <button class="legend-toggle" onclick="toggleLegend()">▼</button>
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

// Store all locations and markers
let allLocations = [];
let allMarkers = [];
let userMarker = null;
let userLocation = null;
let totalLocations = 0;

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

    let content = `
        <h3>
            <span class="popup-icon">${typeIcon}</span>
            ${location.name}
        </h3>
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

    allMarkers.forEach((item, index) => {
        const location = allLocations[index];

        // Check filter match
        const filterMatch = currentFilter === 'all' || location.type === currentFilter;

        // Check city match
        const cityMatch = currentCity === 'all' || location.city === currentCity;

        // Check search match (search in city name)
        const searchMatch = currentSearch === '' ||
            location.city.includes(currentSearch) ||
            location.name.includes(currentSearch) ||
            location.address.includes(currentSearch);

        // Collect visible markers
        if (filterMatch && cityMatch && searchMatch) {
            visibleMarkers.push(item.marker);
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

    return visibleMarkers;
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
    currentSearch = '';

    // Reset UI
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => btn.classList.remove('active'));
    document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');

    const citySelect = document.getElementById('city-filter');
    if (citySelect) citySelect.value = 'all';

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';

    updateMarkers();

    // Reset map view
    map.flyTo([31.5, 34.9], 8, { duration: 0.8 });
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

// Load locations from JSON
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

            allMarkers.push({ marker, location });
        });

        // Populate city dropdown
        populateCityDropdown();

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

// --- Clear Filters Button ---
const clearFiltersBtn = document.getElementById('clear-filters');
if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', clearFilters);
}

// --- City Filter Dropdown ---
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

// --- Filter Buttons ---
const filterButtons = document.querySelectorAll('.filter-btn');

filterButtons.forEach(button => {
    button.addEventListener('click', () => {
        // Update active button style
        filterButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        // Update filter and refresh markers
        currentFilter = button.dataset.filter;
        updateMarkers();
    });
});

// --- Search Box ---
const searchInput = document.getElementById('search-input');

searchInput.addEventListener('input', () => {
    currentSearch = searchInput.value.trim();
    updateMarkers();
});

// --- Find Nearest Button ---
const findNearestBtn = document.getElementById('find-nearest');

findNearestBtn.addEventListener('click', () => {
    // Check if browser supports geolocation
    if (!navigator.geolocation) {
        alert('הדפדפן שלך לא תומך באיתור מיקום');
        return;
    }

    // Disable button while getting location
    findNearestBtn.disabled = true;
    findNearestBtn.textContent = '⏳ מאתר...';

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
                    }, 500);
                }
            }

            // Reset button
            findNearestBtn.disabled = false;
            findNearestBtn.textContent = '📍 מצא הקרוב אליי';
        },
        // Error
        (error) => {
            findNearestBtn.disabled = false;
            findNearestBtn.textContent = '📍 מצא הקרוב אליי';

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
