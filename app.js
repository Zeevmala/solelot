// Initialize the map centered on Israel
const map = L.map('map').setView([31.5, 34.9], 8);

// Add map tiles from OpenStreetMap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Define marker icons for different location types
const icons = {
    store: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    }),
    facility: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    }),
    user: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    })
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

// Create popup content for a location
function createPopupContent(location) {
    let content = `
        <h3>${location.name}</h3>
        <p><strong>סוג:</strong> ${typeNames[location.type]}</p>
        <p><strong>כתובת:</strong> ${location.address}</p>
        <p><strong>שעות:</strong> ${location.hours}</p>
    `;

    if (location.description) {
        content += `<p><strong>פרטים:</strong> ${location.description}</p>`;
    }

    // Add distance if user location is known
    if (userLocation) {
        const distance = getDistance(
            userLocation.lat, userLocation.lng,
            location.lat, location.lng
        );
        content += `<p class="distance">📍 מרחק: ${distance.toFixed(1)} ק"מ</p>`;
    }

    // Add navigation links
    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`;
    const wazeUrl = `https://waze.com/ul?ll=${location.lat},${location.lng}&navigate=yes`;

    content += `
        <div class="nav-links">
            <a href="${googleMapsUrl}" target="_blank" class="nav-btn google">Google Maps</a>
            <a href="${wazeUrl}" target="_blank" class="nav-btn waze">Waze</a>
        </div>
    `;

    return content;
}

// Update which markers are visible based on filters
function updateMarkers() {
    let visibleCount = 0;

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

        // Show or hide marker
        if (filterMatch && cityMatch && searchMatch) {
            item.marker.addTo(map);
            visibleCount++;
        } else {
            map.removeLayer(item.marker);
        }
    });

    // Update count display
    const countEl = document.getElementById('location-count');
    if (countEl) {
        countEl.textContent = `${visibleCount} נקודות`;
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

// Load locations from JSON
fetch('locations.json')
    .then(response => response.json())
    .then(data => {
        allLocations = data.locations;

        // Create markers for all locations
        allLocations.forEach(location => {
            const icon = icons[location.type] || icons.store;
            const marker = L.marker([location.lat, location.lng], { icon: icon });
            marker.bindPopup(createPopupContent(location));
            marker.addTo(map);

            allMarkers.push({ marker, location });
        });

        // Populate city dropdown
        populateCityDropdown();

        // Update initial count
        updateMarkers();

        console.log('Loaded', allLocations.length, 'locations');
    })
    .catch(error => {
        console.error('Error loading locations:', error);
    });

// --- City Filter Dropdown ---
const citySelect = document.getElementById('city-filter');
if (citySelect) {
    citySelect.addEventListener('change', () => {
        currentCity = citySelect.value;
        updateMarkers();
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
                    nearestMarkerItem.marker.openPopup();
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
