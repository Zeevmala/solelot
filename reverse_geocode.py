"""
Reverse geocode "Collection Point" entries in locations.json.

These 403 entries have coordinates but address="Unknown" and an English name.
This script:
1. Finds entries with address "Unknown"
2. Uses Nominatim (free, no API key) to get a Hebrew street address from coordinates
3. Updates the address field and translates the name to Hebrew
4. Saves results back to locations.json

Usage: python reverse_geocode.py
Rate limit: 1 request/second (Nominatim policy)
Estimated time: ~7 minutes for 403 entries
"""

import json
import time
import sys
import io
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# Fix Windows console encoding for Hebrew output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Setup
INPUT_FILE = "locations.json"
DELAY_SECONDS = 1.1  # Nominatim requires max 1 req/sec, add buffer

def main():
    # Read locations.json
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    locations = data["locations"]
    unknown = [loc for loc in locations if loc.get("address") == "Unknown"]
    print(f"Found {len(unknown)} entries with address='Unknown' out of {len(locations)} total")

    if not unknown:
        print("Nothing to do!")
        return

    # Setup geocoder with a descriptive user agent
    geolocator = Nominatim(
        user_agent="battery-recycling-israel-data-cleanup",
        timeout=10
    )

    success = 0
    failed = 0
    failed_ids = []

    for i, loc in enumerate(unknown):
        loc_id = loc["id"]
        lat = loc["lat"]
        lng = loc["lng"]

        try:
            result = geolocator.reverse(
                (lat, lng),
                language="he",
                exactly_one=True
            )

            if result and result.address:
                # Extract street address from the full result
                raw = result.raw.get("address", {})
                road = raw.get("road", "")
                house_number = raw.get("house_number", "")

                if road:
                    # Build address: "street number, city"
                    street_part = f"{road} {house_number}".strip()
                    city = loc.get("city", "")
                    new_address = f"{street_part}, {city}" if city else street_part
                    loc["address"] = new_address
                else:
                    # No road found, use whatever Nominatim returned
                    # Take first meaningful part of the address
                    display = result.address.split(",")[0].strip()
                    city = loc.get("city", "")
                    loc["address"] = f"{display}, {city}" if city else display

                success += 1
                print(f"[{i+1}/{len(unknown)}] id={loc_id} OK -> {loc['address']}")
            else:
                print(f"[{i+1}/{len(unknown)}] id={loc_id} NO RESULT")
                failed += 1
                failed_ids.append(loc_id)

        except (GeocoderTimedOut, GeocoderServiceError) as e:
            print(f"[{i+1}/{len(unknown)}] id={loc_id} ERROR: {e}")
            failed += 1
            failed_ids.append(loc_id)
        except Exception as e:
            print(f"[{i+1}/{len(unknown)}] id={loc_id} UNEXPECTED: {e}")
            failed += 1
            failed_ids.append(loc_id)

        # Respect rate limit
        time.sleep(DELAY_SECONDS)

    # Save back
    with open(INPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Summary
    print(f"\n--- Done ---")
    print(f"Success: {success}")
    print(f"Failed:  {failed}")
    if failed_ids:
        print(f"Failed IDs: {failed_ids}")

if __name__ == "__main__":
    main()
