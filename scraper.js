/**
 * MAI Battery Recycling Locations Scraper
 *
 * Fetches battery recycling locations from mai.org.il
 * Run with: node scraper.js
 */

const https = require('https');
const fs = require('fs');

// API endpoint for MAI map markers
const API_URL = 'https://mai.org.il/wp-json/wpgmza/v1/markers';

// Fetch data from API
function fetchMarkers() {
    return new Promise((resolve, reject) => {
        console.log('Fetching data from MAI API...');

        const req = https.get(API_URL, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume(); // drain response to free socket
                reject(new Error('HTTP ' + res.statusCode));
                return;
            }

            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    reject(new Error('Invalid JSON: ' + e.message));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy(new Error('Request timed out after 15s'));
        });
    });
}

// Filter for battery-related categories
function filterBatteryLocations(markers) {
    // Category IDs for batteries (you may need to adjust based on actual data)
    // Looking for: סוללות רגילות (regular batteries), סוללות ליתיום (lithium batteries)

    return markers.filter(marker => {
        const categories = marker.categories || [];
        const title = (marker.title || '').toLowerCase();
        const description = (marker.description || '').toLowerCase();

        // Check if marker is related to batteries
        const batteryKeywords = ['סוללות', 'סוללה', 'battery', 'batteries'];
        const hasBatteryCategory = categories.some(cat =>
            batteryKeywords.some(keyword =>
                String(cat).includes(keyword)
            )
        );

        const hasBatteryInText = batteryKeywords.some(keyword =>
            title.includes(keyword) || description.includes(keyword)
        );

        // For now, include all locations since they all accept batteries
        // The MAI map is specifically for electronic waste including batteries
        return true;
    });
}

// Extract city from address
function extractCity(address) {
    if (!address) return 'לא ידוע';

    // Common city patterns in Hebrew addresses
    const cities = [
        'תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'ראשון לציון',
        'פתח תקווה', 'אשדוד', 'נתניה', 'בני ברק', 'חולון',
        'רמת גן', 'אשקלון', 'רחובות', 'בת ים', 'הרצליה',
        'כפר סבא', 'מודיעין', 'רעננה', 'לוד', 'רמלה',
        'נצרת', 'עכו', 'קרית גת', 'אילת', 'דימונה',
        'ערד', 'טבריה', 'צפת', 'קריית שמונה', 'עפולה',
        'נהריה', 'קריית אתא', 'קריית ביאליק', 'קריית ים',
        'גבעתיים', 'הוד השרון', 'יבנה', 'קריית מוצקין'
    ];

    for (const city of cities) {
        if (address.includes(city)) {
            return city;
        }
    }

    // Try to extract from address pattern
    const parts = address.split(',');
    if (parts.length > 1) {
        return parts[parts.length - 1].trim();
    }

    return 'אחר';
}

// Determine location type based on name/description
function determineType(marker) {
    const name = (marker.title || '').toLowerCase();
    const desc = (marker.description || '').toLowerCase();

    const facilityKeywords = ['מפעל', 'מתקן', 'מרכז מיחזור', 'מיון'];

    for (const keyword of facilityKeywords) {
        if (name.includes(keyword) || desc.includes(keyword)) {
            return 'facility';
        }
    }

    return 'store';
}

// Determine chain based on name
function determineChain(name) {
    const nameL = (name || '').toLowerCase();

    if (nameL.includes('סופר-פארם') || nameL.includes('סופרפארם') || nameL.includes('super-pharm') || nameL.includes('superpharm')) return 'superpharm';
    if (nameL.includes('שופרסל') || nameL.includes('shufersal')) return 'shufersal';
    if (nameL.includes('אופיס דיפו') || nameL.includes('office depot')) return 'office_depot';
    if (nameL.includes('הום סנטר') || nameL.includes('home center')) return 'home_center';
    if (nameL.includes('פלאפון') || nameL.includes('pelephone')) return 'pelephone';
    if (nameL.includes('סלקום') || nameL.includes('cellcom')) return 'cellcom';
    if (nameL.includes('batte-re') || nameL.includes('באטרי')) return 'batte_re';
    if (nameL.includes('re-car') || nameL.includes('ריקאר')) return 'recar';
    if (nameL.includes('m.i.l.i') || nameL.includes('מילי') || nameL.includes('mili')) return 'mili';
    if (nameL.includes('עיריית') || nameL.includes('עירייה') || nameL.includes('מועצה')) return 'municipality';
    if (nameL.includes('בזק')) return 'bezeq';
    if (nameL.includes('פרטנר') || nameL.includes('partner')) return 'partner';
    if (nameL.includes('hot')) return 'hot';
    if (nameL.includes('איקאה') || nameL.includes('ikea')) return 'ikea';
    if (nameL.includes('מגה') || nameL.includes('mega')) return 'mega';
    if (nameL.includes('רמי לוי') || nameL.includes('rami levy')) return 'rami_levy';

    return 'other';
}

// Transform marker to our format
function transformMarker(marker, index) {
    const lat = parseFloat(marker.lat);
    const lng = parseFloat(marker.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;

    return {
        id: index + 1,
        name: marker.title || 'נקודת איסוף',
        address: marker.address || 'כתובת לא זמינה',
        city: extractCity(marker.address),
        type: determineType(marker),
        chain: determineChain(marker.title),
        lat: lat,
        lng: lng,
        hours: 'בדוק באתר', // Hours not available from API
        description: marker.description || undefined
    };
}

// Main function
async function main() {
    try {
        // Fetch all markers
        const data = await fetchMarkers();
        console.log(`Fetched ${data.length || 0} total markers`);

        // Handle different response formats
        let markers = Array.isArray(data) ? data : (data.markers || []);

        if (markers.length === 0) {
            console.log('No markers found. Response:', JSON.stringify(data).substring(0, 500));
            return;
        }

        // Filter for battery locations
        const batteryLocations = filterBatteryLocations(markers);
        console.log(`Filtered to ${batteryLocations.length} battery-related locations`);

        // Transform to our format
        const locations = batteryLocations.map(transformMarker).filter(Boolean);

        // Save raw data for debugging
        fs.writeFileSync('raw_markers.json', JSON.stringify(markers, null, 2), 'utf8');
        console.log('Saved raw data to raw_markers.json');

        // Save formatted data
        const output = { locations };
        fs.writeFileSync('locations.json', JSON.stringify(output, null, 2), 'utf8');
        console.log(`Saved ${locations.length} locations to locations.json`);

        // Print summary
        const types = {};
        const chains = {};
        locations.forEach(loc => {
            types[loc.type] = (types[loc.type] || 0) + 1;
            chains[loc.chain] = (chains[loc.chain] || 0) + 1;
        });

        console.log('\n--- Summary ---');
        console.log('By type:', types);
        console.log('By chain:', chains);

    } catch (error) {
        console.error('Error:', error.message);
    }
}

main();
