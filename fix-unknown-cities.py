"""
Fix Unknown Cities Using Reverse Geocoding

Uses Nominatim (OpenStreetMap) to reverse geocode lat/lng coordinates
to get proper city names for locations with "Unknown" city values.

Run with: python fix-unknown-cities.py
"""

import json
import urllib.request
import time
import sys

# Fix Windows console encoding for Hebrew output
sys.stdout.reconfigure(encoding='utf-8')


def clean_city_name(city):
    """Clean up city names from Nominatim response.

    Handles:
    - Bilingual names like 'ירושלים | القدس' -> 'ירושלים'
    - Unicode dashes like 'תל־אביב–יפו' -> 'תל אביב-יפו'
    - Extra whitespace
    """
    if not city or city == 'Unknown':
        return 'Unknown'

    # Take only Hebrew part if bilingual (before ' | ')
    if ' | ' in city:
        city = city.split(' | ')[0].strip()

    # Normalize dashes: replace Unicode dashes with regular hyphen
    city = city.replace('\u2013', '-')   # en dash
    city = city.replace('\u2014', '-')   # em dash
    city = city.replace('\u05be', ' ')   # Hebrew maqaf (־)

    return city.strip()


def reverse_geocode_city(lat, lng):
    """Reverse geocode lat/lng to get city name using Nominatim"""
    url = f'https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&language=he'

    req = urllib.request.Request(url, headers={
        'User-Agent': 'Battery-Recycling-Map (github.com/Zeevmala/solelot)'
    })

    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.loads(response.read().decode('utf-8'))
        address = data.get('address', {})

        # Extract city from address components
        # Israeli locations use different fields depending on the area:
        #   - city: most cities (Haifa, Jerusalem, etc.)
        #   - town: smaller towns
        #   - village: small villages
        #   - residential: some Tel Aviv area locations
        #   - municipality: fallback for regional councils
        city = (address.get('city') or
                address.get('town') or
                address.get('village') or
                address.get('residential') or
                address.get('municipality') or
                'Unknown')

        return clean_city_name(city)


def main():
    print('Loading locations.json...')

    # Load locations.json
    with open('locations.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    locations = data['locations']

    # Find Unknown cities
    unknown_locations = [loc for loc in locations if loc.get('city') == 'Unknown']
    print(f'\nFound {len(unknown_locations)} locations with Unknown city')

    if not unknown_locations:
        print('No Unknown cities to fix!')
        return

    est_minutes = (len(unknown_locations) // 60) + 1
    print(f'Estimated time: ~{est_minutes} minutes (1 request/second)\n')

    fixed = 0
    failed = 0

    # Process each one with 1-second rate limit
    for i, location in enumerate(unknown_locations):
        try:
            name = location.get('name', 'N/A')
            print(f'[{i+1}/{len(unknown_locations)}] {name}...', end=' ', flush=True)

            city = reverse_geocode_city(location['lat'], location['lng'])

            if city and city != 'Unknown':
                location['city'] = city
                print(f'-> {city}')
                fixed += 1
            else:
                print('-> No city found')
                failed += 1

            # Rate limit: 1 request/second (Nominatim requirement)
            if i < len(unknown_locations) - 1:
                time.sleep(1)

        except Exception as e:
            print(f'-> Error: {e}')
            failed += 1
            # Wait before retrying to avoid being blocked
            time.sleep(2)

    # Save updated locations.json
    print('\nSaving updated locations.json...')
    with open('locations.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f'\nDone!')
    print(f'  Fixed: {fixed} cities')
    print(f'  Failed: {failed} cities')

    if failed > 0:
        print(f'\n  {failed} locations still have Unknown city - may need manual review')


if __name__ == '__main__':
    main()
